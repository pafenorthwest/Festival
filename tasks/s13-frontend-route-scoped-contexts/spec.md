# S13 — Frontend Route-Scoped SolidJS Contexts & Component Split (Track 7)

## Goal reference
- Locked goals: `goals/s13-frontend-route-scoped-contexts/goals.v0.md`
- Goal establishment record: `goals/s13-frontend-route-scoped-contexts/establish-goals.v0.md`
- Master program ledger: `specs/pre-thanksgiving-program.md`
- Bounded context architecture: `specs/bounded-contexts-2026.md`

## Scope

### In scope
- `packages/frontend/src/app/**` (`createFestivalAppState.ts` `589`L, `createFestivalActions.ts` `755`L, `useFestivalAppController.ts`, `App.tsx`, and route shell layouts) — decompose global signals and actions into a lean auth/org-shell context (`<=250`L) plus route-mounted domain contexts.
- `packages/frontend/src/domains/**` (`admin-org/`, `catalog/`, `customer/`, `directory/`, `registration/`, `admin-commerce/`, `volunteers/`) — lazy route-scoped SolidJS context providers, domain state signals, and domain action hooks (`<=500`L/file, `<=60`L/fn).
- `packages/frontend/src/lib/routes.ts` (`449`L) — replace manual regex `parseRoute` matching with declarative `@solidjs/router` route configuration and pure path-builder utilities, preserving exact URL contracts (`/org/:slug/...`, `/org/:slug/register`, `/org/:slug/register/cart`, `/org/:slug/directory`, `/org/:slug/account`, invite & onboarding routes).
- `packages/frontend/src/pages/VolunteerRolesPage.tsx` (`748`L) and extracted volunteer role/shift subcomponents — split below `<=500`L/file and `<=60`L/fn.
- `packages/frontend/src/**/MusicReviewModal.tsx` (`636`L, introduced by `#354`) and extracted review subcomponents — split below `<=500`L/file and `<=60`L/fn.
- `packages/frontend/src/**/useFestivalRegistrationPage.ts` (`673`L, introduced by `#354`) and extracted registration cart/eligibility/checkout hooks — split below `<=500`L/file and `<=60`L/fn without altering `#354` checkout recovery semantics.
- `packages/frontend/tests/**` (excluding `packages/frontend/tests/api/**` owned by `S12`) — route resolution, domain context lifecycle, and split-component unit tests.

### Out of scope
- `packages/backend/**`, `database/**`, `docker/**`, and `scripts/**` (locked by backend/infra packets `S06`–`S12` and `S14`).
- `packages/common/**`, `packages/frontend/src/lib/api.ts`, `packages/frontend/src/lib/api/**`, and `packages/frontend/tests/api/**` (locked by parallel Wave 3 packet `S12`).

## Approach
1. **Unify `@solidjs/router` Navigation**: Audit every route pattern in `packages/frontend/src/lib/routes.ts` (`449`L) with characterization tests first. Replace regex `parseRoute` dispatch with nested `@solidjs/router` `<Route>` definitions using `lazy()` boundaries per bounded context while keeping typed URL builder functions (`buildOrgLandingPath`, `buildRegistrationCartPath`, etc.) intact.
2. **Extract Lazy Route-Scoped SolidJS Contexts**:
   - Retain only Firebase staff auth state, active organization summary, and global toast/banner notifications in the root shell provider (`packages/frontend/src/app/`).
   - Move domain-specific signals and mutations out of `createFestivalAppState.ts` (`589`L) and `createFestivalActions.ts` (`755`L) into `AdminOrgContext`, `CatalogRepertoireContext`, `CustomerIdentityContext`, `TeacherDirectoryContext`, `ClassRegistrationContext`, `AdminCommerceContext`, and `VolunteersContext` under `packages/frontend/src/domains/*`, mounted only when matching routes render.
3. **Split >500-Line Pages, Modals & Hooks**:
   - Split `VolunteerRolesPage.tsx` (`748`L) into role list/editor panel, shift table/form, and signup management subcomponents.
   - Split `MusicReviewModal.tsx` (`636`L) into piece review header/filter, repertoire item card/decision controls, and review submission hook.
   - Split `useFestivalRegistrationPage.ts` (`673`L) into focused child/catalog selection, cart state, and checkout handoff/restart hooks (`<=60`L/fn, `<=500`L/file).

## Verification commands
Execute natively in Windows PowerShell (`pwsh`):
```powershell
pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s13-frontend-route-scoped-contexts
bun run verify:toolchain
bun run format:check
bun run lint
bun run build
bun run --cwd packages/frontend check:types
bun run test
bun run check:sql
```

## Delivery
- **Lean App Shell (`packages/frontend/src/app/`)**: Reduced root state to Firebase staff auth, active organization summary, and global toast/banner notifications (`createFestivalAppState.ts`, `useFestivalAppController.ts`, `App.tsx`).
- **Declarative `@solidjs/router` Routing**: Replaced manual regex `parseRoute` dispatch with declarative `@solidjs/router` `<Route>` definitions in `AppRoutes.tsx` backed by pure path builders in `routePaths.ts`/`routes.ts`, preserving all URL contracts with `lazy()` domain boundaries.
- **7 Route-Scoped Domain Contexts (`packages/frontend/src/domains/*`)**: Extracted domain signals and actions into `admin-org`, `catalog`, `customer`, `directory`, `registration`, `admin-commerce`, and `volunteers`, mounted only on matching routes.
- **Component & Hook Splits**: Split `VolunteerRolesPage.tsx`, `MusicReviewModal.tsx`, and `FestivalClassRegistrationPage.tsx` (`useFestivalRegistrationPage.ts`) into focused subcomponents and hooks (`<=500`L/file, `<=60`L/fn).

## Quality gate results
- `pwsh -NoProfile -File .agents/skills/festival-session/scripts/validate-packet.ps1 -TaskName s13-frontend-route-scoped-contexts -RequireCodeReview`: PASS (exit 0)
- `bun run verify:toolchain`, `bun run format:check`, `bun run lint`, `bun run build`, `bun run --cwd packages/frontend check:types`, `bun run --cwd packages/backend tsc --noEmit`, `bun run check:sql`: PASS (all exit `0`)
- `bun run test:common`: `353 pass`, `0 fail`, `0 skip`
- `bun run test:frontend`: `471 pass`, `0 fail`, `0 skip` (`53` files)
- `bun run test:confirmation`: `20 pass`, `0 fail`, `0 skip`
- `bun run test:backend`: Windows Bun 1.4.2 segfault (`exit 3`) in `tests/migrate-runner.test.ts` (backend untouched; Linux CI runner verifies full backend suite)
