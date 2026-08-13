# Phase 5 — Shopify Service Context Binding

## Objective

Update existing Shopify integration and membership-product service consumers to pass resolved server-side organization context and the fixed purpose for every secret encryption/decryption.

## Code areas impacted
- `packages/backend/src/shopify/shopify-integration-service.ts`
- `packages/backend/src/shopify/shopify-membership-product-service.ts`
- Shopify encryption interface/types
- `packages/backend/tests/shopify-integration-service.test.ts`
- `packages/backend/tests/shopify-membership-product-service.test.ts`
- Relevant route tests

## Work items
- [ ] Replace `AesSecretEncryptor` call shapes with the tenant-bound keyring interface.
- [ ] Encrypt newly supplied secrets with `tenant.organization.id` and fixed purpose.
- [ ] Decrypt retained existing secrets using the same tenant organization and purpose.
- [ ] Decrypt membership-product credentials using the integration record/request organization's exact ID and fixed purpose.
- [ ] Add cross-tenant ciphertext-substitution tests proving decryption fails before Shopify transport.
- [ ] Preserve existing save/test, keep-blank-secret, verified-integration, and product behaviors without adding #75 rotation/cache work.

## Deliverables
- Organization-bound encryption/decryption at all current Shopify secret call sites.
- Integration/product service regression and substitution tests.

## Gate (must pass before proceeding)
- [ ] Every current encrypt/decrypt call supplies resolved organization context and fixed purpose.
- [ ] Cross-tenant substituted ciphertext fails before credentials reach a Shopify client.
- [ ] Existing service success/failure behavior remains covered.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/shopify-integration-service.test.ts packages/backend/tests/shopify-membership-product-service.test.ts packages/backend/tests/organization-routes.test.ts`
  - Expected: tenant binding and existing Shopify service/route tests pass.

## Risks and mitigations
- Risk: a caller uses a body-supplied organization ID.
- Mitigation: accept only resolved tenant/repository organization context already enforced by route/service boundaries.
