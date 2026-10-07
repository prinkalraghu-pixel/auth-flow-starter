import { createHmac, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const port = Number(process.env.PORT || 3000);
const expectedUsername = process.env.DEMO_USERNAME || 'learner';
const demoPassword = process.env.DEMO_PASSWORD || 'change-this-demo-password';
const sessionSecret = process.env.SESSION_SECRET || 'local-only-change-me';
const sessionTtlSeconds = 60 * 60;
const salt = randomBytes(16);
const expectedPasswordHash = scryptSync(demoPassword, salt, 64);

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Request body too large');
  }
  return JSON.parse(raw || '{}');
}

function sign(value) {
  return createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function createSession(username) {
  const payload = Buffer.from(JSON.stringify({ sub: username, exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function getSession(request) {
  const cookieHeader = request.headers.cookie || '';
  const token = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('demo_session='))?.slice('demo_session='.length);
  if (!token) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof session.sub !== 'string' || typeof session.exp !== 'number' || session.exp <= Date.now() / 1000) return null;
    return session;
  } catch { return null; }
}

const cookieOptions = `Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionTtlSeconds}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const expiredCookie = `Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(request);
      const submittedPassword = typeof body.password === 'string' ? body.password : '';
      const submittedHash = scryptSync(submittedPassword, salt, 64);
      const usernameMatches = typeof body.username === 'string' && body.username === expectedUsername;
      const passwordMatches = timingSafeEqual(expectedPasswordHash, submittedHash);
      if (!usernameMatches || !passwordMatches) return sendJson(response, 401, { error: 'Username or password is incorrect.' });
      return sendJson(response, 200, { user: { username: expectedUsername } }, { 'Set-Cookie': `demo_session=${createSession(expectedUsername)}; ${cookieOptions}` });
    }
    if (request.method === 'GET' && url.pathname === '/api/me') {
      const session = getSession(request);
      if (!session) return sendJson(response, 401, { error: 'No valid session. Please sign in.' });
      return sendJson(response, 200, { user: { username: session.sub } });
    }
    if (request.method === 'POST' && url.pathname === '/api/logout') {
      return sendJson(response, 200, { ok: true }, { 'Set-Cookie': `demo_session=; ${expiredCookie}` });
    }
    if (request.method === 'GET' && url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'Route not found.' });
    if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'Method not allowed.' }, { Allow: 'GET, HEAD' });

    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const relative = normalize(pathname).replace(/^([/\\]|\.\.(?:[/\\]|$))+/, '');
    const filePath = join(publicDir, relative);
    if (!filePath.startsWith(publicDir)) return sendJson(response, 403, { error: 'Forbidden.' });
    const content = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error instanceof SyntaxError || error.message === 'Request body too large') return sendJson(response, 400, { error: 'Invalid request body.' });
    if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'Not found.' });
    console.error('Request failed:', error.message);
    return sendJson(response, 500, { error: 'Server error.' });
  }
});

server.listen(port, () => console.log(`Auth Flow Starter is running at http://localhost:${port}`));

