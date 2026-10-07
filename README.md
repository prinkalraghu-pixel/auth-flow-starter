# FocusDesk

FocusDesk is a small personal task manager with real account registration, sign-in, and saved tasks. Create an account, keep a list, mark items complete, and come back to the same list after restarting the app.

The app is designed to run on your own computer. Accounts and tasks are stored locally in `data/store.json`; that file is ignored by Git and is never included in this repository. No real credentials, API keys, or external services are needed.

## Start FocusDesk

You need Node.js 20.6 or newer.

1. Copy `.env.example` to `.env`.
2. Run `npm start` from the project folder.
3. Open <http://localhost:3000>.
4. Choose **Create account** and make your own username and password.

Usernames must be 3–20 characters and use lowercase letters, numbers, `_` or `-`. Passwords must have at least 12 characters. Choose a password you do not use for another account.

## What you can do

- Create an account and sign in or out.
- Add tasks, mark them complete, filter the list, and delete tasks.
- Keep tasks saved between app restarts.
- Sign in on another local browser and see the same account's tasks.
- Keep each account's tasks separate from other accounts.

## Request flow

```text
Browser form ── POST /api/register or /api/login ──> Node.js server
                                                         │
                                                         ├─ Validate username and password
                                                         ├─ Verify/store a salted scrypt password hash
                                                         └─ Create a random server-side session
Browser <── Set-Cookie: HttpOnly + SameSite=Strict ──────┘
   │
   ├─ GET /api/me ──> verify session and identify account
   ├─ GET /api/tasks ──> return only this account's tasks
   ├─ POST /api/tasks ──> save a task for this account
   ├─ PATCH /api/tasks/:id ──> update its completed state
   ├─ DELETE /api/tasks/:id ──> delete only this account's task
   └─ POST /api/logout ──> revoke session and clear cookie
```

The browser never receives the password hash or session ID through page JavaScript. The session ID lives in a server-managed map and an `HttpOnly` cookie. The cookie is `Secure` when `NODE_ENV=production`; local development uses HTTP on localhost.

## Project structure

```text
public/index.html    FocusDesk interface and browser-side requests
src/server.js        Registration, login, sessions, task API, persistence
data/store.json      Created on first account; local user and task records
.env.example         Safe local configuration example
.gitignore           Excludes environment files and personal data
```

## Data and backup

The app creates `data/store.json` after the first account is registered. It contains usernames, salted password hashes, and task records. It does not contain plaintext passwords. Keep this file private. To back up your accounts and tasks, stop the app and copy this file somewhere safe. Deleting the file deletes the local accounts and task lists.

## Security and deployment limits

FocusDesk is a useful local personal app and a learning project; it is not a production-ready hosted service.

- Do not deploy this version publicly. It has no email verification, password reset, MFA, database-level locking, or production monitoring.
- Sessions are stored in memory, so restarting the server signs everyone out. Tasks and accounts remain on disk.
- The included login rate limit is per process and per IP; it resets when the app restarts.
- The JSON store is suitable for one small local instance, not multiple server processes or concurrent hosted users.
- If you expose the app to a network, use HTTPS, a mature database, a maintained session library, backups, stronger abuse controls, and a security review first.
- Never commit `.env`, `data/store.json`, or anyone's actual credentials. `.gitignore` excludes them.

## License

MIT

