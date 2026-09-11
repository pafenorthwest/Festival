# Establish Goals

## Status

- Task name: org-landing-header-auth-links
- Iteration: v0
- State: blocked

## Request

- Change the customer-auth-button and all-memberships-link anchors to match the
  button component style. In Org-Landing-Header, add a person icon left of the
  Login/Logout element that links to /org/:slug/account; it is fully transparent
  while logged out and bullet-ink while logged in. Add an always-present Home link
  to /org/:slug. The requester asked for ambiguity-removing questions before work.

## Blocking ambiguity

- Which existing Button component/variant should the two anchor links match (and
  should their existing size, color, and responsive behavior be preserved)?
- Which Material Design icon package/component is already preferred in this
  project for the account icon?
- Where should the new Home link sit in the Org-Landing-Header relative to the
  existing navigation and Login/Logout controls, including on small screens?

## Assumptions

- The requested links already exist and are rendered by Org-Landing-Header or
  its immediate children.

## Goals

1. Pending clarification.

## Non-goals

- No unrelated navigation redesigns, routing changes, or authentication behavior
  changes.

## Success criteria

- [G1] Pending locked scope.

## Next action

- Ask blocking questions.
