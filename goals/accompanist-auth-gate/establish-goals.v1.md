# Establish Goals

## Status

- Task name: accompanist-auth-gate
- Iteration: v1
- State: ready-for-confirmation

## Request

- Review and fix GitHub issue #155: prevent anonymous visitors to the accompanist-membership page from starting protected requests, and present an in-context user-initiated Shopify sign-in prompt. Define the anonymous, authentication-transition, and returned-authenticated UI states. Do not proceed if the work interferes with issue #157 or its sub-issues.

## Blocking ambiguity

- None. Issue #157 explicitly identifies #155 as independently actionable, and its database-schema sub-work does not overlap the frontend authentication gate.

## Assumptions

- The current frontend authentication flow provides a supported way to begin Shopify customer authentication and set a safe page-level return target.
- "Cancel" will use the existing public landing-page route if an existing prompt-dismiss mechanism is not present.

## Goals

1. Ensure an anonymous accompanist-membership visitor sees the requested in-context sign-in gate before protected profile or enrollment-form requests begin. The gate is a page-content card (not an auto-opening modal) that includes: the heading “Sign in to continue”; the supplied Shopify-security message; a brief public accompanist-membership introduction; a primary “Continue to Shopify” button; and a secondary “Cancel” button.
2. Define the page state flow: while session status is unresolved, show a neutral loading state and make no protected requests; once anonymous, render only the public introduction and sign-in gate; after Continue is clicked, show the existing navigation/redirect-pending state and start Shopify authentication; after a successful return with an authenticated session, show the existing protected-data loading state and then the enrollment form.
3. Preserve the normal authenticated enrollment flow, loading its protected data only after a customer session is confirmed. The protected enrollment form, profile/contact data, and division controls must never appear in the anonymous state.
4. Make the gate actions deliberate and accessible: Continue begins the existing Shopify flow with the accompanist page as its return target; Cancel returns to the public festival landing page with no authentication side effect; buttons have clear names, standard keyboard behavior, and a visible disabled/pending state that prevents duplicate Continue actions.
5. Add automated coverage for each UI state, anonymous request suppression and gate actions, plus authenticated loading.

## Non-goals

- Database schema, PostgreSQL provisioning, migrations, repositories, and Admin Tool onboarding covered by #157 and #158–#163.
- Changes to Shopify OAuth payloads beyond selecting the existing page-level return target; no contact or division data may be included in URL or OAuth state.

## Success criteria

- [G1] With an unresolved session, a page test observes a neutral loading state and no protected profile/form requests.
- [G2] With an anonymous session, a page test observes the specified heading, Shopify-security message, public introduction, and both named actions; it observes neither protected requests nor protected enrollment content.
- [G3] Tests verify exactly one click on Continue begins the existing Shopify flow with the accompanist return path, while Cancel routes to the public landing page without authentication side effects.
- [G4] With an authenticated session, a page test observes the existing protected data loading and enrollment flow.
- [G5] Focused frontend test suite passes.

## Next action

- Request goal approval
