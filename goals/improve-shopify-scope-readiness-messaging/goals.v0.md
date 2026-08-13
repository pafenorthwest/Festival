# Goals Extract
- Task name: improve-shopify-scope-readiness-messaging
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Detect missing required Shopify capabilities after valid verification.
2. Show an accessible integrations warning with exact missing scopes and remediation.
3. Make Memberships readiness text/color use the creation prerequisite.
4. Preserve the submit predicate and transient creation behavior.
5. Add tests and pass verification.

## Non-goals

- Authorization, scope derivation, backend, schema, or unrelated UI changes.

## Success criteria

- Warning appears only for verified-but-misaligned integrations.
- Membership badge is gray `Not Ready` exactly when prerequisites block creation.
- Canonical checks pass.
