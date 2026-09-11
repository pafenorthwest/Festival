# Goals Extract
- Task name: org-landing-header-auth-links
- Iteration: v1
- State: locked

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

