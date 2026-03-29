# Phase 1 — Root Script Foundations

## Objective
Add the root-level service commands for frontend/backend development, combined development, and production backend startup without introducing new dependencies.

## Code areas impacted
- `package.json`
- `packages/backend/package.json` or backend build/start surfaces if required
- small repo-local helper scripts if shell orchestration is clearer there

## Work items
- [x] Add root `dev:frontend` and `dev:backend` scripts that delegate to the existing workspace commands.
- [x] Add a root `dev` script that runs both long-lived development services together using existing shell/Bun capabilities only.
- [x] Add a root `prod:backend` script that runs the backend from built output and performs any required build step explicitly.
- [x] Keep script behavior fail-fast for missing commands or child-process failures.

## Deliverables
- Root package scripts for single-service and combined development startup.
- Root backend production startup flow that runs compiled output.
- Minimal helper scripts in `scripts/run-dev.sh` and `scripts/run-prod.sh` for process lifecycle handling.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] Root `package.json` exposes `dev`, `dev:frontend`, `dev:backend`, and `prod:backend`.
- [x] Backend production startup uses built artifacts rather than watch-mode TypeScript execution.
- [x] No new dependency is introduced for process orchestration.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run build`
  - Expected: backend/common/frontend build succeeds after script/start-surface updates. PASS
- [x] Command: `bun run dev:frontend`
  - Expected: root command delegates to the frontend workspace and reaches Vite startup. PASS for script wiring; full bind smoke test blocked by sandbox `listen EPERM` on `::1:5173`.
- [ ] Command: `bun run dev:backend`
  - Expected: root command delegates to the backend workspace. EVALUATED: deferred; backend startup requires runtime environment variables that are outside the pinned verification contract.

## Risks and mitigations
- Risk:
  - Combined long-running shell orchestration can leak child processes or hide failures.
- Mitigation:
  - Use explicit signal trapping and fail-fast child process handling in the root orchestration path.
