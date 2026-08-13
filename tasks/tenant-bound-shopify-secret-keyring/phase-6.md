# Phase 6 — Application Composition and Optional Shopify Startup

## Objective

Construct one validated immutable keyring at backend startup, share it across Shopify services, and enforce the approved absent/partial/invalid configuration behavior.

## Code areas impacted
- `packages/backend/src/config/env.ts`
- `packages/backend/src/app.ts`
- `packages/backend/src/routes/api-router.ts`
- Backend app/config/route tests

## Work items
- [ ] Replace `aesEncryptionKey` runtime configuration with the two new keyring inputs/configuration result.
- [ ] Construct one keyring instance and share it across integration/product services.
- [ ] With both variables absent, construct no Shopify services while allowing non-Shopify backend startup.
- [ ] With partial/invalid configuration, fail during environment/application startup before accepting requests.
- [ ] Replace legacy `AES_ENCRYPTION_KEY is required` route messages with bounded configuration-unavailable behavior consistent with existing APIs.
- [ ] Remove all Shopify runtime reads of `AES_ENCRYPTION_KEY`.
- [ ] Keep unrelated auth/database configuration behavior unchanged.

## Deliverables
- Approved startup/composition semantics.
- Disabled, partial, invalid, and valid application tests.

## Gate (must pass before proceeding)
- [ ] Both absent starts non-Shopify routes and keeps Shopify unavailable.
- [ ] Partial/invalid configuration prevents startup; valid configuration enables current Shopify services.
- [ ] Runtime code has no Shopify dependence on `AES_ENCRYPTION_KEY`.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/organization-routes.test.ts packages/backend/tests/auth-routes.test.ts`
  - Expected: composition/startup and existing route behavior pass.
- [ ] Command: `bun run --cwd packages/backend lint`
  - Expected: application and environment contracts type-check.

## Risks and mitigations
- Risk: env parsing is bypassed by test-injected `AppEnv` objects.
- Mitigation: validate at the composition/keyring boundary as well as process-env loading and provide explicit typed test fixtures.
