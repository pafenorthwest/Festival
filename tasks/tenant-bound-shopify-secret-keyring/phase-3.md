# Phase 3 — Tenant/Purpose-Bound Active-Key Encryption

## Objective

Encrypt every new Shopify client secret with the active AES-256-GCM key and canonical authenticated context bound to the exact organization and fixed purpose.

## Code areas impacted
- `packages/backend/src/shopify/encryption.ts`
- `packages/backend/tests/shopify-encryption.test.ts`

## Work items
- [ ] Define a closed `shopify-client-secret` purpose constant/type rather than accepting arbitrary browser values.
- [ ] Build canonical AAD from format version, exact organization ID, and fixed purpose with unambiguous length/field encoding.
- [ ] Generate a fresh random 12-byte IV for each encryption.
- [ ] Encrypt with AES-256-GCM using only the configured active key and emit a 16-byte tag.
- [ ] Embed required context and key ID in the new envelope.
- [ ] Reject empty/invalid organization context and impossible keyring states explicitly.
- [ ] Avoid retaining/logging plaintext or intermediate serialized cryptographic state.

## Deliverables
- Active-key tenant-bound encryption operation.
- Round-trip structure, active-key selection, random-IV, and safe-failure tests.

## Gate (must pass before proceeding)
- [ ] New writes always identify/use the active key and meet IV/tag/envelope requirements.
- [ ] Same plaintext/context encryptions use distinct IV/ciphertext output.
- [ ] AAD includes exact version, tenant, and fixed purpose.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/shopify-encryption.test.ts`
  - Expected: active-key encryption tests pass.

## Risks and mitigations
- Risk: concatenated AAD fields collide.
- Mitigation: use a canonical length-delimited or exact structured encoding covered by collision-oriented tests.
