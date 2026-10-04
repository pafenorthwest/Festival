# Repository-owned musical repertoire catalog

## Goal reference

- `goals/bootstrap-musical-repertoire-catalog/goals.v3.md`

## Scope

### In scope

- Store the finalized PAFE catalog and its provenance under
  `database/seeds/musical-repertoire/pafe/`.
- Load those files atomically into the active Festival database's `pafe`
  organization with stable IDs and conflict-do-nothing semantics.
- Provide a guarded, developer-only catalog cleanup command that removes only
  rows owned by this loader.
- Delete the source-coupled `run-import.sh` after the replacement is verified.

### Out of scope

- Reading from or writing to the `pafe` database after the seed files exist.
- Schema, migration, checkout, UI, eligibility, registration-snapshot, or
  repertoire-review changes.
- Deleting historical registrations, registration metadata, or review data.

## Design decisions

- The seed is JSON because it is normalized, diffable, and can carry explicit
  source provenance without embedding executable SQL. It contains stable rows,
  joins, counts, exclusions, and canonical aliases, but no target organization
  UUID.
- The loader resolves the `pafe` organization in the active Festival database.
  It validates files before constructing one transaction, takes an advisory
  lock, and never updates a row that already exists.
- Cleanup is deliberately fail-closed. Before it removes loader-owned
  `pafe-bootstrap-*` catalog rows, it checks the target database and resolved
  organization, locks the transaction, and rejects historic references, mixed
  loader/manual joins, or suspicious rows. Catalog joins are removed only via
  catalog-row deletion; snapshots and reviews are never cleared.

## Verification commands

- Focused data/SQL checks: `bun test --cwd packages/backend ../../scripts/music-repertoire.test.ts`
- SQL validation: `bun run check:sql`
- Loader idempotence against the active Festival database:
  `bun run load-music-rep` (run twice).
- Broader project checks: `bun run format:check`, `bun run build`, and
  `bun run test:backend`.

`bun run nuke-music-rep` is intentionally excluded from routine validation: it
is destructive. Its generated SQL and guard conditions are covered by focused
tests instead.

## Delivery and quality gates

- Delivered: repository-owned seed files, `bun run load-music-rep`, guarded
  `bun run nuke-music-rep`, focused tests, documentation, and removal of the
  source-coupled importer.
- Focused tests: passed — 4 tests cover seed closure/counts, malformed links,
  transactional load SQL, and catalog-only cleanup guards.
- Live loader: passed — two no-op loads against the local Festival database;
  each completed its transaction with five `INSERT 0 0` results.
- SQL check: blocked by the existing local TypeScript runtime mismatch:
  `TypeScript.sys` is unavailable to `scripts/check-sql.ts`.
- Format check: blocked by five pre-existing package errors and 18 warnings in
  unrelated package files. The command only checks `packages/`, not this seed
  or script.
- Cleanup command: intentionally not executed because it is destructive.
