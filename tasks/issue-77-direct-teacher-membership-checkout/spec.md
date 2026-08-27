# Direct Teacher Membership Cart and Authenticated Shopify Checkout

## Goal reference

- `goals/issue-77-direct-teacher-membership-checkout/goals.v2.md` (locked)

## Scope

### In scope

- Complete the authenticated direct purchase continuation from #93 with a tenant/customer-scoped, fixed-quantity Teacher Membership cart and Shopify-hosted checkout.
- Reuse the separately encrypted/versioned Headless Storefront configuration, protected Storefront transport, opaque Festival cart persistence, checkout intent correlation, and required checkout UI states.
- Enforce customer-session route classification, CSRF/exact-origin mutation policy, tenant/customer ownership, allowlisted DTOs, trusted buyer identity, no buyer-IP forwarding, and redaction.
- Return only a fresh allowlisted checkout URL and render only `Processing` after browser return.

### Out of scope

- Payment capture, general cart UI, quantities above one, other membership types, gifting, purchases for another customer, division selection, and buyer-IP forwarding.
- Active/processing duplicate-purchase prevention, deferred to #78.
- Checkout-return payment/entitlement decisions and all #78 webhook, order-projection, validation, and entitlement work.

## Approach

- Extend the existing #93 trusted selection boundary and existing Shopify integration/customer-session patterns. Keep authority and secrets server-side. Use the locked 30-minute replace-and-preserve lifecycle and local intent/cart saga; the checkout host must exactly match the tenant's HTTPS `storeDomain`.

## Verification commands

- Lint: `bun run format:check && bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: customer-session checkout BFF wiring, intent-first cart creation, opaque correlation attribute, server-only private Storefront token use, opaque cart persistence, fresh checkout retrieval, exact persisted-store-domain URL validation, and Processing return UI.
- Exceptions: None.
- Deferred work: duplicate-purchase prevention, webhook/order correlation, validation, and entitlement issuance belong to #78; the Shopify cart carries only `festival_checkout_intent_id` as its opaque correlation attribute.
- Dirty-worktree decision: continue; isolate from unrelated `.codex/scripts/gh-auth-check.sh` and `token` changes. The goal/manifest/task artifacts belong to this task.

## Quality gate results

- Lint: passed (`bun run format:check && bun run lint`)
- Build: passed (`bun run build`)
- Tests: passed (`bun run test`)
- Code review: passed (no actionable findings; confidence 0.86)
- Clean merge: pending
