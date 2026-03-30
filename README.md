# Festival

Festival is a Bun workspace monorepo for a multi-tenant organization starter built with SolidJS, Hono, Firebase Authentication, and PostgreSQL.

## Workspaces
- `packages/common`: shared organization, membership, invite, and auth contracts.
- `packages/backend`: Hono API server and PostgreSQL/Firebase-backed organization services.
- `packages/frontend`: SolidJS browser app for sign-in, org creation, invite acceptance, and org landing.

## Requirements
- [Bun](https://bun.sh/docs/installation) 1.2.x or newer.
- A Firebase project with a web app plus Firebase Authentication enabled for Google sign-in and email-link sign-in.
- A local PostgreSQL server plus the `psql` CLI.
- A repo-root `.env` file aligned with the checked-in `develop.env` reference.
- `nginx` on `PATH` if you plan to run `bun run prod`.

## Setup

Follow [SETUP.md](SETUP.md) for the full step-by-step setup, including:
- Firebase project and service-account setup.
- PostgreSQL role, database, and schema bootstrap.
- Required env-file values and how they map to the app.
- Local development and production commands.

## Commands
- `bun install`
- `bun run dev:frontend`
- `bun run dev:backend`
- `bun run dev`
- `bun run prod:backend`
- `bun run prod`
- `bun run format:check`
- `bun run build`
- `bun run test`

## Verification
- `bun run format:check`
- `bun run build`
- `bun run test`
