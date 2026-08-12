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

### 3.3 Apply table setup and updates

There is not a separate migration script for table changes right now. After the role, database, and schema exist, start the backend:

```bash
bun run dev:backend
```

Backend startup creates and updates the tables inside `DB_SCHEMA`. In the current backend flow, `createApp()` calls `repository.ensureReady()`, and `packages/backend/src/repo/postgres-organization-repository.ts` runs the `CREATE TABLE IF NOT EXISTS ...` and `ALTER TABLE ...` setup.

The schema name must match your `.env` exactly:

```dotenv
DB_SCHEMA=orgs
```

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
| `FRONT_PUBLIC_ORIGIN` | optional | Public HTTP(S) origin used to derive Vite's allowed host and HMR WebSocket endpoint when nginx fronts the development server. Leave unset for ordinary localhost development. |
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

#### Backend encryption

The backend encrypts stored integration secrets before writing them to PostgreSQL. Local and deployed environments must provide an AES-256 key as Base64.

Generate a new key with:

```bash
openssl rand -base64 32
```

Then set the generated value in the repo-root `.env`:

```dotenv
AES_ENCRYPTION_KEY=replace-with-generated-base64-key
```

`AES_ENCRYPTION_KEY` must decode to exactly 32 bytes. Do not commit the generated value.

#### Shopify Dev Dashboard app

Festival uses Shopify's Dev Dashboard app install plus client credentials grant for backend Admin API access.

In the Shopify Dev Dashboard:
- Configure scopes in the app version, for example `read_orders,read_products,write_products`.
- Release the version.
- Install the app on the target store from the app Home tab.

In Festival's organization admin page, enter the store's `*.myshopify.com` domain plus the app Client ID and Client secret. The backend requests short-lived Shopify access tokens as needed and does not persist those tokens.

#### Auth and local dev behavior

These values are part of the approved setup contract for this repo, even though not every one is read directly by the current code paths yet.

| Variable | Required | Notes |
| --- | --- | --- |
| `AUTH_PROVIDER` | yes | Use `firebase` for the current setup path. |
| `AUTH_MODE` | yes | Use `auto_provision` for the current local flow. |
| `AUTH_REQUIRE_EMAIL_VERIFIED` | yes | Use `true` unless you intentionally want a looser local policy. |
| `FIREBASE_AUTH_EMULATOR_HOST` | optional | Leave commented out unless both frontend and backend are intentionally using the Firebase Auth emulator. If this variable is present while using real Firebase Auth, the backend Admin SDK can reject real ID tokens with invalid-signature errors. |
| `FIREBASE_USE_EMULATOR` | optional | Dev-only toggle, default `false` for the primary setup path. |

For the primary local setup path with a real Firebase project, make sure the backend `.env` does not define `FIREBASE_AUTH_EMULATOR_HOST`:

```dotenv
# Keep this commented out unless you are running Firebase Auth emulator end-to-end.
# FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
FIREBASE_USE_EMULATOR=false
```

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

For database setup, this backend startup step is also the current table migration/update step. Make sure the schema named by `DB_SCHEMA` already exists before running it.

## 6. Run with Docker Compose

Docker Compose runs the backend, frontend, and PostgreSQL together. You can run either:
- the core stack (real Firebase configuration path), or
- the mock-auth stack (Firebase Auth emulator).

### 6.1 Prerequisites for Docker flow

- Install Docker Engine and Docker Compose v2 (`docker compose`).
- Confirm Docker is running:

```bash
docker compose version
```

- From the repository root, make sure `.env` exists (you can copy structure from `develop.env`).

For the core stack, set real Firebase values in `.env`:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (or `GOOGLE_APPLICATION_CREDENTIALS`)
- frontend `FRONT_FIREBASE_*` values

For the mock-auth stack, real Firebase secrets are not required because the override file injects demo/emulator values.

### 6.2 Start the core stack

From the repo root:

```bash
docker compose up --build
```

Services and ports:
- frontend (nginx): `http://localhost:8080`
- backend API: `http://localhost:3000`
- postgres: `localhost:5432`

What this command does:
- builds `festival-backend:local` and `festival-frontend:local`
- pulls `postgres:16-alpine`
- starts services in dependency order

When finished, stop with:

```bash
docker compose down
```

If you need a full reset of PostgreSQL volume data:

```bash
docker compose down -v
```

### 6.3 Start the stack with Firebase Auth emulator (mock service)

Use the mock override file together with the base compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.mock.yml up --build
```

Do not run `docker-compose.mock.yml` by itself.

Additional mock services and ports:
- Firebase Auth emulator: `http://localhost:9099`
- Firebase Emulator UI: `http://localhost:4000`

In mock mode:
- backend uses `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099`
- frontend build injects `FRONT_FIREBASE_AUTH_EMULATOR_URL=http://localhost:9099`

Stop mock mode with:

```bash
docker compose -f docker-compose.yml -f docker-compose.mock.yml down
```

### 6.4 Useful Docker troubleshooting commands

Check service status:

```bash
docker compose ps
```

Tail logs for all services:

```bash
docker compose logs -f
```

Tail backend logs only:

```bash
docker compose logs -f backend
```

Rebuild images after Dockerfile or frontend build-arg changes:

```bash
docker compose build --no-cache
```

## 7. Optional local production flow

If you want to test the combined production-like flow locally, install `nginx` first, then run:

```bash
bun run prod
```

`bun run prod:backend` starts only the compiled backend.

### 7.1 Reverse proxy a public HTTPS host to the Vite development server

The production frontend is normally built and served as static files. If a
public HTTPS hostname temporarily fronts the Vite development server instead,
nginx must proxy both HTTP requests and Vite's hot-module-reload WebSocket.

In `packages/frontend/.env.local`, set the public origin and keep browser API
calls on that same origin so they follow the reverse-proxy boundary:

```dotenv
FRONT_PUBLIC_ORIGIN=https://festival.example
FRONT_API_BASE=
```

`FRONT_PUBLIC_ORIGIN` must contain only an HTTP(S) origin: scheme, hostname,
and an optional port, with no path. The Vite configuration derives
`allowedHosts`, the `ws` or `wss` HMR protocol, hostname, and browser-facing
port from this value. For example, an HTTPS origin without an explicit port
uses secure WebSockets on port `443`. Leave the variable unset for ordinary
localhost development.

Vite reads these values when it starts, so restart the frontend after changing
them. A `FRONT_API_BASE` value such as `http://localhost:3000` makes a remotely
loaded browser call that browser's own loopback address and results in
mixed-content or CORS failures.

In nginx's `http` context, map WebSocket upgrade requests to the appropriate
connection value:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

Then add a location like the following inside the HTTPS `server` block for the
public Festival hostname:

```nginx
location / {
    # Use 127.0.0.1 when nginx and Vite run on the same host. If they run on
    # separate hosts, replace it with the Vite host's actual private address.
    set $frontend_upstream http://127.0.0.1:5173;

    proxy_pass $frontend_upstream;
    proxy_http_version 1.1;

    # Preserve the public-facing hostname, protocol, and client address.
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Host  $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port  $server_port;
    proxy_set_header X-Real-IP          $remote_addr;
    proxy_set_header X-Forwarded-For    $proxy_add_x_forwarded_for;

    # Forward Vite hot-module-reload WebSocket connections.
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    # Allow Firebase's cross-origin sign-in popup to report that it closed.
    add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;

    # Optional: rewrite an absolute redirect from the private Vite upstream.
    proxy_redirect http://127.0.0.1:5173/ https://$host/;
}
```

Do not use a CIDR network address such as `10.0.0.0` as the upstream unless it
is actually assigned to the Vite host. Use that host's concrete address.

The environment-derived HMR client port is the browser-facing port, not Vite's
private port `5173`. After changing nginx, validate and reload it, then restart
Vite:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 8. Sanity checks

Run the repo verification commands after setup changes:

```bash
bun run format:check
bun run build
bun run test
```

## TODO

//TODO: add a script that scaffolds or syncs the repo-root `.env` from the approved `develop.env` contract without overwriting local secrets.

//TODO: add a script that bootstraps the local PostgreSQL role, database, and required non-`public` schema from the approved env values.
