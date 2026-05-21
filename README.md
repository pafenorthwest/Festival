# Festival Software

Festival Software is a purpose-built platform designed to support the full lifecycle of a performing arts festival—from registration and payments to scheduling and event execution.

The system is engineered to replace legacy tools that fail under load, lack flexibility, and create operational friction during peak registration periods.

See [Detailed Roadmap](./specs/ROADMAP-2026.md) and [Sidequests](./specs/SIDEQUESTS-2026.md) for more detailed work breakdown.

## Core Approach

This platform is built around a **clear separation of responsibilities**:

* **Shopify** handles payments, checkout, and customer identity for families
* **Local Application** manages festival-specific logic, including registrations, metadata, scheduling, and capacity
* **Firebase** supports internal authentication for administrators and staff

This architecture ensures reliability, scalability, and flexibility while leveraging proven external systems where appropriate.

## Key Capabilities

* **Multi-Tenant Organization Management**
  Support for multiple festivals or organizations with strict data isolation and role-based access control
* **Memberships & Payments (Shopify Integration)**
  Memberships and class registrations are purchased through Shopify, ensuring a stable and familiar checkout experience
* **Class Registration & Entitlements**
  Registrations are modeled as entitlements, with rich metadata captured locally (performer details, repertoire, age group)
* **Capacity Management & Waitlists**
  The system enforces class limits, manages waitlists, and ensures fairness during high-demand registration periods
* **High-Performance Registration**
  Designed to handle peak load scenarios (target: 500+ requests/second) without degradation
* **Scheduling & Venue Management**
  Tools to assign performers to rooms and time slots, supporting real-world festival logistics

## Design Principles

* **Own the Critical Logic**
  Inventory, scheduling, and fairness are controlled locally—not delegated to third-party systems
* **Asynchronous by Default**
  Shopify webhooks drive state changes; all integrations are idempotent and replayable
* **Separation of Identity Domains**
  Families authenticate via Shopify; administrators via Firebase
* **Operational Resilience**
  The system is designed to tolerate inconsistencies and includes reconciliation paths between systems


## Roadmap Overview

![Roadmap Timeline 2026](./specs/festival-software-timeline-2026.png)

* **Foundation & Multi-Tenant Core** — Establish authentication, organizations, and data model
* **Memberships & Shopify Integration** — Enable payments and external identity
* **Class Registration & Entitlements** — Capture structured registration data
* **Smart Cart, Capacity & Waitlists** — Enforce limits and fairness
* **Performance & Scale Readiness** — Validate system under load
* **Scheduling & Venue Management** — Support event execution



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

## Docker Compose

This repository now includes Docker Compose support for local service orchestration.

### Images built by this repository
- Core stack: `2` custom images
  - `festival-backend:local`
  - `festival-frontend:local`
- Mock-auth stack: `3` custom images
  - `festival-backend:local`
  - `festival-frontend:local`
  - `festival-firebase-emulator:local`

PostgreSQL uses the upstream image `postgres:16-alpine` (pulled, not built).

### Run core stack (backend + frontend + postgres)

```bash
docker compose up --build
```

Services:
- frontend: http://localhost:8080
- backend API: http://localhost:3000
- postgres: localhost:5432

### Run with Firebase Auth emulator mock

```bash
docker compose -f docker-compose.yml -f docker-compose.mock.yml up --build
```

Additional mock services:
- Firebase Auth emulator: http://localhost:9099
- Firebase Emulator UI: http://localhost:4000

Notes:
- The backend points to the auth emulator via `FIREBASE_AUTH_EMULATOR_HOST=firebase-emulator:9099` in `docker-compose.mock.yml`.
- The frontend uses `FRONT_FIREBASE_AUTH_EMULATOR_URL=http://localhost:9099` in the same override file.

## Verification
- `bun run format:check`
- `bun run build`
- `bun run test`
