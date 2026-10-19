# Soft capacity cutoff race fix

Locked goals: ../../goals/fix-soft-capacity-cutoff-race/goals.v1.md
Base: main at 5c8dd582d18861926956f46bc376b0345fc4855e
Branch: codex/fix-soft-capacity-cutoff-race

## Scope
Coordinate final checkout admission and durable attachment with capacity updates and paid placement writes. Preserve soft capacity and grandfathered attached carts. Add focused regression tests and full PostgreSQL verification.

Excluded: unrelated frontend csrfToken error, old review reports, secrets, benchmarks, merging and deployment.

## Worktree decision
Continue in current checkout on new branch. Initially clean tracked files; preserve and exclude pre-existing untracked tasks/review-be77c731-to-head/.

## Pinned validation
All commands run from repository root in native PowerShell. Environment file parsed as data; never printed or staged. Full suite uses a dedicated temporary schema with finally cleanup; configured schema is inspected read-only.

- Lint: bun run lint
- Format: bun run format:check
- SQL: bun run check:sql
- Backend types: bun run --cwd packages/backend lint
- Build common: bun run build:common
- Build backend: bun run build:backend
- Full PostgreSQL suite: /usr/local/bin/pwsh -NoProfile -File /private/tmp/festival-cutoff-validation.ps1 (runs bun run test with DATABASE_URL and POSTGRES_INTEGRATION_URL from DB_CONNECTION and temporary DB_SCHEMA).
- Independent review: code-review skill against pinned main base and final working diff.

## Known validation exception
Unchanged pre-existing frontend TS2339 on customerSession().csrfToken at FestivalClassRegistrationPage.tsx:52 is excluded from this backend fix. Separate PR #299 addresses it. Full repository test suite still required.

## Execution
Production source ownership: cutoff_implementation. Test ownership: cutoff_tests. Git, goal/spec and final verification ownership: cutoff_validation_publish. Parent integrates and performs final review gate.

Shell helper scripts inspected where applicable and translated to native PowerShell equivalents per AGENTS.md; no shell scripts executed.

## Results
Implementation delivered. Full PostgreSQL suite: 1,698 passed, zero failures/skips. Lint, format, SQL, backend types, common build and backend build passed. See validation.md. Migration upgrade regression passed. Independent review: correct, no findings. READY TO LAND.
