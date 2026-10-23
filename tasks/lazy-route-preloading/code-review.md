# Code Review
- Task name: lazy-route-preloading
- Findings status: none

## Context

- Base: `23c0d3041ee0181a50ac758fff564d8581fbcf74`, the clean pre-change checkout.
- Diff command: `git diff -- packages/frontend`, plus direct inspection of the new route registry, navigation helper, and focused tests.
- Reviewed files:
  - `packages/frontend/src/App.tsx`
  - `packages/frontend/src/app/lazyPages.ts`
  - `packages/frontend/src/app/navigationPreload.ts`
  - `packages/frontend/src/components/AppHeader.tsx`
  - `packages/frontend/src/components/FestivalNoChildrenPanel.tsx`
  - `packages/frontend/src/pages/AccompanistMembershipPage.tsx`
  - `packages/frontend/src/pages/AdminFestivalsPage.tsx`
  - `packages/frontend/src/pages/AdminHomePage.tsx`
  - `packages/frontend/src/pages/AdminMembershipProductsPage.tsx`
  - `packages/frontend/src/pages/CreateOrganizationPage.tsx`
  - `packages/frontend/src/pages/CustomerAccountNavigation.tsx`
  - `packages/frontend/src/pages/FestivalAdminClassesPage.tsx`
  - `packages/frontend/src/pages/FestivalAdminDashboardPage.tsx`
  - `packages/frontend/src/pages/FestivalClassRegistrationPage.tsx`
  - `packages/frontend/src/pages/OrganizationChooser.tsx`
  - `packages/frontend/tests/lazy-navigation.test.ts`
- User instructions require native PowerShell and prohibit direct shell-script execution. Read `code-review-validate.sh`; performed diff preparation, exact current-file inspection, and findings/verdict consistency validation with native PowerShell equivalents. `git diff --check` passed. No Git mutations, source edits, or builds were performed for this review.

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: 0.92
- Justification: All original route matches and component props remain intact, while the registry supplies deferred component imports and an exhaustive route-kind preload map. Home, the organization chooser, shell, controller, and authentication remain directly imported. Navigation metadata preserves existing destinations, permission checks, disabled states, and click behavior; root delegation filters external, non-web, download, disabled, and alternate-target controls and resolves relative links against the current URL. The shared import loader deduplicates preload work, clears speculative failures for retry, and avoids the installed Solid preload implementation's ignored rejecting promise. Route loading/error boundaries retain the shell, expose reload recovery, and reset after a destination change. Focused tests cover loader reuse without mounting, rejected preload retry, path resolution/filtering, aliases, auth/API exclusion, and caught speculative failures. No actionable regression was identified.

## Verification boundaries

- Final integrated tests, production bundle measurements, and browser loading/error/performance checks are owned by the parent verification tracks.
- The route-level Suspense fallback can wait for a page's initial resource reads; controlled navigation timing results must identify whether API/data loading is included.
- Existing customer-account buttons and accompaniment cancellation retain full-document navigation. Their module execution cache does not survive navigation; HTTP cache reuse is deployment dependent. This is preserved existing behavior, not a regression introduced by the patch.

## Final landing review

- Refreshed against the current working-tree diff before commit/push/PR. All 16 source/test files above were inspected again, including the final Solid-compatible generic constraint in `lazyPage`; no additional production behavior or scope change was found.
- Findings status remains `none`, findings JSON remains `[]`, verdict remains `patch is correct`, and confidence remains `0.92`.
- Native PowerShell validation confirmed consistent findings/verdict/confidence fields and a clean `git diff --check`. Source files, Git state, dependencies, and build outputs were not mutated by this review.
- The PR should report the tradeoff accurately: startup JavaScript falls from 501,552 to 229,530 minified bytes (54.2%) and from 138,596 to 66,437 gzip bytes (52.1%), while all emitted chunks grow to 525,851 minified bytes (+4.8%) and 168,272 summed gzip bytes (+21.4%). The cold-route delay includes roughly one simulated 100 ms network round trip; warm revisits have no additional chunk requests.
- The controlled browser results use five trials per navigation mode, local API fixtures, no real authentication/backend data latency, 100 ms network latency, 10 Mbps download, and 4x CPU slowdown. Completed-preload cases allowed approximately 378–427 ms intent lead and do not establish instantaneous-click or field-performance guarantees. Full performance and recovery evidence is recorded in the task spec.
