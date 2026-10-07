import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scryptAsync = promisify(scrypt);
const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const dataDir = resolve(root, process.env.DATA_DIR || 'data');
const storePath = join(dataDir, 'store.json');
const port = Number(process.env.PORT || 3000);
const sessionTtlMs = 12 * 60 * 60 * 1000;
const sessionCookie = 'focusdesk_session';
const dummySalt = randomBytes(16);
const sessions = new Map();
const failedLogins = new Map();
const maxLoginAttempts = 8;
const loginWindowMs = 10 * 60 * 1000;
const taskPriorities = new Set(['low', 'normal', 'high', 'urgent']);
let store = { users: [], tasks: [] };
let mutationQueue = Promise.resolve();

function sendJson(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 12_000) throw new Error('Request body too large');
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw new Error('Invalid JSON'); }
}

function cookieFlags(maxAge) {
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}

function setSessionCookie(response, value, maxAge) {
  response.setHeader('Set-Cookie', `${sessionCookie}=${value}; ${cookieFlags(maxAge)}`);
}

function getRequestSession(request) {
  const cookieHeader = request.headers.cookie || '';
  const token = cookieHeader.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  for (const [ip, item] of failedLogins) if (item.resetAt <= now) failedLogins.delete(ip);
}

function requestIp(request) {
  return request.socket.remoteAddress || 'unknown';
}

function checkLoginRateLimit(request) {
  pruneExpiredSessions();
  const record = failedLogins.get(requestIp(request));
  return record && record.count >= maxLoginAttempts
    ? Math.max(1, Math.ceil((record.resetAt - Date.now()) / 1000))
    : 0;
}

function recordFailedLogin(request) {
  const key = requestIp(request);
  const current = failedLogins.get(key);
  if (!current || current.resetAt <= Date.now()) {
    failedLogins.set(key, { count: 1, resetAt: Date.now() + loginWindowMs });
  } else {
    current.count += 1;
  }
}

function clearFailedLogins(request) {
  failedLogins.delete(requestIp(request));
}

async function passwordHash(password, salt) {
  return scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function timingSafeTextMatch(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readStore() {
  try {
    const parsed = JSON.parse(await readFile(storePath, 'utf8'));
    if (!Array.isArray(parsed.users) || !Array.isArray(parsed.tasks)) throw new Error('Invalid data store format');
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { users: [], tasks: [] };
    throw error;
  }
}

async function persistStore() {
  await mkdir(dataDir, { recursive: true });
  const temporaryPath = `${storePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, storePath);
}

function mutateStore(operation) {
  const result = mutationQueue.then(async () => {
    const value = await operation();
    await persistStore();
    return value;
  });
  mutationQueue = result.catch(() => {});
  return result;
}

function publicUser(user) {
  return { id: user.id, username: user.username };
}

function isValidUsername(username) {
  return typeof username === 'string' && /^[a-z0-9][a-z0-9_-]{2,19}$/.test(username);
}

function isValidDueDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function enforceSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function handleApi(request, response, url) {
  if (!enforceSameOrigin(request)) return sendJson(response, 403, { error: 'Request origin not allowed.' });

  if (request.method === 'POST' && url.pathname === '/api/register') {
    const body = await readJson(request);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!isValidUsername(username)) {
      return sendJson(response, 400, { error: 'Username must be 3–20 characters: lowercase letters, numbers, _ or -.' });
    }
    if (password.length < 12 || Buffer.byteLength(password) > 1024) {
      return sendJson(response, 400, { error: 'Choose a password with at least 12 characters.' });
    }
    const user = await mutateStore(async () => {
      if (store.users.some((item) => item.username === username)) return null;
      const salt = randomBytes(16);
      const hash = await passwordHash(password, salt);
      const created = { id: randomUUID(), username, salt: salt.toString('base64url'), passwordHash: hash.toString('base64url'), createdAt: new Date().toISOString() };
      store.users.push(created);
      return created;
    });
    if (!user) return sendJson(response, 409, { error: 'That username is already taken.' });
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionTtlMs });
    setSessionCookie(response, token, Math.floor(sessionTtlMs / 1000));
    return sendJson(response, 201, { user: publicUser(user) });
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    const retryAfter = checkLoginRateLimit(request);
    if (retryAfter) return sendJson(response, 429, { error: 'Too many sign-in attempts. Try again later.' }, { 'Retry-After': String(retryAfter) });
    const body = await readJson(request);
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' && Buffer.byteLength(body.password) <= 1024 ? body.password : '';
    const user = store.users.find((item) => item.username === username);
    const salt = user ? Buffer.from(user.salt, 'base64url') : dummySalt;
    const actualHash = await passwordHash(password, salt);
    const passwordMatches = user
      ? timingSafeTextMatch(actualHash.toString('base64url'), user.passwordHash)
      : false;
    if (!user || !passwordMatches) {
      recordFailedLogin(request);
      return sendJson(response, 401, { error: 'Username or password is incorrect.' });
    }
    clearFailedLogins(request);
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { userId: user.id, expiresAt: Date.now() + sessionTtlMs });
    setSessionCookie(response, token, Math.floor(sessionTtlMs / 1000));
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const session = getRequestSession(request);
    if (session) sessions.delete(session.token);
    setSessionCookie(response, '', 0);
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname === '/api/me') {
    const session = getRequestSession(request);
    const user = session && store.users.find((item) => item.id === session.userId);
    if (!user) return sendJson(response, 401, { error: 'Please sign in to continue.' });
    return sendJson(response, 200, { user: publicUser(user) });
  }

  if (url.pathname === '/api/tasks') {
    const session = getRequestSession(request);
    const user = session && store.users.find((item) => item.id === session.userId);
    if (!user) return sendJson(response, 401, { error: 'Please sign in to continue.' });

    if (request.method === 'GET') {
      const tasks = store.tasks.filter((task) => task.userId === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return sendJson(response, 200, { tasks });
    }

    if (request.method === 'POST') {
      const body = await readJson(request);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title || title.length > 140) return sendJson(response, 400, { error: 'Task title must be between 1 and 140 characters.' });
      const priority = body.priority || 'normal';
      const dueDate = body.dueDate || null;
      if (!taskPriorities.has(priority)) return sendJson(response, 400, { error: 'Choose a valid task priority.' });
      if (dueDate !== null && !isValidDueDate(dueDate)) {
        return sendJson(response, 400, { error: 'Choose a valid due date.' });
      }
      const task = { id: randomUUID(), userId: user.id, title, done: false, priority, dueDate, createdAt: new Date().toISOString() };
      await mutateStore(() => { store.tasks.push(task); return task; });
      return sendJson(response, 201, { task });
    }
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([0-9a-f-]{36})$/i);
  if (taskMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    const session = getRequestSession(request);
    const user = session && store.users.find((item) => item.id === session.userId);
    if (!user) return sendJson(response, 401, { error: 'Please sign in to continue.' });
    const task = store.tasks.find((item) => item.id === taskMatch[1] && item.userId === user.id);
    if (!task) return sendJson(response, 404, { error: 'Task not found.' });
    if (request.method === 'PATCH') {
      const body = await readJson(request);
      const changes = {};
      if ('title' in body) {
        if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 140) {
          return sendJson(response, 400, { error: 'Task title must be between 1 and 140 characters.' });
        }
        changes.title = body.title.trim();
      }
      if ('done' in body) {
        if (typeof body.done !== 'boolean') return sendJson(response, 400, { error: 'Choose a valid completed status.' });
        changes.done = body.done;
      }
      if ('priority' in body) {
        if (!taskPriorities.has(body.priority)) return sendJson(response, 400, { error: 'Choose a valid task priority.' });
        changes.priority = body.priority;
      }
      if ('dueDate' in body) {
        if (body.dueDate !== null && !isValidDueDate(body.dueDate)) {
          return sendJson(response, 400, { error: 'Choose a valid due date.' });
        }
        changes.dueDate = body.dueDate;
      }
      if (Object.keys(changes).length === 0) return sendJson(response, 400, { error: 'Choose a task detail to update.' });
      await mutateStore(() => { Object.assign(task, changes); return task; });
      return sendJson(response, 200, { task });
    }
    await mutateStore(() => { store.tasks = store.tasks.filter((item) => item.id !== task.id); return true; });
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: 'API route not found.' });
}

const contentTypes = { '.html': 'text/html; charset=utf-8' };
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });
    }
    if (url.pathname !== '/' && url.pathname !== '/index.html') return sendJson(response, 404, { error: 'Not found.' });
    const page = await readFile(join(publicDir, 'index.html'));
    response.writeHead(200, {
      'Content-Type': contentTypes[extname('index.html')],
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
    });
    return response.end(request.method === 'HEAD' ? undefined : page);
  } catch (error) {
    if (error.message === 'Invalid JSON' || error.message === 'Request body too large') {
      return sendJson(response, 400, { error: error.message === 'Invalid JSON' ? 'Please send valid JSON.' : 'Request body too large.' });
    }
    console.error('Request failed:', error.message);
    return sendJson(response, 500, { error: 'A server error occurred.' });
  }
});

store = await readStore();
server.listen(port, () => console.log(`FocusDesk is running at http://localhost:${port}`));

