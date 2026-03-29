# Festival

Festival is a Bun workspace monorepo for a multi-tenant organization starter built with SolidJS, Hono, Firebase Authentication, and PostgreSQL.

## Workspaces
- `packages/common`: shared organization, membership, invite, and auth contracts.
- `packages/backend`: Hono API server and PostgreSQL/Firebase-backed organization services.
- `packages/frontend`: SolidJS browser app for sign-in, org creation, invite acceptance, and org landing.

## Commands
- `bun install`
- `bun run dev:frontend`
- `bun run dev:backend`
- `bun run dev`
- `bun run prod:backend`
- `bun run prod`
- `bun run lint`
- `bun run build`
- `bun run test`

## Local development
1. Install dependencies with `bun install`.
2. Start only the backend with `bun run dev:backend`.
3. Start only the frontend with `bun run dev:frontend`.
4. Start both services together with `bun run dev`.

The default backend port is `3000`. Set `VITE_API_BASE` in the frontend if the API is served from a different origin during development.

## Local production
1. Start only the compiled backend with `bun run prod:backend`.
2. Start the full production flow with `bun run prod`.

`bun run prod` builds the workspace, starts the backend on `http://localhost:3000`, and serves the frontend build through nginx on `http://localhost:8080` using [`nginx/festival.conf`](nginx/festival.conf). The checked-in nginx config serves `packages/frontend/dist`, applies SPA fallback to `index.html`, and proxies `/api` requests to the backend on port `3000`.

The combined production command expects a local `nginx` binary to be installed and available on `PATH`.

## Environment

### Backend
- `PORT` optional; defaults to `3000`.
- `DB_USER`
- `DB_PASSWORD`
- `DB_HOST`
- `DB_PORT`
- `DATABASE`
- `DB_SSL` optional; truthy values map to `sslmode=require`, otherwise `sslmode=disable`.
- `DB_SCHEMA` required. The database user is expected to create and manage its own schema. There is no default schema assumption, and there is no `public` schema requirement.
- `FIREBASE_PROJECT_ID` required for Firebase token verification.
- `FIREBASE_CLIENT_EMAIL` optional when using explicit Firebase Admin service-account credentials.
- `FIREBASE_PRIVATE_KEY` optional when using explicit Firebase Admin service-account credentials.

The backend assembles its PostgreSQL connection string from the `DB_*` variables at runtime.

### Frontend
- `VITE_API_BASE` optional; defaults to the current origin.
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

The frontend uses Google sign-in and passwordless email-link authentication through Firebase.

## Testing

`bun run test` is designed to run in an isolated environment. The current backend tests use in-memory repositories and fake auth verifiers, so they do not require a live PostgreSQL instance or Firebase project.
