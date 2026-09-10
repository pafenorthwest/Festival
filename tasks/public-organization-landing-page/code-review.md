# Code Review
- Task name: public-organization-landing-page
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `.codex/scripts/codex-config-bootstrap-sync.sh`
  - `goals/public-organization-landing-page/establish-goals.v0.md`
  - `goals/public-organization-landing-page/establish-goals.v1.md`
  - `goals/public-organization-landing-page/goals.v0.md`
  - `goals/public-organization-landing-page/goals.v1.md`
  - `goals/task-manifest.csv`
  - `packages/backend/src/customer/customer-account-service.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/src/services/organization-service.ts`
  - `packages/backend/tests/organization-routes.test.ts`
  - `packages/common/src/organization.ts`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/lib/routes.ts`
  - `packages/frontend/src/pages/OrganizationRootPage.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/organization-landing.test.ts`
  - `packages/frontend/tests/routes.test.ts`
  - `tasks/public-organization-landing-page/spec.md`
- Citation candidates (verify before use):
  - `goals/task-manifest.csv:28-28`
  - `packages/backend/src/customer/customer-account-service.ts:405-408`
  - `packages/backend/src/routes/api-router.ts:390-399`
  - `packages/backend/src/routes/route-security.ts:164-168`
  - `packages/backend/src/services/organization-service.ts:24-24`
  - `packages/backend/src/services/organization-service.ts:537-555`
  - `packages/backend/tests/organization-routes.test.ts:1171-1205`
  - `packages/common/src/organization.ts:266-270`
  - `packages/frontend/src/lib/api.ts:258-268`
  - `packages/frontend/src/lib/api.ts:26-26`
  - `packages/frontend/src/lib/routes.ts:78-78`
  - `packages/frontend/src/pages/OrganizationRootPage.tsx:1-7`
  - `packages/frontend/src/pages/OrganizationRootPage.tsx:10-10`
  - `packages/frontend/src/pages/OrganizationRootPage.tsx:14-33`
  - `packages/frontend/src/pages/OrganizationRootPage.tsx:35-57`
  - `packages/frontend/src/pages/OrganizationRootPage.tsx:59-109`
  - `packages/frontend/src/styles.css:131-201`
  - `packages/frontend/tests/routes.test.ts:37-40`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.90
- Justification: The public endpoint is explicitly default-deny classified, returns only an organization name/slug and festival summaries, and is covered by backend tests. The landing UI uses only Customer Account session/auth helpers, supports both root URL variants, and has focused route and banner tests. No actionable regression was found in the reviewed diff.
