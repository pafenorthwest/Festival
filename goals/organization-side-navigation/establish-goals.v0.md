# Establish Goals

## Status

- Task name: organization-side-navigation
- Iteration: v0
- State: draft

## Request

- Add a collapsible left side navigation bar to organization landing-header pages.

## Blocking ambiguity

- Should the new navigation replace the existing horizontal account buttons on account pages, or coexist with them?
- Does "all Organization pages" include organization admin routes (`/org/:slug/admin/**`), or only the explicitly named landing-header route families (`/org/:slug`, `/org/:slug/membership`, and `/org/:slug/account/**`)?
- Should the collapsed/expanded choice persist across page reloads, and what should be its initial state and small-screen behavior?

## Assumptions

- Material Symbols from Google Fonts are already loaded, so the navigation will use their `card_membership`, `contact_page`, `receipt_long`, and an appropriate expand/collapse icon.
- Memberships, contact information, and order history link to their existing customer account routes.

## Goals

1. Add the requested Accounts and Festival navigation structure to the confirmed organization-page scope.
2. Permit an accessible top-right toggle to collapse the sidebar from labels and icons to icons only.

## Non-goals

- New Festival destinations, account data/API changes, and organization-admin navigation unless confirmed in scope.

## Success criteria

- [G1] The sidebar's route scope, replacement/coexistence behavior, and responsive/persistence behavior are approved before implementation.
- [G2] The three Accounts entries navigate to the established membership, contact-information, and order-history routes and show the requested icon-only collapsed presentation.

## Next action

- Ask blocking question
