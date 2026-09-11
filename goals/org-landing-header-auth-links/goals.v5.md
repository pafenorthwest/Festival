# Goals Extract
- Task name: org-landing-header-auth-links
- Iteration: v5
- State: locked

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

