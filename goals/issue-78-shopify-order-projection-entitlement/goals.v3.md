# Goals Extract

- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v3
- State: locked
- Supersedes: `goals.v2.md`

## Goals

The v2 goals remain locked with this precise status-contract amendment:

9. Expose the minimal allowlisted `GET /api/organizations/:slug/customer/membership-status` customer-owned validation/entitlement status contract for #94. It distinguishes non-active processing/rejected/review outcomes from computed active/expired grants and excludes internal IDs, cross-customer data, authority fields, tokens, cart IDs, raw webhook/order payloads, and unnecessary PII.

## Success criteria

The v2 success criteria remain locked with this addition to [G9]: route tests prove customer-session ownership, no browser-controlled filtering, and the exact nginx `GET` allowlist while unrelated routes remain default-denied.
