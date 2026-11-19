# Concerto registration repertoire

[Locked goals](../../goals/concerto-registration-362-327/goals.v0.md)

## Scope

Use the existing concerto endpoint for title suggestions in signup and account editing. Store manual pieces and verify links through the shared server validator. Fix repertoire save routing in Orders and expose the festival and class data needed by the editors. Use an isolated checkout of main and a scratch PostgreSQL 17 database.

## Validation commands

- `bun install --frozen-lockfile`
- `bun run format:check`
- `bun run lint`
- `bun run build`
- `bun run --cwd packages/frontend check:types`
- `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`
- `bun run check:sql`
- `bun run test` with `DATABASE_URL` and `POSTGRES_INTEGRATION_URL` pointed at the scratch test database
- `bun run check:schema-parity <scratch-pg-dump-path>` after applying the migrations to the schema snapshot

## Verification results

- Passed frozen dependency install, formatting, lint, production build, frontend and backend type checks, and SQL parameter validation.
- Passed all 2,505 tests with PostgreSQL 17 integration enabled.
- Passed migration and schema parity checks for an upgrade from main and a fresh schema snapshot.
- Verified keyboard selection, manual fallback, multiple pieces, link retention, and Orders save retry in headless Chromium.
- Loaded the 25 PAFE seed works and 100,000 synthetic works across two organizations. At the configured 100-result cap, PostgreSQL execution took 1.6 ms for an exact title, 13.8 ms for a broad title, 1.5 ms for a missing title, and 51.4 ms for a common two-letter fragment. The corresponding legacy plans took approximately 137–141 ms using the legacy 20-result cap.
