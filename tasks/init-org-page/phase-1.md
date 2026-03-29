# Phase 1 — Shared Contracts and Persistence Foundation

## Objective
Define the organization domain model and build the schema-aware PostgreSQL foundation needed by downstream auth and onboarding flows.

## Code areas impacted
- `packages/common/src/*`
- `packages/backend/src/*`
- `packages/backend/tests/*`
- `package.json`
- `bun.lock`

## Work items
- [x] Add shared organization, membership, invite, and role contracts in `packages/common`.
- [x] Add backend database configuration that assembles the PostgreSQL URL from `.env` and supports an operator-created non-`public` schema.
- [x] Add persistence abstractions and initial schema/migration support for organizations, users, memberships, invites, and first-visit welcome state.
- [x] Add backend tests for schema-aware configuration and persistence boundary behavior.

## Deliverables
- Shared contracts for organization onboarding and tenancy.
- Backend persistence layer that can target a user-created schema without assuming `public`.
- Initial persistence tests covering core org/user/invite entities.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Shared role and tenancy contracts cover the locked organization and invite requirements.
- [x] Database configuration handles explicit schema selection and no-`public` assumptions.
- [x] Persistence primitives exist for organizations, users, memberships, invites, and welcome state.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: shared org/auth contracts and backend persistence/config code type-check cleanly. PASS
- [x] Command: `bun run test`
  - Expected: persistence/config and org route tests pass. PASS

## Risks and mitigations
- Risk:
  - Schema handling can drift into implicit `public` assumptions if configuration is not explicit from the start. Resolved by explicit `DB_SCHEMA` handling and schema-qualified SQL.
- Mitigation:
  - Make schema selection an explicit part of backend configuration and cover it in tests before feature routes are built.
