# Establish Goals

## Status

- Task name: account-page-split
- Iteration: v1
- State: ready-for-confirmation

## Request

- Split the existing customer account page into Memberships, Contact Information,
  and Order History pages under the specified organization account routes. Existing
  account URLs should lead to Memberships.

## Blocking ambiguity

- Confirm that the split should otherwise preserve the current membership polling
  and refresh, profile form and save behavior, order pagination, loading/error
  states, and copy, with no visual changes beyond the shared account buttons.
- Confirm the unauthenticated-body behavior: should each page retain the current
  sign-in prompt, returning to its own URL, while checkout processing returns to
  Memberships? The organization landing header and its Log In behavior remain
  unchanged either way.

## Assumptions

- The three requested areas map directly to the current page: membership-status
  content to Memberships, Festival profile form to Contact Information, and Shopify
  orders to Order History.
- No API, authorization, or data-model change is requested.
- The existing Log out action remains unchanged in the Contact Information area;
  it is not added to the organization landing header or duplicated elsewhere.

## Goals

1. Provide separate routable customer-account pages for Memberships, Contact
   Information, and Order History at the requested paths.
2. Preserve the existing behavior of each moved area within its designated page.
3. Redirect `/org/:slug/account` and `/org/:slug/account/` to
   `/org/:slug/account/memberships`, preserving query parameters.
4. Render a left-aligned, compact-header-button navigation group at the top of each
   account page, containing Memberships, Contact Information, and Order History
   buttons with 0.5rem spacing.

## Non-goals

- No changes to customer-account APIs, authorization rules, or stored data.
- No redesign beyond any shared navigation explicitly approved.
- No changes to the organization landing header, its Log In behavior, or the
  existing Log out action.

## Success criteria

- [G1] Each requested URL resolves to its designated account area.
- [G2] Existing membership refresh/polling, contact-profile save, and order
  pagination work on their respective pages.
- [G3] Both legacy account URLs redirect to Memberships without losing query
  parameters.
- [G4] The account navigation group contains the three specified buttons, is
  left-aligned at page top, uses `compact-header-button`, and has 0.5rem gaps.

## Next action

- Request confirmation of remaining scope decisions.
