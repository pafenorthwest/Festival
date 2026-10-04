# Align Shopify Customer Account discovery URL with the pinned API version

## Goal reference

- `goals/align-shopify-discovery-url/goals.v0.md` (locked)

## Scope

### In scope

- Normalize a structurally valid Customer Account GraphQL discovery URL to Festival's pinned `2026-07` API version after the existing discovery safety checks pass.
- Focused Customer Account service tests for newer discovery versions, pinned request URLs, existing pinned discovery behavior, and malformed discovery paths.
- Required task artifacts, validation, commit, push, and a pull request into `main` that closes #267.

### Out of scope

- Adopting `2026-10` or changing Festival's `CUSTOMER_ACCOUNT_API_VERSION`.
- Changes to OAuth credentials, callbacks, scopes, order readiness, or other Shopify API families.
- Relaxing Shopify destination, URL, DNS, TLS, redirect, or response safety controls.

## Approach

- Keep discovery responsible for validating Shopify's current endpoint host and expected Customer Account path shape, then substitute only its API-version segment before caching and using the GraphQL URL.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Customer Account discovery now accepts the real Shopify root or shop/account-prefixed GraphQL path only when it has a supported quarterly version at or after the production pin, no query or fragment, and an unchanged canonical URL. It retains all existing destination checks, preserves the discovered safe prefix, and substitutes only the version segment to `2026-07` before caching and use. Focused coverage verifies the live shop/account form, pinned query URLs, current pinned behavior, and malformed/pre-pin rejection.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — the only uncommitted task artifacts are this task's goal/spec scaffold and its manifest entry. The scaffold also detected the pre-existing tracked `pr-250` task and added its missing manifest row; preserve that integrity update as part of the generated manifest.

## Quality gate results

- Lint: passed — `bun run format:check` (365 files checked; no fixes applied).
- Build: passed — `bun run build` (Bun 1.4.2, TypeScript 5.9.3; common, backend, confirmation, and frontend builds succeeded).
- Tests: passed — `bun run test` (all suites passed; frontend 275 passed, Shopify confirmation 20 passed).
- Code review: passed — no findings; `patch is correct` with 0.97 confidence; `code-review-validate.sh align-shopify-discovery-url validate main` returned `READY`.
- Clean merge: pending
