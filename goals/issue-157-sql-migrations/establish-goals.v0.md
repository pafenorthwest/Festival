# Establish Goals

## Status

- Task name: issue-157-sql-migrations
- Iteration: v0
- State: ready-for-confirmation

## Request

- Create a dedicated branch for GitHub issue #157; analyze and consolidate the current PostgreSQL schema and migration code; complete issues #158 through #163 in order, committing after each completed sub-issue; run `bun run format:check`, `bun run build`, and `bun run test`.

## Blocking ambiguity

- Issue #162 requires live Administrator, Firebase, Shopify, and webhook credentials plus a disposable `festival_sepv2_db`. Confirm whether its acceptance criterion means (a) add an automated/on-repository validation and document the live manual steps, or (b) you will provide access and authorize live Shopify/Admin Tool onboarding. Without this, live external onboarding cannot be verified or completed.

## Assumptions

- The dedicated branch will be named `codex/issue-157-sql-migrations`.
- Existing uncommitted changes are absent and pre-existing commits are preserved.
- Each sub-issue may be implemented as one focused commit; all three named validations will run after each behavioral change when feasible and again after the final sub-issue.
- The PostgreSQL 17 integration environment is available locally through the repository's supported Docker setup; if unavailable, its exact blocker will be documented.

## Goals

1. #158: Configure local PostgreSQL as `postgres:17-alpine` and use `festival_sepv2_db` consistently in the application and initialization configuration.
2. #159: Replace distributed compatibility and backfill migration logic with one dependency-ordered canonical initializer that creates only the final empty-database PostgreSQL shape, including required extensions, tables, indexes, checks, functions, and triggers.
3. #160: Make application startup and PostgreSQL repositories use the shared initializer exactly once, safely and idempotently, without destructive reset behavior.
4. #161: Add automated fresh-schema/idempotence catalog coverage and a committed normalized schema-only snapshot, including representative organization, festival, customer/child, product, checkout-intent, and entitlement writes.
5. #162: Add or execute the authorized clean-slate Admin Tool onboarding verification and document any manual setup that cannot be performed in the repository.
6. #163: Bump the root Festival package to `0.2.0`, align/document workspace versions, update build/version metadata and lockfile as needed, and record the reset and `festival_sepv2_db` breaking change.
7. Create `codex/issue-157-sql-migrations` before implementation and make a separately identifiable Git commit after each completed sub-issue.

## Non-goals

- Do not preserve, migrate, backfill, or reset legacy application/user data.
- Do not add foreign keys merely for completeness.
- Do not change independently actionable issues #153, #155, or #156.
- Do not perform live Shopify or Admin Tool actions without explicit authorization and necessary access.

## Success criteria

- [G1] Docker Compose and runtime config reference `postgres:17-alpine` and `festival_sepv2_db`; a new instance initializes the configured schema.
- [G2] A single canonical schema definition is free of transition `ALTER TABLE`, data backfill, and compatibility-migration routines; it creates every read-path table on an empty database in dependency order.
- [G3] Startup and every PostgreSQL repository share an idempotent, concurrent-safe initializer and normal startup leaves existing populated rows untouched.
- [G4] Automated PostgreSQL integration tests initialize an empty schema twice, assert catalogs and representative writes, and validate a checked-in normalized schema-only snapshot.
- [G5] The clean-slate Admin Tool onboarding verification is completed under the agreed authorization model, with any missing supported workflow documented.
- [G6] Package/version and release notes consistently report `0.2.0` and describe the clean-slate database change.
- [G7] Every completed sub-issue has its own commit and `bun run format:check`, `bun run build`, and `bun run test` all pass at final handoff.

## Next action

- Request goal approval; resolve the #162 authorization/validation model before implementation.
