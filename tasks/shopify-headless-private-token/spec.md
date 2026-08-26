# Shopify Headless Private Storefront Token

## Goal reference

- `goals/shopify-headless-private-token/goals.v0.md` (locked)

## Scope

### In scope

- Optional Headless private Storefront token field, encrypted persistence, backend Storefront header wiring, tokenless fallback, and security/UI tests.

### Out of scope

- Admin API credentials/OAuth, public Storefront tokens, Shopify password removal, automatic token provisioning, and locked-channel bypass.

## Approach

- Reused the existing tenant-bound Shopify secret keyring and repository integration versioning. Existing integrations without a private token retain tokenless calls.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Added encrypted Headless private-token storage, write-only integration UI/API field, server-side private Storefront header wiring for catalog and diagnostics, tokenless fallback, migration/schema updates, and focused tests.
- Exceptions: Browser visual QA was not run; automated frontend wiring tests pass.
- Deferred work: None.
- Dirty-worktree decision: continue; pre-existing goal/task artifacts were the active task inputs.

## Quality gate results

- Lint: passed (`bun run format:check`)
- Build: passed locally
- Tests: passed locally (30 common, 201 backend, 35 frontend)
- Code review: pending
- Clean merge: pending
