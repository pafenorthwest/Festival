# Establish Goals
- Task name: s12-common-schemas-and-typed-hono-rpc
- Iteration: v0
- State: locked

## Status
Goals locked for Wave 3 (`Nov 19–22`, Group W3/W3+, Track 6: Shared Runtime Schemas & Typed Hono RPC).

## Request
Consolidate the 33 duplicated frontend DTOs in `packages/frontend/src/lib/api.ts` (`2,783`L) into `valibot`/`zod` schemas in `packages/common/src/**`, export typed Hono route groups (`hc<AppType>`), split `api.ts` into domain clients (`lib/api/org-admin.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`), and replace the static `route-security.ts` (`919`L) tuple list with co-located route-builder security metadata.

## Blocking ambiguity
None.

## Assumptions
- `S12` operates strictly on `@festival/common`, `packages/backend/src/routes/**`, and `packages/frontend/src/lib/api*`, never touching backend service/repository internals (`S09`–`S11`) or frontend SolidJS state/components (`S13`).
- Preserving existing named function and type exports on `packages/frontend/src/lib/api.ts` via barrel re-exports allows `S13` (`createFestivalAppState`, `createFestivalActions`, pages) to merge in any order without import conflicts.
- Pinning exact dependency versions in `package.json` / `bun.lock` (`valibot` or `zod`) preserves deterministic builds.

## Goals
1. Consolidate the 33 duplicated/drifted frontend DTOs from `packages/frontend/src/lib/api.ts` (`2,783`L) into shared `valibot` or `zod` runtime schemas and inferred TypeScript types in `packages/common/src/**` (`tenant.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`).
2. Refactor backend Hono routers (`packages/backend/src/routes/**`) to validate request payloads against `@festival/common` schemas and export typed Hono route groups (`AppType`) consumable via `hc<AppType>`.
3. Decompose `packages/frontend/src/lib/api.ts` (`2,783`L) into focused domain client modules (`lib/api/org-admin.ts`, `lib/api/catalog.ts`, `lib/api/customer.ts`, `lib/api/directory.ts`, `lib/api/registration.ts`, `lib/api/commerce.ts`, `lib/api/volunteers.ts`, `lib/api/auth.ts`) (`<=500`L/file, `<=60`L/fn) while retaining a clean `lib/api.ts` re-export barrel so parallel `S13` UI worktrees experience zero import breakage.
4. Replace the 919-line static tuple array in `packages/backend/src/routes/route-security.ts` with co-located declarative security metadata attached directly on each route builder, verified at boot by `assertRouteSecurityInventory(app.routes)`.

## Non-goals
- Modifying backend domain service or repository implementations under `packages/backend/src/domains/**` (`S09`–`S11`).
- Refactoring SolidJS state, `@solidjs/router` views, or frontend page/modal components (`S13`).
- Finalizing `packages/backend/src/app.ts` DI cleanup or `v0.4.0` release artifacts (`S14`).

## Success criteria
- [G1] All 33 duplicated DTO definitions in `packages/frontend/src/lib/api.ts` are replaced by canonical `@festival/common` schema exports (`tenant.ts`, `catalog.ts`, `customer.ts`, `directory.ts`, `registration.ts`, `commerce.ts`, `volunteers.ts`) with unit tests covering valid/invalid payload parsing.
- [G2] Backend route builders chain Hono handlers with `@festival/common` schema validators and export typed `AppType` definitions that compile cleanly under strict `tsc --noEmit` in both `packages/backend` and `packages/frontend`.
- [G3] `packages/frontend/src/lib/api.ts` is reduced from `2,783` lines to a thin barrel (`<=200`L) re-exporting domain clients under `packages/frontend/src/lib/api/*.ts`, with every module `<=500` lines/file and `<=60` lines/function.
- [G4] `packages/backend/src/routes/route-security.ts` (`919`L) is replaced by co-located route-builder auth/CSRF/CORS security metadata (`<=300`L verifier), and `assertRouteSecurityInventory(app.routes)` fails closed in tests if any mounted route omits explicit security classification.

## Next action
Execute `tasks/s12-common-schemas-and-typed-hono-rpc/spec.md` in an isolated Wave 3 git worktree (`refactor/s12-common-schemas-and-typed-hono-rpc`).
