# Goals Extract
- Task name: organization-side-navigation
- Iteration: v2
- State: locked

## Goals

1. Add an additive left sidebar to `/org/:slug`, `/org/:slug/membership`, and `/org/:slug/account/**` only, alongside the current horizontal account navigation.
2. Present non-link Accounts and Festival categories; Accounts has Memberships, Contact Information, and Order History links, while Festival has a Home link to its organization landing page.
3. Use Google Material Symbols for the account entries and Festival Home entry, and provide an accessible top-right toggle that switches labels-and-icons to icons-only.
4. Start expanded at desktop widths and collapsed at mobile widths, without retaining the selection after reload.


## Non-goals

- New Festival destinations, account data/API changes, organization-admin navigation, `/create-organization`, `/invite/:token`, and `/privacy-policy`.


## Success criteria

- [G1] The sidebar renders on exactly the approved organization route families and retains the existing account-page horizontal navigation.
- [G2] It renders non-link Accounts and Festival category headings; Accounts links to the existing membership, contact-information, and order-history paths, and Festival links Home to `/org/:slug`; each entry has a Google Material Symbol icon.
- [G3] The accessible top-right toggle switches between a text-and-icon sidebar and an icon-only sidebar; the state resets on page reload, initializes expanded at desktop widths, and initializes collapsed at mobile widths.
- [G4] Focused frontend tests cover scope, sidebar destinations, toggle semantics, and the responsive default; the relevant frontend checks pass.

