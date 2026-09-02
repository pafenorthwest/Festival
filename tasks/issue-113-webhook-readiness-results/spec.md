# Separate webhook readiness from Shopify store verification

## Goal reference

- `goals/issue-113-webhook-readiness-results/goals.v0.md` (locked)

## Scope

### In scope

- Shared typed webhook readiness and diagnostic results.
- Independent readiness persistence and transitions.
- Safe webhook failure classification and request-ID retention.
- Save & Test, diagnostics, and Admin Integration UI separation.
- Focused contract, repository, service, route, and frontend tests.

### Out of scope

- Manual webhooks, generic webhook management, live-store remediation, and any
  commerce, entitlement, checkout, or customer-facing behavior.

## Approach

1. Add the closed readiness contract and repository update boundary.
2. Persist `checking` before reconciliation and `ready`/`failed` afterward;
   integration credential/shop rotation resets readiness to `unknown`.
3. Preserve Shopify error categories/request IDs through the webhook service and
   map only allowlisted failure messages to public responses.
4. Split Save & Test's credential verification catch boundary from webhook
   reconciliation and return the webhook result without changing verified store
   state.
5. Make diagnostics collect webhook and Storefront results independently.
6. Render both results separately and test all required states and redaction.

## Verification commands

- Format and lint: `bun run format:check && bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery gate

- Do not declare #113 complete until every locked behavior is implemented and
  all pinned commands pass or an explicit blocker is recorded.
