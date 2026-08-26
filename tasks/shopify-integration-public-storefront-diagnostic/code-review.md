# Code Review
- Task name: shopify-integration-public-storefront-diagnostic
- Findings status: none

## Context
- Base branch: main
- Diff command: `git diff --cached; git diff; inspect listed untracked files`
- Changed files:
  - `SECURITY.md`
  - `docker/nginx.festival.conf`
  - `goals/shopify-integration-public-storefront-diagnostic/establish-goals.v0.md`
  - `goals/shopify-integration-public-storefront-diagnostic/goals.v0.md`
  - `goals/task-manifest.csv`
  - `nginx/festival.conf`
  - `packages/backend/src/app.ts`
  - `packages/backend/src/routes/api-router.ts`
  - `packages/backend/src/routes/route-security.ts`
  - `packages/backend/src/shopify/shopify-integration-diagnostic-service.ts`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts`
  - `packages/backend/tests/nginx-security.test.ts`
  - `packages/backend/tests/organization-routes.test.ts`
  - `packages/backend/tests/shopify-integration-diagnostic-service.test.ts`
  - `packages/backend/tests/shopify-public-catalog-client.test.ts`
  - `packages/common/src/shopify.ts`
  - `packages/frontend/src/lib/api.ts`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx`
  - `packages/frontend/src/styles.css`
  - `packages/frontend/tests/onboarding-integration.test.ts`
  - `tasks/shopify-integration-public-storefront-diagnostic/spec.md`
- Citation candidates (verify before use):
  - `SECURITY.md:39-39`
  - `SECURITY.md:74-74`
  - `docker/nginx.festival.conf:55-55`
  - `goals/task-manifest.csv:17-17`
  - `nginx/festival.conf:71-71`
  - `packages/backend/src/app.ts:100-100`
  - `packages/backend/src/app.ts:103-106`
  - `packages/backend/src/app.ts:108-108`
  - `packages/backend/src/app.ts:178-178`
  - `packages/backend/src/app.ts:23-23`
  - `packages/backend/src/app.ts:37-37`
  - `packages/backend/src/routes/api-router.ts:106-114`
  - `packages/backend/src/routes/api-router.ts:138-138`
  - `packages/backend/src/routes/api-router.ts:28-28`
  - `packages/backend/src/routes/api-router.ts:564-588`
  - `packages/backend/src/routes/route-security.ts:182-186`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:107-107`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:111-148`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:154-179`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:195-196`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:204-204`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:208-208`
  - `packages/backend/src/shopify/shopify-public-catalog-client.ts:30-37`
  - `packages/backend/tests/nginx-security.test.ts:26-26`
  - `packages/backend/tests/organization-routes.test.ts:1189-1260`
  - `packages/backend/tests/organization-routes.test.ts:222-222`
  - `packages/backend/tests/organization-routes.test.ts:23-23`
  - `packages/backend/tests/organization-routes.test.ts:243-244`
  - `packages/backend/tests/organization-routes.test.ts:247-247`
  - `packages/backend/tests/organization-routes.test.ts:29-30`
  - `packages/backend/tests/organization-routes.test.ts:82-95`
  - `packages/backend/tests/shopify-public-catalog-client.test.ts:28-83`
  - `packages/common/src/shopify.ts:96-112`
  - `packages/frontend/src/lib/api.ts:34-34`
  - `packages/frontend/src/lib/api.ts:430-437`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx:1-5`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx:155-156`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx:285-346`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx:61-104`
  - `packages/frontend/src/pages/AdminIntegrationsPage.tsx:9-9`
  - `packages/frontend/src/styles.css:906-941`
  - `packages/frontend/tests/onboarding-integration.test.ts:20-20`
  - `packages/frontend/tests/onboarding-integration.test.ts:259-259`
  - `packages/frontend/tests/onboarding-integration.test.ts:276-276`
  - `packages/frontend/tests/onboarding-integration.test.ts:310-310`
  - `packages/frontend/tests/onboarding-integration.test.ts:326-326`
  - `packages/frontend/tests/onboarding-integration.test.ts:328-352`

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.94
- Justification: The Admin-only diagnostic resolves the verified tenant domain on the server, rejects request bodies, reuses bounded credential-free Storefront transport, classifies only the exact locked-store response, sanitizes other failures, and has focused route, transport, service, nginx, and frontend coverage. Full pinned format, build, and test commands pass.
