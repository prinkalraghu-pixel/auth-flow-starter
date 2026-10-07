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
- Add, edit, prioritize, complete, and delete tasks.
- Set due dates and use Today, Upcoming, Calendar, All tasks, and Completed views.
- Schedule tasks to repeat daily, on weekdays, or weekly; completing one creates its next occurrence.
- See a daily progress ring and task counts.
- Run a focus timer and schedule browser reminders.
- Keep tasks saved between app restarts.
- Sign in on another local browser and see the same account's tasks.
- Keep each account's tasks separate from other accounts.

The timer and reminders run in the browser. Keep the FocusDesk tab open for them to fire. Choose from 10 built-in ring tones grouped as sad, happy, extra happy, normal, and calm, and preview the selected tone. When a timer or reminder is due, FocusDesk repeats the selected in-app chime and shows a stop button; browser notifications are optional and depend on browser permission. Reminders and the selected tone are saved in that browser's local storage and are not synced to other devices.

## Install on a phone

FocusDesk includes a web app manifest and a service worker, so it can be added to an Android or iPhone home screen and open in a standalone app window. It must be served from an HTTPS website for phone installation. `localhost` works for development on the computer itself, but it is not a public address your phone can open. This project still needs a Node.js host and HTTPS domain before it can be installed from a phone; GitHub Pages alone cannot run its account and task API.

- **Android:** open the hosted FocusDesk URL in Chrome, then choose **Install app** or **Add to Home screen** in the browser menu.
- **iPhone:** open the hosted URL in Safari, tap **Share**, then choose **Add to Home Screen**.

The service worker caches the app shell for quicker opening. Login and task changes still need the server online. Timer sounds and reminders are browser-based; they are not native background alarms and should not be relied on after closing the app.

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
   ├─ PATCH /api/tasks/:id ──> update title, priority, due date, repeat schedule, or completed state
   ├─ DELETE /api/tasks/:id ──> delete only this account's task
   └─ POST /api/logout ──> revoke session and clear cookie
```

The browser never receives the password hash or session ID through page JavaScript. The session ID lives in a server-managed map and an `HttpOnly` cookie. The cookie is `Secure` when `NODE_ENV=production`; local development uses HTTP on localhost.

## Project structure

```text
public/index.html    FocusDesk interface, focus timer, browser reminders, and requests
public/manifest.webmanifest  Installable app name, colors, and icon
public/sw.js         Small offline cache for the app shell (never caches API data)
public/icon.svg      Home-screen and browser icon
src/server.js        Registration, login, sessions, task API, persistence, and static assets
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

