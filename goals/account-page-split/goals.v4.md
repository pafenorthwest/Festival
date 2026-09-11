# Goals Extract
- Task name: account-page-split
- Iteration: v4
- State: locked

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
6. Show a non-actionable message in each unauthenticated account page body.
7. Apply `type="button"` and class `button` to every account-page body button.


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
- [G6] Each unauthenticated account page shows a non-actionable message and no
  account data.
- [G7] Every button in an account page body has `type="button"` and class
  `button`.

