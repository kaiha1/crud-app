# Taskroom

A small, responsive task manager with signup, login, and private task CRUD. The frontend uses native HTML, CSS, and JavaScript; an Express backend serves both the UI and JSON API. SQLite keeps the entire database in one local file. No external services or API keys are required.

## Run

Requires **Node.js 24 or newer** (uses built-in `node:sqlite`).

```sh
npm ci
npm run dev
```

The app listens on port **3000**. Create an account in the Sign up tab, then create, edit, complete, search, filter, and delete your tasks. `npm start` runs without file watching. Static frontend files are served directly; there is no separate frontend build step.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `data/taskroom.sqlite` | Persistent SQLite file; relative to working directory |
| `NODE_ENV` | unset | Set `production` behind HTTPS to enable Secure session cookies |

Database tables and indexes are created automatically. Keep the `data/` directory on persistent storage and back it up with SQLite's backup tooling (or stop the app before copying the database). Do not commit database files.

## Structure

```text
public/                 Responsive frontend; no framework or bundler
  index.html            Accessible forms, task list, and dialogs
  styles.css            Desktop and mobile styles
  app.js                Authentication, API client, and task interactions
server/
  index.js              Server startup and graceful shutdown
  app.js                API routes, authentication, and validation
  database.js           SQLite schema, indexes, and foreign keys
test/
  api.test.js           Isolated API and persistence tests
  ui.spec.js            Desktop and mobile browser workflows
```

## Database

- `users`: unique case-insensitive email, name, salted scrypt password hash, creation time.
- `sessions`: SHA-256 hash of a random session token, user foreign key, seven-day expiration. Raw tokens only live in HttpOnly cookies.
- `tasks`: owner foreign key, title, description, constrained status (`todo`, `doing`, `done`), creation and update times.

Foreign keys enforce relationships, and indexes support owner-based task lists and session cleanup. All SQL uses bound parameters. Task reads and writes always check ownership. WAL mode and a busy timeout support normal concurrent local use.

## API

All bodies and responses are JSON. Mutations require `X-Requested-With: Taskroom` and `Content-Type: application/json`. Session cookies authenticate requests; no browser token storage is needed.

| Method | Path | Action |
| --- | --- | --- |
| GET | `/api/health` | Database health check |
| POST | `/api/auth/signup` | `{name,email,password}`; create account and session |
| POST | `/api/auth/login` | `{email,password}`; create session |
| POST | `/api/auth/logout` | Revoke current session |
| GET | `/api/auth/me` | Current account |
| GET | `/api/tasks` | List your tasks, newest first |
| POST | `/api/tasks` | Create `{title,description?,status?}` |
| GET | `/api/tasks/:id` | Read an owned task |
| PUT | `/api/tasks/:id` | Replace title, description, and status |
| DELETE | `/api/tasks/:id` | Delete an owned task |

Passwords must contain 8–128 characters, names 1–80, titles 1–120, and descriptions at most 2,000. Authentication attempts are rate limited. Requests from other origins cannot supply the required custom header without CORS permission, which this app does not grant. Helmet supplies security headers and a content security policy; user content is rendered with `textContent`.

## Tests

```sh
npm test
```

Runs API tests against a temporary SQLite database: validation, account uniqueness, password hashing, session rotation/revocation/expiry, ownership, full CRUD, request protection, and persistence. Tests do not use your development database.

For browser tests, install Playwright Chromium once:

```sh
npx playwright install chromium
npm run test:e2e
```

If Chromium is already installed, use it without downloading another browser:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

Browser tests start an isolated server on port 3101 using an in-memory database. They exercise signup, login errors, session persistence after reload, task CRUD, filters, search, and logout at desktop and mobile sizes.

## Deployment scope

This is a simple single-instance app. Put it behind HTTPS, set `NODE_ENV=production`, and persist the database directory for deployment. In-memory rate limits reset on restart; multi-instance deployments need a shared limiter and database. Password resets and email verification are outside this app's current scope.
