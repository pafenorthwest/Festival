# Establish Goals

## Status

- Task name: account-page-split
- Iteration: v2
- State: draft

## Request

- Split the existing customer account page into Memberships, Contact Information,
  and Order History pages under the specified organization account routes. Existing
  account URLs should lead to Memberships.

## Blocking ambiguity

- When an unauthenticated visitor opens an account page, should the page body be
  empty after the shared account navigation, or display a non-actionable message
  such as “Sign in using the header to view your account”? No body-level Log In
  link/button will be rendered.

## Assumptions

- The three requested areas map directly to the current page: membership-status
  content to Memberships, Festival profile form to Contact Information, and Shopify
  orders to Order History.
- No API, authorization, or data-model change is requested.
- The organization landing header already owns the only Log In and Log out actions.

## Goals

1. Provide separate routable customer-account pages for Memberships, Contact
   Information, and Order History at the requested paths.
2. Preserve the existing behavior of each moved area within its designated page.
3. Redirect `/org/:slug/account` and `/org/:slug/account/` to
   `/org/:slug/account/memberships`, preserving query parameters.
4. Render a left-aligned, compact-header-button navigation group at the top of each
   account page, containing Memberships, Contact Information, and Order History
   native buttons with `type="button"`, class `button`, and 0.5rem spacing.
5. Remove body-level Log In and Log out controls from the account pages, leaving
   authentication controls exclusively in the unchanged organization landing header.

## Non-goals

- No changes to customer-account APIs, authorization rules, or stored data.
- No redesign beyond any shared navigation explicitly approved.
- No changes to the organization landing header or its Log In and Log out behavior.

## Success criteria

- [G1] Each requested URL resolves to its designated account area.
- [G2] Existing membership refresh/polling, contact-profile save, and order
  pagination work on their respective pages.
- [G3] Both legacy account URLs redirect to Memberships without losing query
  parameters.
- [G4] The account navigation group contains the three specified buttons, is
  left-aligned at page top, uses `type="button"` and class `button`, and has 0.5rem
  gaps.
- [G5] No account page renders a body-level Log In or Log out control.

## Next action

- Request confirmation of remaining scope decisions.
