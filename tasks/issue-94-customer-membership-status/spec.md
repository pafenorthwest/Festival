# Customer Membership Status on Account

## Goal reference

- `goals/issue-94-customer-membership-status/goals.v0.md` (locked)

## Scope

### In scope

- A typed frontend client for the existing customer-session membership-status GET endpoint.
- A separate Festival memberships Account section with complete status presentation and grant snapshot details.
- Independent loading/error state, manual refresh, and single-flight five-second polling bounded to 60 seconds.
- Pure presentation and polling-policy helpers plus focused frontend tests and accessible status styling.

### Out of scope

- Any backend, schema, shared DTO, checkout, Shopify order-history, validation, or entitlement mutation.
- Internal identifiers, raw reason codes, secrets, raw Shopify data, or unnecessary customer data in the UI.

## Approach

1. Add the typed API helper and pure status presentation/polling policy module.
2. Load membership status only after the customer session authenticates, independently from profile and order data.
3. Render Festival state before separately labeled Shopify order history, with safe formatting and explicit non-active/exclusive-end language.
4. Use recursive timeouts after completed requests to prevent overlap; preserve a checkout-return baseline and clean up on terminal transition, error, timeout, or unmount.
5. Test the API boundary, every view model, polling decisions and Account integration/privacy wiring.

## Verification commands

- Format and lint: `bun run format:check && bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery gate

- Do not declare #94 complete until all locked behavior is implemented and every pinned verification command passes or an explicit blocker is recorded.

## Delivery

- Delivered: Typed customer membership-status client; independent Festival memberships Account section; complete processing/rejected/review/active/expired and loading/empty/failure presentation; exact grant snapshot details; safe currency and calendar-date presentation; manual refresh; single-flight five-second polling bounded to 60 seconds; checkout baseline/terminal query cleanup; accessible responsive status cards; focused API, presentation, polling, privacy, and integration coverage.
- Exceptions: None.
- Deferred work: None within #94.

## Quality gate results

- Format and lint: passed — `bun run format:check && bun run lint`.
- Build: passed — `bun run build`.
- Tests: passed — `bun run test` (30 common, 240 backend, and 45 frontend tests).
- Code review: passed with no findings.
