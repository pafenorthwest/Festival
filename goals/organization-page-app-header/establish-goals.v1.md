# Establish Goals

## Status

- Task name: organization-page-app-header
- Iteration: v1
- State: locked

## Request

- Move the organization landing header into an Organization Page variant of
  `AppHeader`, and suppress the default masthead when that variant is active.

## Blocking ambiguity

- None.

## Assumptions

- Organization Page means the public organization landing, membership, and
  customer-account routes: `/org/:slug`, `/org/:slug/membership`, and
  `/org/:slug/account`.
- The Organization Page header reproduces the supplied organization name and
  customer Login / Logout behavior on each of those routes.

## Goals

1. Add an Organization Page variant to `AppHeader` for the three public
   organization-scoped routes.
2. Suppress the default masthead on Organization Pages and render the supplied
   organization name plus customer Login / Logout controls in the new variant.
3. Remove the duplicated organization landing header from `OrganizationRootPage`.
4. Add or update focused front-end tests covering route classification and the
   Organization Page header rendering.

## Non-goals

- Do not change page routes, authentication APIs, or the Admin Page masthead.

## Success criteria

- [G1] On each of the three public organization routes, the default masthead is
  absent and the Organization Page header is rendered.
- [G2] The header shows the organization name and, once the customer session
  resolves, Login when unauthenticated or Logout when authenticated.
- [G3] `OrganizationRootPage` does not render a second organization header.
- [G4] Relevant front-end tests pass.

## Next action

- Hand off to implement.
