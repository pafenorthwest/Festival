# Goals Extract
- Task name: issue-157-sql-migrations
- Iteration: v1
- State: locked

## Goals

1. #158: Configure local PostgreSQL as `postgres:17-alpine` and use `festival_sepv2_db` consistently in the application and initialization configuration.
2. #159: Replace distributed compatibility and backfill migration logic with one dependency-ordered canonical initializer that creates only the final empty-database PostgreSQL shape, including required extensions, tables, indexes, checks, functions, and triggers.
3. #160: Make application startup and PostgreSQL repositories use the shared initializer exactly once, safely and idempotently, without destructive reset behavior.
4. #161: Add automated fresh-schema/idempotence catalog coverage and a committed normalized schema-only snapshot, including representative organization, festival, customer/child, product, checkout-intent, and entitlement writes.
5. #162: Complete the repository code and automated/documented validation for clean-slate Admin Tool onboarding; document any manual setup and the required manual Admin Tool Shopify Integration Run.
6. #163: Bump the root Festival package to `0.2.0`, align/document workspace versions, update build/version metadata and lockfile as needed, and record the reset and `festival_sepv2_db` breaking change.
7. Create `codex/issue-157-sql-migrations` before implementation and make a separately identifiable Git commit after each completed sub-issue.
8. Open a pull request into `ericp/exp-long-running-agent` whose body explicitly lists the manual Admin Tool Shopify Integration Run as a pre-merge requirement.


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
- [G5] Repository code and automated/documented clean-slate Admin Tool onboarding validation are complete; the PR body lists the manual Admin Tool Shopify Integration Run as required before merge.
- [G6] Package/version and release notes consistently report `0.2.0` and describe the clean-slate database change.
- [G7] Every completed sub-issue has its own commit and `bun run format:check`, `bun run build`, and `bun run test` all pass at final handoff.

