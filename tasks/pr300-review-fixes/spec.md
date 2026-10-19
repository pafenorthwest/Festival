# PR #300 review fixes

Goals: ../../goals/pr300-review-fixes/goals.v1.md
Original PR #300 head: 45edfdebf56d9b37d0418546aa956201bb4f1d9b.
Integrated PR #298 head: a551f1d847873737cf4fc8a3d03b82cc25e5d319.
Branch: codex/fix-soft-capacity-cutoff-race. Base: main.

Preserve the four preexisting untracked goal/task directories. Stage only explicit task files. Native PowerShell is /opt/homebrew/bin/pwsh; no shell scripts executed.

## Validation

- bun run lint
- bun run format:check
- bun run check:sql
- bun run build:common
- bun run --cwd packages/backend lint
- bun run build:backend
- /opt/homebrew/bin/pwsh -NoProfile -File /private/tmp/festival-pr300-review-fixes-validation.ps1 (full bun run test with isolated temporary DB_SCHEMA, DATABASE_URL and POSTGRES_INTEGRATION_URL sourced from DB_CONNECTION as data; finally cleanup).
- Independent code-review skill with native PowerShell equivalent validation.

Existing frontend csrfToken typing issue remains outside scope. No capacity reservations or policy changes. No deployment or merge into main.

## Status

Implementation complete. #298 merged into the PR branch without conflicts; audited in-memory changes hold the shared gate through publication, and PostgreSQL audited updates acquire the advisory gate before row locks. Finalization holds the gate through entitlement creation and rollback using unlocked internal helpers. Persisted checkout lines are evaluated in line_index order.

Final validation: all 1,705 PostgreSQL-enabled tests passed (235 common, 1,138 backend, 312 frontend, 20 confirmation), zero failures or skips. All six static/build commands above passed. Temporary suite schema removed; configured schema retained 66 tables before and after. The first full run exposed stale test failure injection into the old direct creation method; the test now targets the audited persistence boundary and preserves its Shopify cleanup assertions. Rerun passed in full.

Regression coverage: attachment waits for audited capacity publication; attachment cannot observe entitlements later rolled back; an audited PostgreSQL writer waiting on the advisory gate does not hold the class row lock; reversed physical line insertion still returns cutoff failures in line_index order. Independent review found no actionable findings. READY TO LAND.

Raw validation logs are outside the repository at /private/tmp/festival-pr300-review-fixes-full-tests.log and /private/tmp/festival-pr300-review-fixes-checks.json. No deployment or merge into main.
