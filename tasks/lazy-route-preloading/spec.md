# Lazy route preloading

## Locked scope

- Goals: `goals/lazy-route-preloading/goals.v0.md`, locked from the user's explicit implementation request.
- Deferred route pages; eager shell, Home, organization chooser, and authentication; shared hover/focus module preloading; route loading/error handling.
- Navigation metadata preserves existing click handlers, path construction, permission/disabled guards, and navigation semantics.
- Excludes API/authentication changes, dependency upgrades, broad caching/deployment changes, commits, pushes, and deployment.

## Preflight and execution

- Baseline was captured before edits on branch `ericp/smaller-run-image`, HEAD `23c0d3041ee0181a50ac758fff564d8581fbcf74`; the working tree was clean.
- Baseline production asset: `index-TypDwPDW.js`, 501,552 minified bytes, 138,596 Node gzip bytes. Baseline preserved under `/private/tmp/festival-lazy-performance/baseline`.
- Existing checkout retained; no Git mutation or unrelated work is authorized.
- User instructions require native PowerShell. Goal extraction/validation and implementation preflight use native equivalents after reading the shell scripts; shell bootstrap/config updates and Git pruning are omitted as unrelated setup mutations.
- Disjoint owners: route registry/App/delegation and focused tests; navigation button metadata/task records; production browser baseline/after measurements. Parent owns integration and final verification.

## Pinned verification

Run from the repository root with `/usr/local/bin/pwsh`:

```powershell
bun run verify:toolchain
bun run --cwd packages/frontend test
bun run --cwd packages/frontend lint
bun run --cwd packages/frontend build
```

- Run `bun x biome check` with the exact changed/new TypeScript/TSX paths after integration.
- Browser benchmark uses real production builds, deterministic API fixtures, and the same browser/network/CPU settings before and after. Record cold first navigation, warm repeat navigation, hover preload, and keyboard-focus preload separately, with trial counts and median/range.
- Use Node `node:zlib` `gzipSync` defaults on actual emitted JavaScript for a consistent baseline/after comparison. Distinguish startup closure from total JavaScript and deferred chunks.
- Complete an independent review of lazy import boundaries, preload filtering, accessibility, auth eagerness, and navigation/error behavior.

## Delivery and verification

- Navigation annotations completed: 28 internal navigation buttons across 12 source files now expose their existing destination through `data-preload-path`; the shared root handlers own module preload execution.
- Existing click handlers, permission and disabled guards, route encoding, and full-page versus SPA navigation semantics are unchanged. Auth, logout, submit, checkout, and mutation buttons have no preload annotation.
- Existing focused navigation/registration/onboarding checks passed: 101 tests, 0 failures, 675 assertions across 8 files. Scoped Biome passed all 12 navigation source files. `bun run verify:toolchain` passed with Bun 1.4.2 and TypeScript 5.9.3.
- Goal extraction/state/count/mapped-criterion checks passed using native PowerShell equivalents (4 locked goals).
- The shared lazy registry, route-only suspense/error handling, and delegated hover/focus handlers are implemented. Independent review, final browser navigation measurements, and recovery checks passed. All locked success criteria are fulfilled.

## Integrated validation

- Frontend tests: **345 passed, 0 failed**, 1,967 assertions across 36 files.
- Frontend TypeScript `--noEmit`: passed.
- Scoped Biome: passed all 16 changed/new TypeScript/TSX files without fixes.
- Production build: passed with Vite 7.3.1 and 157 transformed modules; **no chunk-size warning**. Entry `index-CyaDa-aT.js`; largest deferred chunk `MembershipPage-DMwjIK1x.js` (37.19 kB displayed by Vite).
- `git diff --check`: passed. Footprint is limited to App, navigation metadata source files, the new registry/delegation helper, focused lazy-navigation tests, and this task's goals/spec/review records. No Git mutations, dependencies, backend changes, or ignored artifacts were included.
- The first full test run reported the existing strict 500-line source guard on FestivalClassRegistrationPage: adding its destination prop reached 500 newline-separated lines. Removed one redundant blank line adjacent to that touched block; the guard and all tests then passed. The test was preserved unchanged. Rebuilt afterward; entry and registration chunk hashes stayed identical, so the browser benchmark artifacts remain valid.
- Full logs: `/private/tmp/festival-lazy-validation/{tests,types,biome,build}.log`. Exact Node gzip measurement: `/private/tmp/festival-lazy-validation/build-sizes.json`.

Exact scoped Biome command:

```powershell
bun x biome check packages/frontend/src/App.tsx packages/frontend/src/components/AppHeader.tsx packages/frontend/src/components/FestivalNoChildrenPanel.tsx packages/frontend/src/pages/AccompanistMembershipPage.tsx packages/frontend/src/pages/AdminFestivalsPage.tsx packages/frontend/src/pages/AdminHomePage.tsx packages/frontend/src/pages/AdminMembershipProductsPage.tsx packages/frontend/src/pages/CreateOrganizationPage.tsx packages/frontend/src/pages/CustomerAccountNavigation.tsx packages/frontend/src/pages/FestivalAdminClassesPage.tsx packages/frontend/src/pages/FestivalAdminDashboardPage.tsx packages/frontend/src/pages/FestivalClassRegistrationPage.tsx packages/frontend/src/pages/OrganizationChooser.tsx packages/frontend/src/app/lazyPages.ts packages/frontend/src/app/navigationPreload.ts packages/frontend/tests/lazy-navigation.test.ts
```

### Final landing validation — 2026-10-23

- Re-ran the pinned landing checks against the final source: `bun run verify:toolchain`, frontend tests, TypeScript lint, production build, the exact scoped Biome command above, and `git diff --check`; all passed.
- Tests again passed **345/345**, with **1,967 assertions across 36 files**. Biome checked all **16** scoped files with no fixes.
- Production output remains `index-CyaDa-aT.js`, **229,530 minified / 66,437 Node gzip bytes**. The registration chunk is still `FestivalClassRegistrationPage-Cl0cjYBF.js`; the browser benchmark therefore matches the final source. There is no chunk-size warning.
- Landing logs: `/private/tmp/festival-lazy-landing-validation/{toolchain,tests,types,build,biome,diffcheck}.log`; exact entry size record: `build-sizes.json` in the same directory.
- No source files or Git state were modified by this verification track. Generated build outputs remain ignored; review and delivery are tracked separately.

## Production byte measurements

- Baseline: 501,552 minified JavaScript bytes / 138,596 Node gzip bytes, one eager chunk.
- New entry: **229,530 minified bytes / 66,437 Node gzip bytes**.
- All emitted JavaScript: **525,851 minified bytes / 168,272 gzip bytes across 39 chunks**. Gzip totals compress each output file independently using Node defaults; these are total emitted bytes, not the initial download.
- Module-placement inspection identifies Home, organization chooser, shell components, lifecycle, `firebase-auth.ts`, and Firebase Auth in the entry graph. Its entry reports no static chunk imports. Actual browser resource measurements confirm the public Home startup downloads the entry alone; admin Home startup additionally downloads its deferred AdminHomePage chunk (4,946 minified / 1,428 gzip bytes).
- Module-placement metadata is used for ownership/import inspection only; its hook runs before final Vite output injection. Final byte counts above are measured from emitted files and browser resource sizes.

## Browser navigation measurement

- Browser: headless Chrome **156.0.8078.47**.
- Controlled network: **100 ms latency, 10 Mbps download, 5 Mbps upload**; CPU throttled **4x**.
- Production assets are gzip-encoded with `Cache-Control: no-store`; this exercises same-tab JavaScript module reuse rather than cross-reload HTTP caching. External requests and fonts are blocked; API responses are deterministic local fixtures and no real accounts or Firebase authentication are used.
- Five trials per route/mode. Navigation duration is a programmatic click through destination content presence plus two animation frames. Cold clicks avoid hover/focus; warm navigation revisits the already loaded route in the same SPA session.
- Privacy has no API data. Rooms starts from an Admin-membership bootstrap fixture without a Firebase user/token and reaches the legitimate empty-festival UI; these results do not measure authenticated backend data loading or real login latency.

| Destination | Mode | Before median (range), ms | After median (range), ms |
| --- | --- | ---: | ---: |
| Privacy | Cold, no preload | 21.5 (10.8–40.2) | 125.7 (120.0–129.3) |
| Privacy | Warm revisit | 27.1 (20.6–28.7) | 26.5 (20.6–27.4) |
| Privacy | Hover preload completed | 32.5 (30.6–47.5) | 39.7 (32.8–47.1) |
| Privacy | Focus preload completed | 9.7 (8.7–16.2) | 12.8 (10.6–25.9) |
| Rooms | Cold, no preload | 12.4 (10.9–18.9) | 128.4 (123.8–142.0) |
| Rooms | Warm revisit | 25.4 (24.2–27.3) | 24.3 (23.3–26.8) |
| Rooms | Hover preload completed | 33.5 (31.4–46.0) | 40.7 (33.9–45.2) |
| Rooms | Focus preload completed | 14.6 (8.9–17.5) | 14.7 (10.6–22.4) |

- After splitting, cold Privacy navigation fetches one route JavaScript chunk; cold Rooms navigation fetches three chunks in parallel. Warm revisits and completed hover/focus preloads make **zero JavaScript requests after the click**. Preload fetches one Privacy chunk or three Rooms chunks before navigation.
- Hover/focus scenarios were rerun for both baseline and changed builds with a **350 ms minimum intent lead**, an explicit wait for all script requests to finish, and an assertion that the expected preload resources completed. Actual median lead was 378–427 ms. These represent a completed-prefetch best case; a click before preload finishes still waits for the remaining download. The final table excludes the earlier imprecise preload run.
- Small timing differences are noisy at this sample size because frame scheduling is included. These are synthetic local results, not field performance data.

Initial usable-page timing, aggregated across the 20 trials per starting page (five per navigation mode), includes shell JavaScript, the deterministic bootstrap when needed, and two animation frames. It excludes real login and remote API latency:

| Starting page | Before median, ms | After median, ms |
| --- | ---: | ---: |
| Public Home | 405.8 | 343.6 |
| Admin Home | 506.2 | 457.8 |

The measured tradeoff is a faster startup with a roughly one-network-latency first-navigation cost for untouched routes. Warm navigation stays within the observed baseline range; completed intent preloading avoids the route-download wait. No claim is made that module preloading accelerates backend data requests or full-document navigation.

## Independent review and browser recovery checks

- Independent code review: **no actionable findings**, verdict **patch is correct**, confidence **0.92**; record `tasks/lazy-route-preloading/code-review.md`.
- Browser smoke checks all passed: rejected hover preload retries successfully on click without an unhandled rejection; a failed route chunk is contained by the route error boundary while the shell stays visible and Back to Admin recovers; a one-second delayed route keeps the eager shell and the previous page visible during the Solid Router transition.
- Existing customer account navigation buttons and accompaniment cancellation retain full-document navigation. Their module execution cache does not survive navigation; HTTP cache reuse depends on deployment caching and was not claimed by the same-session benchmark.
- Final preload timings and all recovery checks are complete. No additional source changes or validation failures remain.

## Durable benchmark evidence

All files below are preserved under `/Users/eric/.codex/visualizations/2026/10/23/01a16a21-3a7c-7850-bf83-f6e2bbf3fbbd/lazy-loading-performance-2026-10-23/`:

- `performance-summary.json`: browser conditions, final median/range results, startup aggregation, limitations, size comparison, and smoke outcomes.
- `baseline-timings.json`, `after-timings.json`: per-trial navigation/resource measurements.
- `size-comparison.json`: exact emitted entry/total minified and Node gzip bytes.
- `module-placement.json`: eager module ownership and chunk imports, explicitly labeled as captured before final Vite rewrites.
- `smoke-results.json`: passing failed-preload retry, chunk-failure recovery, and delayed-route shell-preservation checks.
- `benchmark.cjs`, `measure-size.cjs`, `capture-modules.cjs`, `smoke.cjs`, `summarize.cjs`: reproducible measurement scripts.

## Goal completion

- [G1] All non-shell route pages are deferred; actual module placement and browser resource traces confirm the shell, Home, organization chooser, lifecycle, and authentication remain eager.
- [G2] Hover/focus intent preloads the corresponding route modules without mounting pages or requesting route data. Unit and browser tests verify reuse, filtering, failure handling, and both pointer/keyboard paths.
- [G3] Existing navigation/authorization behavior is retained; 345 frontend tests, route loading/error smoke checks, and independent review pass.
- [G4] TypeScript, scoped Biome, production build, exact byte comparison, and real controlled cold/warm/completed-preload browser measurements are complete. The production chunk warning is gone; total emitted JavaScript growth and benchmark limitations are reported.

## Delivery authorization and preflight

- The user's subsequent instruction explicitly authorizes committing this change, pushing the current branch, and opening a pull request; this supersedes the original delivery non-goals without changing implementation scope.
- Repository: `pafenorthwest/Festival`; head branch: `ericp/smaller-run-image`; selected stacked base: `ericp/verified-paid-order` (`8754bb990d0f935b9c093dfb2291c1003bf057db`, open dependency PR #305).
- The repository's older configured review base is `ericp/exp-long-running-agent`; using it or `main` would include extensive prior backend/database work. The selected dependency branch excludes that work. The resulting PR also contains the earlier eligibility/admin-selection consolidation (`526002e`) and the one-line `database.env` ignore pattern (`23c0d30`), which its description must disclose.
- Fetched the selected base and current remote head. Configured current-branch tracking and completed fast-forward-only synchronization: already up to date. The selected base is an ancestor of the branch, permitting fast-forward integration.
- Native PowerShell equivalents of the inspected safe Git helpers are used because repository instructions prohibit direct `.sh` execution. The GitHub connector creates the PR, honoring the available service tool preference. No shared configuration changes, force pushes, conflict resolutions, broad untracked staging, or generated/environment files are included.
- Final landing validation passed: 345 frontend tests, TypeScript, scoped Biome, production build with unchanged asset hashes, and refreshed independent review with no actionable findings. Exact scoped staging and staged-diff checks cover 16 source/test files and four goal/spec/review records.
