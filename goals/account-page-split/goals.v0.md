# Goals Extract
- Task name: account-page-split
- Iteration: v0
- State: blocked

## Goals

1. Provide separate routable customer-account pages for Memberships, Contact
   Information, and Order History at the requested paths.
2. Preserve the existing behavior of each moved area within its designated page.
3. Direct legacy customer-account URLs to the Memberships destination as specified
   once redirect semantics are confirmed.


## Non-goals

- No changes to customer-account APIs, authorization rules, or stored data.
- No redesign beyond any shared navigation explicitly approved.


## Success criteria

- [G1] Each requested URL resolves to its designated account area.
- [G2] Existing membership refresh/polling, contact-profile save, and order
  pagination work on their respective pages.
- [G3] Legacy account URL behavior matches the confirmed redirect requirement.

