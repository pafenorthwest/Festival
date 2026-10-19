# Shared confirmed-entitlement count

Goals: ../../goals/pr300-count-helper/goals.v1.md
Starting commit: 6445fd11f95f23d606207fbe63243d2e93e02e95.
Branch: codex/fix-soft-capacity-cutoff-race; PR #300 targets main.

Scope: one transaction-aware count helper used at checkout attachment, audited capacity update, class-entitlement repository, and membership-commerce repository. Keep attachCart otherwise intact. Preserve four existing unrelated untracked directories.

Validation (native /opt/homebrew/bin/pwsh):
- bun run lint
- bun run format:check
- bun run check:sql
- bun run build:common
- bun run --cwd packages/backend lint
- bun run build:backend
- /opt/homebrew/bin/pwsh -NoProfile -File /private/tmp/festival-pr300-count-helper-validation.ps1 (isolated PostgreSQL schema, full bun run test, finally cleanup).
- Independent code-review skill, native PowerShell equivalent validator.

Implementation: one helper in commerce/postgres-class-entitlement-count.ts used by all four sites. Public repositories retain ensureReady; transactional callers pass their current executor. Tenant/class/status filters and Number conversion remain shared. attachCart otherwise intact.

Runtime validation: all 1,706 PostgreSQL-enabled tests passed (235 common, 1,139 backend, 312 frontend, 20 confirmation), zero failures/skips. New database regression confirms the supplied transaction sees its own uncommitted confirmed placement while a global connection does not, and checks organization/class/status filtering. Temporary schema removed; configured schema retained 66 tables before/after. Logs: /private/tmp/festival-pr300-count-helper-full-tests.log and -db-summary.log.

All six static/build checks passed. Initial formatting check identified import ordering; the source owner sorted imports and final full format check passed. No behavior changes after the full suite. Independent review found no actionable issues. READY TO LAND. No deployment or merge into main. Existing frontend csrfToken typing outside scope.
