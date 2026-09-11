# Establish Goals

## Status

- Task name: org-landing-header-auth-links
- Iteration: v5
- State: locked

## Request

- Change the customer-auth-button and all-memberships-link anchors to match the
  button component style. In Org-Landing-Header, add a person icon left of the
  Login/Logout element that links to /org/:slug/account; it is fully transparent
  while logged out and bullet-ink while logged in. Add an always-present Home link
  immediately to the left of that account icon, pointing to /org/:slug. Follow-up:
  give the account icon 1rem horizontal padding. Issue #123 follow-up: make Login
  and Logout consistent buttons while retaining the Login control's compact visual
  appearance and authentication destination.

## Blocking ambiguity

- None.

## Assumptions

- `compact-header-button` is the authoritative visual reference for both named
  anchor links.
- The account icon will use the project's Google Material Design icon mechanism
  and the person icon glyph from Google Fonts Icons.
- The transparent logged-out account icon remains an account link, as requested.
- The account icon link's requested horizontal padding is `1rem` on each side.
- Login will use a button click handler to navigate to its existing customer
  authentication-start URL, retaining Logout's correct POST-form semantics.

## Goals

1. Make the `all-memberships-link` anchor visually match `compact-header-button`
   without changing its destination or label.
2. In `Org-Landing-Header`, render an always-present `Home` link to `/org/:slug`
   immediately left of the account/person icon.
3. In `Org-Landing-Header`, render a Google Material Design person icon immediately
   left of the Login/Logout element. It always links to `/org/:slug/account`, is
   fully transparent while logged out, and uses the `bullet-ink` color while logged in.
4. Add or update focused automated coverage for the changed rendering and auth-state
   styling behavior.
5. Give the account icon link `1rem` of left and right padding.
6. Fix issue #123 by rendering Login and Logout as consistent button elements. Login
   must navigate to the existing customer authentication-start URL and retain its
   current compact visual appearance; Logout must preserve its existing POST logout
   behavior.

## Non-goals

- No unrelated navigation redesigns, routing changes, or authentication behavior
  changes.
- No change to the target URLs or text of the existing named anchor links.

## Success criteria

- [G1] The all-memberships anchor uses the same effective visual styles as
  `compact-header-button`.
- [G2] The header always includes Home, with an org-slug URL and placement left of
  the account icon.
- [G3] The person icon has the stated account URL, placement, and exact logged-in /
  logged-out color behavior.
- [G4] Relevant automated tests pass.
- [G5] The account icon link uses `padding-inline: 1rem`.
- [G6] Login and Logout are both buttons; Login navigates to its existing auth URL,
  has compact-header styling, and Logout still invokes the CSRF-protected logout
  flow.

## Next action

- Request goal approval.
