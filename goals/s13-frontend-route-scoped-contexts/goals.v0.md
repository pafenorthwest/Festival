# Goals Extract
- Task name: s13-frontend-route-scoped-contexts
- Iteration: v0
- State: locked

## Goals
1. Decompose the monolithic global SolidJS state and action controllers (`packages/frontend/src/app/createFestivalAppState.ts` at `589`L with 40+ signals and `packages/frontend/src/app/createFestivalActions.ts` at `755`L) into a minimal app-shell auth/tenant context plus lazy route-scoped SolidJS domain contexts (`admin-org`, `catalog`, `customer`, `directory`, `registration`, `admin-commerce`, `volunteers`).
2. Unify manual regex URL matching (`parseRoute` in `packages/frontend/src/lib/routes.ts` at `449`L) into declarative `@solidjs/router` route definitions with lazy-loaded route boundaries and typed URL builder helpers (`<=500`L/file).
3. Decompose oversized frontend components and hooks exceeding the 500-line ceiling—specifically `VolunteerRolesPage.tsx` (`748`L), `MusicReviewModal.tsx` (`636`L), and `useFestivalRegistrationPage.ts` (`673`L)—into cohesive subcomponents and focused hooks (`<=500`L/file, `<=60`L/fn).
4. Verify zero regressions across onboarding, Firebase staff admin, Shopify customer OAuth/account, `#361` public teacher directory, `#354` class registration/cart/recovery, repertoire review, and volunteer portal flows under strict frontend `tsc --noEmit` and unit/component tests.

## Non-goals
- Modifying `packages/backend/**`, `database/**`, or `docker/**` (owned by `S06`–`S12` and `S14`).
- Modifying `packages/common/**` or `packages/frontend/src/lib/api.ts` / `packages/frontend/src/lib/api/**` (locked by parallel Wave 3 packet `S12`).
- Implementing December functional UX enhancements (`#357` `B1`/`B2` checkout key retirement, `#362` concerto combobox, `#359` CSV import/export, `#327`–`#341`).

## Success criteria
- [G1] `createFestivalAppState.ts` (`589`L) and `createFestivalActions.ts` (`755`L) are replaced or trimmed into lean shell state (`<=250`L) plus lazy route-scoped SolidJS contexts under `packages/frontend/src/domains/*`, eliminating eager 40-signal initialization on public/customer page mounts.
- [G2] Regex `parseRoute` logic in `packages/frontend/src/lib/routes.ts` (`449`L) is unified with `@solidjs/router` nested route trees while preserving every existing URL path, query parameter (`returnTo`), and deep-link redirect contract.
- [G3] `VolunteerRolesPage.tsx` (`748`L), `MusicReviewModal.tsx` (`636`L), `useFestivalRegistrationPage.ts` (`673`L), and all touched frontend files satisfy `<=500` lines/file and `<=60` lines/function.
- [G4] `bun run --cwd packages/frontend check:types`, `bun run build:frontend`, and `bun run test:frontend` pass with `0` warnings and `0` errors, and zero files in `packages/backend/**`, `packages/common/**`, or `packages/frontend/src/lib/api*` are modified.
