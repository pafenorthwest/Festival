# Establish Goals

## Status

- Task name: accompanist-auth-gate
- Iteration: v0
- State: ready-for-confirmation

## Request

- Review and fix GitHub issue #155: prevent anonymous visitors to the accompanist-membership page from starting protected requests, and present an in-context user-initiated Shopify sign-in prompt. Do not proceed if the work interferes with issue #157 or its sub-issues.

## Blocking ambiguity

- None. Issue #157 explicitly identifies #155 as independently actionable, and its database-schema sub-work does not overlap the frontend authentication gate.

## Assumptions

- The current frontend authentication flow provides a supported way to begin Shopify customer authentication and set a safe page-level return target.
- "Cancel" will use the existing public landing-page route if an existing prompt-dismiss mechanism is not present.

## Goals

1. Ensure an anonymous accompanist-membership visitor sees the requested in-context sign-in prompt before protected profile or enrollment-form requests begin.
2. Preserve the normal authenticated enrollment flow, loading its protected data only after a customer session is confirmed.
3. Make the prompt actions user-initiated: Continue starts the existing Shopify flow with the accompanist page as its return target, and Cancel dismisses safely or returns to the public festival landing page.
4. Add automated coverage for anonymous request suppression and prompt actions, plus authenticated loading.

## Non-goals

- Database schema, PostgreSQL provisioning, migrations, repositories, and Admin Tool onboarding covered by #157 and #158–#163.
- Changes to Shopify OAuth payloads beyond selecting the existing page-level return target; no contact or division data may be included in URL or OAuth state.

## Success criteria

- [G1] An unauthenticated page test observes the sign-in prompt and no protected profile/form requests.
- [G2] Tests verify Continue preserves the accompanist page return path, and Cancel has no authentication side effect.
- [G3] An authenticated page test observes the existing protected data loading and enrollment flow.
- [G4] Focused frontend test suite passes.

## Next action

- Request goal approval
