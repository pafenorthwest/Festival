# Configure a local Shopify mutation-audit path

## Goal reference

- `goals/configurable-shopify-audit-path/goals.v0.md` (locked)

## Scope

### In scope

- A validated backend-only environment override for the Shopify mutation-audit file, defaulting to the existing production destination.
- Application wiring and focused configuration tests.
- Documentation in `develop.env` and `SETUP.md` for a user-writable development file.

### Out of scope

- Production default-path, Docker deployment, audit schema, Shopify mutation, credential, or scope changes.
- Automatic creation of the production audit directory.

## Approach

- Parse a non-empty absolute environment path into `AppEnv`, pass it to the existing file audit writer, and otherwise preserve its existing default. Document a concrete `/tmp` development value, whose parent already exists and requires no elevated permissions.

## Verification commands

- Lint: `bun run format:check`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: `SHOPIFY_ADMIN_AUDIT_PATH` resolves to the existing production default when unset or blank, requires a non-NUL absolute path otherwise, and is injected into the file-backed Shopify mutation audit writer. `develop.env` and `SETUP.md` document the non-privileged `/tmp` local configuration while retaining the production provisioning contract.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — the only uncommitted changes are this task's scaffold and manifest entry created by the required workflow.

## Quality gate results

- Lint: passed — `bun run lint:backend` and Biome check of changed backend files.
- Build: passed — `bun run build:backend`.
- Tests: passed — focused `bun test packages/backend/tests/config-env.test.ts` (4/4) and `bun run test:backend` (997 passed; 5 existing integration skips).
- Code review: passed — scoped implementation review found no issues.
- Clean merge: not run — no branch, commit, or pull request was requested.
