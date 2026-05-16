# Festival Setup

This guide documents the primary local setup path for Festival: a real Firebase project plus a local PostgreSQL instance. Firebase emulator settings are included only as optional notes because the checked-in app currently assumes the real-project path first.

## Requirements

- Install [Bun](https://bun.sh/docs/installation).
- Create or choose a Firebase project and review the official guides for [Firebase Web setup](https://firebase.google.com/docs/web/setup) and [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup).
- Install PostgreSQL from the official [PostgreSQL downloads page](https://www.postgresql.org/download/) and make sure `psql` is available on your shell `PATH`.
- Review PostgreSQL's official schema docs for [schemas](https://www.postgresql.org/docs/current/ddl-schemas.html) and [`CREATE SCHEMA`](https://www.postgresql.org/docs/18/sql-createschema.html), because this app does not use the default `public` schema.

## 1. Install repo dependencies

Run:

```bash
bun install
```

Verify Bun is available if needed:

```bash
bun --version
```

## 2. Set up Firebase

Festival needs both frontend Firebase web config and backend Firebase Admin credentials.

### 2.1 Create the Firebase project and web app

Use the official [Firebase Web setup guide](https://firebase.google.com/docs/web/setup).

You need these values from the Firebase console for the frontend:
- `FRONT_FIREBASE_API_KEY`
- `FRONT_FIREBASE_AUTH_DOMAIN`
- `FRONT_FIREBASE_PROJECT_ID`
- `FRONT_FIREBASE_APP_ID`

Set `FRONT_API_BASE=http://localhost:3000` for local development so the frontend talks to the backend running on port `3000`.

### 2.2 Enable Authentication providers

Festival uses Google sign-in and passwordless email-link flows. In Firebase Authentication:
- Enable Google as a sign-in provider.
- Enable Email link sign-in.
- Make sure localhost development origins are allowed if Firebase prompts for authorized domains during setup.

### 2.3 Prepare backend Admin credentials

Use the official [Firebase Admin SDK setup guide](https://firebase.google.com/docs/admin/setup).

The backend always needs `FIREBASE_PROJECT_ID`, plus one of these credential paths:
- inline credentials via `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`, or
- `GOOGLE_APPLICATION_CREDENTIALS` pointing at a downloaded service-account JSON file.

If you use `FIREBASE_PRIVATE_KEY` directly, keep it as a single line with escaped newlines (`\n`).

## 3. Set up PostgreSQL

Festival expects:
- a PostgreSQL role that can connect to the app database,
- a database for Festival, and
- a non-`public` schema whose name exactly matches `DB_SCHEMA`.

### 3.1 Bootstrap the role and database

The repo includes [`database/init-user-db.sql`](database/init-user-db.sql) as the bootstrap script for the role and database.

Before you run it:
- edit the placeholder password in `database/init-user-db.sql`,
- confirm the role name and database name match the env values you plan to use.

Example:

```bash
psql -U postgres -f database/init-user-db.sql
```

The checked-in script currently creates:
- role `festivaladmin`
- database `festival_db`

### 3.2 Create the application schema

The backend creates tables inside `${DB_SCHEMA}`, but it does not create the schema itself. Create the schema before starting the backend.

Example using the default local values in the env files:

```bash
psql -U festivaladmin -d festival_db -c 'CREATE SCHEMA IF NOT EXISTS orgs AUTHORIZATION festivaladmin;'
```

If you change `DB_SCHEMA`, change the SQL command to use the same schema name.

This alignment is mandatory:
- `DB_SCHEMA=orgs` means you must create schema `orgs`.
- `DB_SCHEMA=festival_local` means you must create schema `festival_local`.

Do not rely on `public`. The repository explicitly treats the schema as operator-managed.

## 4. Align the env files

Festival uses two repo-root env files during local setup:
- `.env`: your local runtime env file. It is gitignored.
- `develop.env`: the checked-in reference file that documents the expected shape.

Keep both files aligned. `develop.env` should stay as the human-readable reference, and `.env` should contain your working local values.

### Frontend `.env.local`

The frontend is started from `packages/frontend`, so Vite reads frontend env files from that package directory. Keep backend and shared local values in the repo-root `.env`, but add the Vite-exposed frontend values to:

```bash
packages/frontend/.env.local
```

Required values:

```dotenv
FRONT_API_BASE=http://localhost:3000
FRONT_FIREBASE_API_KEY=...
FRONT_FIREBASE_AUTH_DOMAIN=...
FRONT_FIREBASE_PROJECT_ID=...
FRONT_FIREBASE_APP_ID=...
```

Do not rename these to `VITE_*`. This project configures Vite with `envPrefix: "FRONT_"`, so `FRONT_*` variables are intentionally exposed to frontend code.
```

The key point: root `.env` feeds the backend; `packages/frontend/.env.local` feeds Vite/frontend runtime.

### 4.1 Variable walkthrough

#### Environment and local URLs

These values define the local frontend and backend URLs used by the setup contract.

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | Use `development` for local work. |
| `FRONT_APP_URL` | yes | Frontend origin, usually `http://localhost:5173`. |
| `FRONT_API_URL` | yes | Backend origin the frontend expects locally, usually `http://localhost:3000`. |
| `APP_URL` | yes | Backend-facing local app URL kept in the approved env contract. |
| `API_URL` | yes | Backend-facing local API URL kept in the approved env contract. |

#### Database

These values come from your local PostgreSQL install and the bootstrap you ran above.

| Variable | Required | Notes |
| --- | --- | --- |
| `DB_USER` | yes | PostgreSQL role used by the app. |
| `DB_PASSWORD` | yes | Password for `DB_USER`. |
| `DATABASE` | yes | Database name, for example `festival_db`. |
| `DB_HOST` | yes | Usually `localhost`. |
| `DB_PORT` | yes | Usually `5432`. |
| `DB_SSL` | yes | Use `false` for normal local Postgres unless your local setup requires SSL. |
| `DB_SCHEMA` | yes | Must exactly match the non-`public` schema you created. |

#### Frontend runtime

These values come from the Firebase web app configuration. See the official [Firebase Web setup guide](https://firebase.google.com/docs/web/setup).

| Variable | Required | Notes |
| --- | --- | --- |
| `FRONT_API_BASE` | yes for split frontend/backend local dev | Set to `http://localhost:3000` when the frontend runs on `5173` and the backend runs on `3000`. |
| `FRONT_FIREBASE_API_KEY` | yes | Firebase web app API key. |
| `FRONT_FIREBASE_AUTH_DOMAIN` | yes | Usually `<project-id>.firebaseapp.com`. |
| `FRONT_FIREBASE_PROJECT_ID` | yes | Firebase project ID exposed to the web app. |
| `FRONT_FIREBASE_APP_ID` | yes | Firebase web app ID. |

#### Backend Firebase Admin

These values come from the Firebase project and service-account setup. See the official [Firebase Admin SDK setup guide](https://firebase.google.com/docs/admin/setup).

| Variable | Required | Notes |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | yes | Backend project ID for token verification. |
| `FIREBASE_CLIENT_EMAIL` | yes unless you use `GOOGLE_APPLICATION_CREDENTIALS` | Service-account client email. |
| `FIREBASE_PRIVATE_KEY` | yes unless you use `GOOGLE_APPLICATION_CREDENTIALS` | Keep escaped `\n` newlines if stored inline. |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional | Absolute path to a local service-account JSON file if you prefer file-based credentials. |

#### Auth and local dev behavior

These values are part of the approved setup contract for this repo, even though not every one is read directly by the current code paths yet.

| Variable | Required | Notes |
| --- | --- | --- |
| `AUTH_PROVIDER` | yes | Use `firebase` for the current setup path. |
| `AUTH_MODE` | yes | Use `auto_provision` for the current local flow. |
| `AUTH_REQUIRE_EMAIL_VERIFIED` | yes | Use `true` unless you intentionally want a looser local policy. |
| `FIREBASE_AUTH_EMULATOR_HOST` | optional | Dev-only note for teams that also run the Firebase Auth emulator. |
| `FIREBASE_USE_EMULATOR` | optional | Dev-only toggle, default `false` for the primary setup path. |

### 4.2 Example env flow

Use `develop.env` as the reference shape, then copy the values you actually use into `.env`.

The key pattern to preserve is:

```dotenv
# Frontend
FRONT_APP_URL=http://localhost:5173
FRONT_API_URL=http://localhost:3000

# Backend
APP_URL=http://localhost:5173
API_URL=http://localhost:3000
```

The frontend runtime also needs the `FRONT_*` Firebase values, and the backend runtime needs the `DB_*` and `FIREBASE_*` values described above.

## 5. Start the app locally

Start only the backend:

```bash
bun run dev:backend
```

Start only the frontend:

```bash
bun run dev:frontend
```

Start both together:

```bash
bun run dev
```

The backend dev commands default to the repo-root `.env`.

## 6. Optional local production flow

If you want to test the combined production-like flow locally, install `nginx` first, then run:

```bash
bun run prod
```

`bun run prod:backend` starts only the compiled backend.

## 7. Sanity checks

Run the repo verification commands after setup changes:

```bash
bun run format:check
bun run build
bun run test
```

## TODO

//TODO: add a script that scaffolds or syncs the repo-root `.env` from the approved `develop.env` contract without overwriting local secrets.

//TODO: add a script that bootstraps the local PostgreSQL role, database, and required non-`public` schema from the approved env values.
