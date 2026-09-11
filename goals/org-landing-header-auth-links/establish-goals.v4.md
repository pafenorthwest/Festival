# Establish Goals

## Status

- Task name: org-landing-header-auth-links
- Iteration: v4
- State: blocked

## Request

- Change the customer-auth-button and all-memberships-link anchors to match the
  button component style. In Org-Landing-Header, add a person icon left of the
  Login/Logout element that links to /org/:slug/account; it is fully transparent
  while logged out and bullet-ink while logged in. Add an always-present Home link
  immediately to the left of that account icon, pointing to /org/:slug. Follow-up:
  give the account icon 1rem horizontal padding. New follow-up: make the Login and
  Logout controls consistent in element and appearance, with Login's anchor
  appearance as the visual reference.

## Blocking ambiguity

- Logout currently submits a CSRF-protected POST form, while Login navigates to an
  authentication-start URL. Should Login be changed to a button that navigates to
  the existing URL, or should Logout become an anchor that intercepts clicks to
  submit the existing POST form?

## Assumptions

- `compact-header-button` is the authoritative visual reference for both named
  anchor links.
- The account icon will use the project's Google Material Design icon mechanism
  and the person icon glyph from Google Fonts Icons.
- The transparent logged-out account icon remains an account link, as requested.
- The account icon link's requested horizontal padding is `1rem` on each side.

## Goals

1. Make the `customer-auth-button` and `all-memberships-link` anchors visually
   match `compact-header-button` without changing their destinations or labels.
2. In `Org-Landing-Header`, render an always-present `Home` link to `/org/:slug`
   immediately left of the account/person icon.
3. In `Org-Landing-Header`, render a Google Material Design person icon immediately
   left of the Login/Logout element. It always links to `/org/:slug/account`, is
   fully transparent while logged out, and uses the `bullet-ink` color while logged in.
4. Add or update focused automated coverage for the changed rendering and auth-state
   styling behavior.
5. Give the account icon link `1rem` of left and right padding.
6. Pending the chosen consistent element strategy for Login and Logout.

## Non-goals

- No unrelated navigation redesigns, routing changes, or authentication behavior
  changes.
- No change to the target URLs or text of the existing named anchor links.

## Success criteria

- [G1] The two named anchors use the same effective visual styles as
  `compact-header-button`.
- [G2] The header always includes Home, with an org-slug URL and placement left of
  the account icon.
- [G3] The person icon has the stated account URL, placement, and exact logged-in /
  logged-out color behavior.
- [G4] Relevant automated tests pass.
- [G5] The account icon link uses `padding-inline: 1rem`.
- [G6] Pending clarification.

## Next action

- Ask the blocking clarification.
