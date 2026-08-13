# Phase 7 — Adversarial Failure and Redaction Coverage

## Objective

Complete the hostile-input and information-disclosure test matrix across configuration, envelope parsing, crypto operations, service errors, routes, and captured logs.

## Code areas impacted
- `packages/backend/tests/shopify-encryption.test.ts`
- `packages/backend/tests/shopify-integration-service.test.ts`
- `packages/backend/tests/shopify-membership-product-service.test.ts`
- `packages/backend/tests/organization-routes.test.ts`
- Backend safe error/logging code only where tests expose a locked requirement gap

## Work items
- [ ] Cover malformed JSON/shapes/IDs/values/Base64/key lengths and missing active keys.
- [ ] Cover unsupported/legacy versions, oversized/truncated/missing/extra fields, non-canonical encoding, IV/tag length errors, and unavailable embedded keys.
- [ ] Cover wrong tenant/purpose and modifications to metadata, IV, tag, and ciphertext.
- [ ] Seed plaintext, envelope, IV, tag, encoded/decoded key, and raw configuration canaries.
- [ ] Assert canaries are absent from thrown public errors, JSON responses, and captured console/logger output.
- [ ] Confirm impossible states fail explicitly rather than returning undefined, disabling validation, or trying a fallback key.

## Deliverables
- Complete G2/G5/G7/G10 negative/security evidence.

## Gate (must pass before proceeding)
- [ ] Every locked failure class has a deterministic test.
- [ ] Every prohibited material class has a captured-output absence assertion.
- [ ] No test weakens strict parsing or adds legacy fallback to pass.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/shopify-encryption.test.ts packages/backend/tests/shopify-integration-service.test.ts packages/backend/tests/shopify-membership-product-service.test.ts packages/backend/tests/organization-routes.test.ts`
  - Expected: full cryptographic/config/service/route security matrix passes.

## Risks and mitigations
- Risk: testing only error messages misses console output or API serialization.
- Mitigation: capture all available output channels with seeded unique canaries.
