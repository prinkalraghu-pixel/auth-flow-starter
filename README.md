# Auth Flow Starter

A beginner-friendly, dependency-free web app that shows how a browser login request becomes an authenticated API request. It uses Node.js built-ins and clearly labeled demo credentials. No third-party services or real secrets are needed.

## Run it

You need Node.js 20.6 or newer.

1. Copy `.env.example` to `.env`.
2. Start the app with `npm start`.
3. Open <http://localhost:3000>.
4. Sign in with the values in `.env` (`learner` / `change-this-demo-password` by default).

Change `SESSION_SECRET` to a long random value for your own local run. Keep `.env` private; `.gitignore` excludes it.

## What happens when you sign in

```text
Browser form
   │ POST /api/login (JSON username + password)
   ▼
Node HTTP server ── validate input and compare password hash
   │ success: create signed session token
   ▼
Set-Cookie: demo_session=...; HttpOnly; SameSite=Strict
   │ browser automatically sends cookie on next request
   ▼
GET /api/me ── verify signature + expiry ── return current user
```

- **Browser UI** (`public/`) submits the form and displays the result. It never reads the session token.
- **HTTP server** (`src/server.js`) serves static files and handles `/api/login`, `/api/me`, and `/api/logout`.
- **Credential check** hashes the configured demo password with Node's `scrypt` and compares it with a constant-time comparison. The sample password comes from `.env`; the server does not store or return it.
- **Session token** is an HMAC-SHA256-signed payload containing a username and expiration time. It is held in an `HttpOnly` cookie, so page JavaScript cannot read it. The server checks the signature and expiry on protected requests.
- **Logout** expires the cookie in the browser.

## Files

```text
public/index.html   Login form and signed-in view
src/server.js       HTTP routes, password check, cookie and token handling
.env.example        Safe example settings; copy to the ignored .env file
.gitignore          Excludes local secrets and dependencies
package.json        Start command and Node version
```

## Try the flow

1. Open the browser developer tools' Network panel.
2. Sign in and inspect `POST /api/login`. The request body contains the username and demo password over local HTTP. In a deployed app, HTTPS is essential.
3. Inspect the response headers: `Set-Cookie` sets the session cookie.
4. Refresh or click **Check session**. The browser sends the cookie to `GET /api/me`; the response does not expose the token.
5. Click **Log out**. The cookie is expired and `/api/me` returns `401`.
6. Try a wrong password to see the generic authentication error.

## Security notes and limits

This is a teaching demo, not production authentication.

- Never use the example password or secret for a public deployment. Never commit `.env` or paste secrets into source code.
- The configured password is supplied as environment text and hashed in memory at startup. Real systems should use a user database, per-user salted password hashes with a reviewed password-hashing library (such as Argon2id or bcrypt), password reset flows, rate limiting, and abuse monitoring.
- The session is stateless: signing prevents undetected edits, but there is no server-side session record to revoke before expiry. Production systems should use a vetted session library and plan for revocation/rotation.
- The server sets `HttpOnly`, `SameSite=Strict`, and `Path=/`. It sets `Secure` when `NODE_ENV=production`; production must use HTTPS. Cookie policy, CSRF defenses, CORS, and proxy settings need deployment-specific review.
- There is no registration, database, OAuth, MFA, email, or password recovery.
- The demo uses HTTP on localhost only. Do not expose it to the internet without redesigning and reviewing it.

## Authentication components

| Component | Purpose |
| --- | --- |
| Demo environment settings | Provide one local username/password and the signing secret |
| Password hashing | Compare a submitted password without storing a plaintext copy in application memory |
| Login route | Validate credentials and issue the signed cookie |
| Cookie | Carry the session token automatically between browser requests |
| Session verifier | Check token signature and expiration before returning protected data |
| Logout route | Clear the browser cookie |

## License

MIT

