# Goals Extract
- Task name: fix-admin-membership-product-list
- Iteration: v1
- State: locked

## Goals (1-20, verifiable)

1. Add an authenticated, tenant-resolved, Admin-only GET membership-products endpoint.
2. Use the existing tenant-scoped membership-product listing service and response contract.
3. Preserve denial of public and unauthorized access.
4. Make the Admin frontend loader use the protected endpoint with a Firebase ID token.
5. Let verification status control verified/setup presentation independently while required capabilities continue to gate protected creation.
6. Add regression coverage and pass canonical lint, build, and test verification.

## Non-goals

- Public membership browsing or weakening route authorization.
- Relaxing required Shopify capabilities for protected creation.
- Shopify credential verification, persistence/schema, or unrelated UI changes.

## Success criteria

- Authorized Admin listing returns tenant membership products.
- Unauthenticated/non-Admin Admin requests fail and the public endpoint remains forbidden.
- The Admin frontend uses the authenticated Admin endpoint.
- Verification status `ok` shows `Ready` without setup guidance even when capabilities differ.
- The Create button remains disabled unless required capabilities are granted.
- `bun run format:check`, `bun run build`, and `bun run test` pass.
