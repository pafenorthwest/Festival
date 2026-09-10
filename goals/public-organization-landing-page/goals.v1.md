# Goals Extract
- Task name: public-organization-landing-page
- Iteration: v1
- State: locked

## Goals

1. Render an organization-specific public landing page at both `/org/{shortname}` and `/org/{shortname}/`, with the same content and behavior for either URL variant.
2. Display the organization’s upcoming festivals on the landing page, showing a name and date for each listed festival.
3. Show one top Shopify Customer Account authentication control whose label is `Login` for signed-out customers and `Logout` for signed-in customers; do not use, expose, or alter administrator authentication.
4. Render four full-width, vertically stacked role banners in this exact order: Teachers, Parents, Volunteers, Accompanists. Give each a distinct, site-compatible background color and label text approximately four times normal body text size.
5. Make the role banners navigate to their approved destinations: Teachers and Accompanists to `/org/{shortname}/membership`, Parents to `/classes`, and Volunteers to `/sign-up`.
6. Render an `All Memberships` button below the role banners that links to `/org/{shortname}/membership`.
7. Add automated coverage for URL-variant equivalence, organization/festival rendering, auth-label state, banner sequence and link destinations, and the All Memberships link.


## Non-goals

- Do not implement Shopify Customer Account login/logout flows, only consume the established customer signed-in state for the control label.
- Do not use, expose, modify, or add administrator authentication or admin-login behavior.
- Do not create or implement `/classes` or `/sign-up`; those routes are link targets only.
- Do not add membership purchasing, membership-page functionality, volunteer sign-up functionality, festival authoring, or unrelated public-site redesigns.


## Success criteria

- [G1] Requests to `/org/{shortname}` and `/org/{shortname}/` produce the same organization landing experience.
- [G2] The landing page shows the selected organization’s upcoming festival names and dates.
- [G3] The Shopify Customer Account control label changes between `Login` and `Logout` according to customer signed-in state, independently of any administrator-login state.
- [G4] Exactly four full-width role banners appear in the approved order, stacked vertically with distinct style-compatible colors and approximately 4× body-size labels.
- [G5] Each banner has the approved URL destination: Teachers and Accompanists → `/org/{shortname}/membership`; Parents → `/classes`; Volunteers → `/sign-up`.
- [G6] `All Memberships` appears below the banners and navigates to `/org/{shortname}/membership`.
- [G7] Automated tests demonstrate G1 through G6.

