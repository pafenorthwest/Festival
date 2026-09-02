# Establish Goals

## Status

- Task name: issue-78-shopify-order-projection-entitlement
- Iteration: v3
- State: locked
- Supersedes: `establish-goals.v2.md` / `goals.v2.md`

## Locked amendment

- The minimal #94 handoff is a customer-session-authenticated, ownership-enforced `GET /api/organizations/:slug/customer/membership-status` endpoint returning `CustomerMembershipStatusResponse`. It is an exact default-deny nginx `GET` allowlist entry with the other customer reads. It has no filtering, identifiers, Shopify payloads, tokens, raw order data, or cross-customer access, and adds no Account-page UI, polling, or refresh behavior.
- All v2 goals, non-goals, decisions, and success criteria remain unchanged except that their customer-status contract is this exact route as well as the shared DTO.

## Next action

- Implement only the v3-locked specification and run the pinned verification commands.
