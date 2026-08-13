# Phase 4 — Retained-Key Decryption and Tamper Rejection

## Objective

Decrypt only with the embedded configured key and caller-supplied expected tenant/purpose context while rejecting missing keys, copied envelopes, and all tampering.

## Code areas impacted
- `packages/backend/src/shopify/encryption.ts`
- `packages/backend/tests/shopify-encryption.test.ts`

## Work items
- [ ] Require expected organization ID and fixed purpose on every decrypt call.
- [ ] Compare expected and embedded context safely before/while authenticating the same canonical AAD.
- [ ] Select key material only from the embedded approved key ID.
- [ ] Continue decrypting envelopes written by any retained configured previous key after active-key switching.
- [ ] Fail explicitly for missing referenced key, wrong tenant/purpose, modified metadata, IV/tag/ciphertext tampering, and AES authentication failure.
- [ ] Collapse cryptographic failure details into bounded safe error categories.

## Deliverables
- Tenant-bound retained-key decryption operation.
- Active-switch, prior-key, missing-key, cross-tenant/purpose, and tamper tests.

## Gate (must pass before proceeding)
- [ ] Retained-key envelopes decrypt after active-key change; new writes use only the new active key.
- [ ] Cross-tenant/purpose copying and every modified authenticated field fail.
- [ ] No failure leaks envelope/key/plaintext material.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/shopify-encryption.test.ts`
  - Expected: decryption, switching, and tamper suite passes.

## Risks and mitigations
- Risk: early context mismatch errors create an oracle or echo attacker data.
- Mitigation: fixed safe error classes/messages and no embedded-value interpolation.
