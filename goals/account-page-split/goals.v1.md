# Goals Extract
- Task name: account-page-split
- Iteration: v1
- State: draft

## Goals

1. Provide separate routable customer-account pages for Memberships, Contact
   Information, and Order History at the requested paths.
2. Preserve the existing behavior of each moved area within its designated page.
3. Direct legacy customer-account URLs to the Memberships destination as specified
   once redirect semantics are confirmed.
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
- [G3] Legacy account URL behavior matches the confirmed redirect requirement.
- [G4] The account navigation group contains the three specified buttons, is
  left-aligned at page top, uses `compact-header-button`, and has 0.5rem gaps.

