# Establish Goals

## Status

- Task name: organization-page-app-header
- Iteration: v0
- State: blocked

## Request

- Move the organization landing header into an Organization Page variant of
  `AppHeader`, and suppress the default masthead when that variant is active.

## Blocking ambiguity

- Does "Organization Pages" mean only the public organization landing route
  (`/org/:slug`), or every non-admin organization-scoped route (including
  `/org/:slug/membership` and `/org/:slug/account`)?
- Should the new variant reproduce the supplied organization name and Login /
  Logout behavior exactly, with `OrganizationRootPage` no longer rendering that
  header itself?
- If the variant applies beyond the landing route, what heading and
  authentication controls should the membership and customer-account pages
  display?

## Assumptions

- The supplied markup represents the intended Organization Page variant, but
  its target route scope is not yet confirmed.

## Goals

1. Pending route-scope and behavior clarification.

## Non-goals

- Do not change page routes, authentication APIs, or the Admin Page masthead.

## Success criteria

- [G1] Pending clarified route scope and expected rendered header behavior.

## Next action

- Ask blocking questions.
