# Allow all legitimate Docker frontend and API routes

## Goal reference

- `goals/allow-all-api-routes/goals.v0.md` (locked by the user's implementation request).

## Scope

### In scope

- Expand the Docker nginx explicit API allowlist for the 44 omitted paths and their supported methods; preserve default denial of unknown API paths.
- Preserve existing frontend SPA fallback and public boundary hardening.
- Keep private `/health` and both scheduler reconciliation APIs denied.
- Inventory-based nginx regression coverage and task/goal artifacts.
- A scoped, validated pull request based on current `origin/main`.

### Out of scope

- Host `nginx/festival.conf`, backend authorization, frontend navigation,
  business logic, dependencies, deployments, and unrelated cleanup.

## Approach

- Compare current runtime route declarations with effective Docker nginx
  location precedence and method permissions, expand explicit allowlist coverage, and use the
  complete inventory as a regression gate. Preserve documented private paths.

## Preflight

- Starting branch: `codex/allow-all-api-routes`.
- Starting base: freshly fetched `origin/main` at
  `be77c73189fddcbce1eb00ef94cfcd383ba138cf`.
- Dirty-worktree decision: continue; worktree and index were clean before branch
  creation. No unresolved paths were present.
- Origin fetch succeeded; Git author identity is configured.
- User mandates native PowerShell and prohibits executing `.sh` scripts. No
  `.ps1` helper equivalents exist. Use native PowerShell/Git/GitHub equivalents
  while preserving skill safety checks; do not execute Bash wrappers.
- Explicit user base `main` overrides stale `code_review.base_branch` in the
  repository configuration. No configuration cleanup is in scope.
- Bun 1.4.2 is installed, matching the package manifest.

## Verification commands

- Lint: `bun run lint`
- Build: `bun run build`
- Tests: `bun run test`
- Format: `bun run format:check`
- Focused regression: `bun test packages/backend/tests/nginx-security.test.ts`
- Diff whitespace: `git diff --check`

## Delivery

- State: READY TO LAND.
- Delivered: expanded the Docker nginx explicit allowlist for all 44 omitted
  public API paths and their supported methods. All 132 public method/path
  pairs are permitted across the full 135-pair registered inventory.
- Preserved: private health and both scheduler reconciliation endpoints remain
  denied; unknown APIs remain default-denied; frontend fallback, existing
  hardening, upstream behavior, and the host nginx configuration are unchanged.
- Regression coverage: runtime registrations reconcile with route-security
  declarations, conditional drop/transfer routes are enabled, method and
  location precedence are evaluated, and omitted paths/methods are detected.
- Exceptions: native PowerShell equivalents replace unavailable Bash wrappers
  under the user's explicit shell requirement. The configured owner-token
  environment variable is unavailable, so the authenticated GitHub connector
  handles PR lookup/creation; Git uses its existing credential helper.
- Deferred work: None.
- Remaining delivery at this pre-commit snapshot: commit/push and pull request
  creation are pending; final delivery references will be reported with the PR.

## Quality gate results

- Lint: passed — `bun run lint`; 382 files checked, no fixes.
- Build: passed — `bun run build`.
- Tests: passed — `bun run test`; 1,649 passed, 0 failed, 6,431 assertions.
  Five pre-existing PostgreSQL integration tests were skipped because
  `POSTGRES_INTEGRATION_URL` is absent.
- Format: passed — `bun run format:check`; 382 files checked, no fixes.
- Focused regression: passed — 7 nginx tests and 144 assertions.
- Baseline regression evidence: the original Docker config is detected as
  missing 50 registered method/path pairs, or 70 checks including implicit HEAD.
- Diff whitespace: passed — `git diff --check`.
- Independent code review: passed — no findings, patch is correct, confidence
  0.96; see `tasks/allow-all-api-routes/code-review.md`.
- Native nginx syntax validation: unavailable — no nginx executable is present
  and the Docker daemon is stopped. No tools or images were installed.
- Clean merge with main: passed — fetched `origin/main` at
  `be77c73189fddcbce1eb00ef94cfcd383ba138cf` and ran
  `git merge-tree --write-tree refs/remotes/origin/main codex/allow-all-api-routes`;
  integration is conflict-free and the base is an ancestor (fast-forward).
- Commit and push: pending.
- Pull request: pending.
