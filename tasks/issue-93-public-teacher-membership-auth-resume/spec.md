# Public Teacher Membership Listing and Authentication Resume

## Goal reference

- `goals/issue-93-public-teacher-membership-auth-resume/goals.v0.md` (locked)

## Scope

### In scope

- Restore the explicitly public, read-only Teacher Membership listing API and its allowlisted current Shopify DTO.
- Add the public Teacher Membership presentation, Purchase entry, explicit unavailable/error states, and authenticated/anonymous branching.
- Add tenant-bound, integrity-protected authentication resume state for one opaque local offering selection and an Organization-relative destination.
- Resume only the trusted server-resolved selection into the issue #77 boundary; deny anonymous commerce mutations and invalid resume state.
- Add focused common, backend, frontend, route-policy, and proxy-policy tests required by the locked success criteria.

### Out of scope

- Cart creation or mutation, checkout orchestration/return handling, order validation, and entitlement issuance.
- Accompanist or unrelated product listings and a general public product catalog.
- Changes to the established customer identity/session or Teacher Membership offering domain beyond the minimal contracts needed here.
- Stale/local price fallback.

## Approach

- Reuse the existing tenant-resolved offering, live Shopify product lookup, and Customer Account session/state mechanisms; introduce only the public DTO and opaque local resume selection required at their boundary.
- Keep Shopify identifiers and credentials server-side, make invalid/unavailable external states explicit, and exercise the public route and UI through focused tests.

## Verification commands

- Lint: `bun run format:check && bun run lint`
- Build: `bun run build`
- Tests: `bun run test`

## Delivery

- Delivered: Explicit public `GET`/`HEAD` Teacher Membership listing; credential-free tokenless Shopify catalog read with bounded current DTO and no-store policy; active/unavailable/error frontend states and Purchase control; anonymous Customer Account authentication start; one-time tenant-bound local-offering resume; authenticated direct continuation boundary; safe OAuth-denial return; callback and continuation revalidation; proxy/security inventory updates; focused frontend/backend/security coverage.
- Exceptions: None
- Deferred work: Issue #77 owns cart creation, checkout mutation, and the purchase continuation after the validated local selection returned here.
- Dirty-worktree decision: continue; preflight found only the goal and task artifacts created for this issue on `ericp/teacher-membership-flow`.

## Quality gate results

- Lint: passed — `bun run format:check && bun run lint`
- Build: passed — `bun run build`
- Tests: passed — `bun run test` (30 common, 192 backend, and 33 frontend tests)
- Code review: pending
- Clean merge: pending
