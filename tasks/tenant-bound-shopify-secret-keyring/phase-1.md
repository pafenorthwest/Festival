# Phase 1 — Keyring Configuration Contract and Validation

## Objective

Parse the two new environment variables into either an absent Shopify keyring or one immutable, fully validated multi-key configuration.

## Code areas impacted
- `packages/backend/src/config/env.ts`
- `packages/backend/src/shopify/encryption.ts` or a focused keyring configuration module
- New/updated backend configuration and encryption tests

## Work items
- [ ] Represent both variables absent as `undefined` keyring configuration so backend startup may continue with Shopify disabled.
- [ ] Reject exactly one variable present before service composition.
- [ ] Parse JSON as a non-null, non-array, non-empty own-property object.
- [ ] Enforce key IDs with `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` and require the active ID to exist.
- [ ] Require string values that are canonical Base64 and decode to exactly 32 bytes.
- [ ] Build an immutable key map without retaining mutable caller-owned objects.
- [ ] Use bounded safe configuration errors that echo no input or key material.

## Deliverables
- Validated optional keyring configuration contract.
- Absent, partial, valid, and named-invalid configuration tests.

## Gate (must pass before proceeding)
- [ ] Both absent succeeds as disabled; partial and every invalid form fail explicitly.
- [ ] Valid multi-key configuration selects exactly one active key and retains all configured keys.
- [ ] No error/captured log contains raw JSON, key IDs from malformed input when unsafe, or encoded/decoded key material.

## Verification steps
- [ ] Command: `bun test packages/backend/tests/shopify-encryption.test.ts`
  - Expected: configuration validation suite passes.
- [ ] Command: `bun run --cwd packages/backend lint`
  - Expected: environment/keyring contracts type-check.

## Risks and mitigations
- Risk: permissive `Buffer.from(..., "base64")` accepts malformed input.
- Mitigation: round-trip canonical validation before accepting decoded bytes.
