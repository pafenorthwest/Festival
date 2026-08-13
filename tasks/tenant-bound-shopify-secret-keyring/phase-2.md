# Phase 2 — Versioned Envelope Model and Strict Parser

## Objective

Define one bounded new ciphertext-envelope format and strict parser containing exactly the issue-required metadata and cryptographic fields.

## Code areas impacted
- `packages/backend/src/shopify/encryption.ts`
- `packages/backend/tests/shopify-encryption.test.ts`

## Work items
- [ ] Select and document an unambiguous deterministic serialization for version, key ID, organization ID, purpose, IV, tag, and ciphertext.
- [ ] Set explicit total-envelope and individual-field bounds before allocating/decoding large data.
- [ ] Require exact field set/types and reject missing, extra, duplicate/ambiguous, truncated, or unsupported-version inputs.
- [ ] Strictly decode canonical Base64 fields and enforce 12-byte IV and 16-byte authentication tag lengths.
- [ ] Validate embedded key ID and fixed purpose syntax without treating embedded organization/purpose as trusted authorization.
- [ ] Reject legacy `v1` without fallback parsing.

## Deliverables
- New envelope serializer/parser contract.
- Structural, bound, encoding, and legacy-rejection tests.

## Gate (must pass before proceeding)
- [ ] Valid envelopes serialize and parse deterministically.
- [ ] Every named malformed/oversized/unsupported case fails with a bounded safe category.
- [ ] Legacy `v1` has no read path.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/shopify-encryption.test.ts`
  - Expected: envelope structure/parser tests pass.

## Risks and mitigations
- Risk: ambiguous delimiter or JSON parsing permits alternate representations.
- Mitigation: canonical serialization, exact-field validation, and round-trip encoding checks.
