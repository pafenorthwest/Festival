# Goals Extract
- Task name: accompanist-auth-gate
- Iteration: v2
- State: locked

## Goals

1. Ensure an anonymous accompanist-membership visitor sees the requested in-context sign-in prompt before protected profile or enrollment-form requests begin. The prompt is an unanchored, centered modal dialog over the accompanist-membership page—not a pop-over and not a page-content card. The existing page heading may remain as the public backdrop, but the modal is the sole anonymous interaction surface and the protected form does not render.
2. Define the modal’s content and interaction: include the heading “Sign in to continue”; the supplied Shopify-security message; one brief public sentence explaining that sign-in is required to complete accompanist membership and choose divisions; a primary “Continue to Shopify” button; and a secondary “Cancel” button. Do not add a timeout or automatic redirect.
3. Define the page state flow: while session status is unresolved, show a neutral loading state and make no protected requests; once anonymous, render the centered modal over the public page backdrop; after Continue is clicked, disable its controls, communicate redirect progress, and start Shopify authentication; after a successful return with an authenticated session, remove the modal, show the existing protected-data loading state, and then the enrollment form.
4. Preserve the normal authenticated enrollment flow, loading its protected data only after a customer session is confirmed. The protected enrollment form, profile/contact data, and division controls must never appear in the anonymous state.
5. Make the modal deliberate and accessible: it has an accessible name and description, uses modal semantics and keyboard focus containment, prevents backdrop interaction, and displays a visible pending state that prevents duplicate Continue actions. Continue begins the existing Shopify flow with the accompanist page as its return target; Cancel returns to the public festival landing page with no authentication side effect.
6. Add automated coverage for each UI state, anonymous request suppression and modal actions, plus authenticated loading.


## Non-goals

- Database schema, PostgreSQL provisioning, migrations, repositories, and Admin Tool onboarding covered by #157 and #158–#163.
- Changes to Shopify OAuth payloads beyond selecting the existing page-level return target; no contact or division data may be included in URL or OAuth state.


## Success criteria

- [G1] With an unresolved session, a page test observes a neutral loading state and no protected profile/form requests.
- [G2] With an anonymous session, a page test observes a centered modal with the specified heading, Shopify-security message, public explanation, and both named actions; it observes neither protected requests nor protected enrollment content.
- [G3] Modal tests verify accessible dialog semantics, initial/contained keyboard focus, non-interactive backdrop, and the duplicate-click prevention/pending state.
- [G4] Tests verify exactly one click on Continue begins the existing Shopify flow with the accompanist return path, while Cancel routes to the public landing page without authentication side effects.
- [G5] With an authenticated session, a page test observes the existing protected data loading and enrollment flow.
- [G6] Focused frontend test suite passes.

