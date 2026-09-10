# Membership checkout failure and purchase flow

## Goal reference

- `goals/membership-checkout-503/goals.v4.md` (locked)

## Scope

- In scope: checkout diagnosis, minimal confirmed checkout correction, safe failure diagnostics, membership purchase form and consent validation, associated tests, Shopify Thank you/Order status return-button extension, authenticated account handoff, and setup documentation. Workspace integration includes the root scripts/lockfile and Docker manifest copies needed for frozen dependency installation.
- Out of scope: unrelated changes, deployment, real payments, weakening authentication or destination validation.

## Approach

- Revised G4: add a small Shopify UI extension with Thank you and Order status targets, per-store Festival organization configuration, safe account URL construction, and no customer data or network capabilities. Keep checkout=processing through any required Festival sign-in. No production changes.

- Inspect saved checkout state and Shopify API responses without exposing customer or credential data; verify Shopify completion capabilities. Implement approved form and validation, and reproduce the confirmed checkout defect in regression tests.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build && bun run --cwd packages/frontend lint`
- Tests: `bun run test`

- Browser: start `bun run --cwd packages/frontend dev --host 127.0.0.1 --port 5178`, then run `NODE_PATH=/Users/eric/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node tasks/membership-checkout-503/verify-browser.cjs`. Requires local Chrome and Playwright. API calls are fully mocked.

- Extension: `bun run --cwd packages/shopify-confirmation build` and `bun run --cwd packages/shopify-confirmation test`; included in root build/test commands. Lint covers the new workspace.

## Delivery

- Delivered: confirmed 503 version-comparison correction; approved three-step form, exact agreement text, required prerequisite validation, Cancel, retry recovery, and regression coverage. Revised G4 adds the Shopify confirmation button extension and preserves checkout processing through reauthentication. See diagnosis.md and packages/shopify-confirmation/README.md.
- Exceptions: live Shopify host rendering cannot be verified until the workspace is linked to the existing app and the extension is deployed/placed in the editor. Local SDK build, native-element renderer tests, and Festival browser handoff checks pass.
- Deferred work: production deployment and Shopify editor activation excluded.
- Dirty-worktree decision: continue; pre-existing untracked `token` is unrelated and will not be read or modified. Goal artifacts and manifest edits belong to this task. Continue on existing branch without committing unrelated files.

## Quality gate results

- Lint: PASS (bun run format:check)
- Build: PASS (bun run build; frontend TypeScript lint)
- Tests: PASS (bun run test; 19 purchase and 8 account-return browser assertions at each of two viewport widths)
- Code review: local review complete; no introduced regression findings. Deployment and Shopify host verification remain external; approved implementation is complete locally.
- Clean merge: not requested

- Supplementary Docker dependency-stage verification was stopped while waiting for the uncached oven/bun:1.3.14-alpine registry lookup. No Docker install/build result is claimed. All workspace manifests are now copied by the Dockerfiles, and the local frozen-lockfile install passed.
