# Code Review

- Task name: s12-common-schemas-and-typed-hono-rpc
- Packet directory: tasks/s12-common-schemas-and-typed-hono-rpc
- Locked goals: goals/s12-common-schemas-and-typed-hono-rpc/goals.v0.md
- Spec: tasks/s12-common-schemas-and-typed-hono-rpc/spec.md

## Context

- Review target: branch `refactor/s12-common-schemas-and-typed-hono-rpc` against `origin/main` (re-review after resolving prior findings `S12-001`, `S12-002`, and `S12-003`).
- Findings status: none
- Scope check: Modified and untracked files remain scoped to S12 (`bun.lock`, `packages/common/**`, `packages/backend/src/routes/**`, `packages/backend/tests/route-security.test.ts`, `packages/frontend/src/lib/api*`, `packages/frontend/tests/**`, and `tasks/s12-common-schemas-and-typed-hono-rpc/{spec,code-review}.md`).
- Goals verified:
  - `[G1]` Canonical Valibot schemas and inferred DTOs live in `packages/common/src/{tenant,catalog,customer,directory,registration,commerce,volunteers,schema-utils}.ts`, covered by `packages/common/tests/schemas.test.ts` (`bun run test:common`: 360 pass, 0 fail across 23 files). All seven schema mismatches from `S12-002` (`CreateOrganizationInputSchema`, `CreateInviteInputSchema`, `AcceptInviteInputSchema`, `CreateFestivalInputSchema`, `UpdateAccompanistPolicyInputSchema`, `JoinWaitlistBodySchema`, `WithdrawWaitlistBodySchema`) now match canonical `@festival/common` DTO contracts and backend route payloads, and `nonEmptyText` is consolidated in `packages/common/src/schema-utils.ts` (`S12-003`).
  - `[G2]` Backend route builders chain Hono handlers with `jsonValidator` / `queryValidator` and `preValidationGuard` from `packages/backend/src/routes/shared/schema-validator.ts`, wiring 73 of 102 `*Schema` exports across routes (the remaining 29 are response DTOs, sub-schemas, or strict payload schemas paired with route-body variants) and exporting strict `AppType` definitions (`OrgAdminRoutesType`, `CatalogRoutesType`, `CustomerRoutesType`, `DirectoryRoutesType`, `RegistrationRoutesType`, `CommerceRoutesType`, `VolunteersRoutesType`, `AuthRoutesType`, `ApiRoutesType`). Every frontend client module under `packages/frontend/src/lib/api/*.ts` invokes typed `hc` `$get`/`$post`/`$patch`/`$put`/`$delete` RPC calls via `client.ts` (`rpcCall` / `rpcQuery` / `unwrapRpcResponse`, zero remaining `requestJson`), with strict typechecks passing in both `packages/backend` and `packages/frontend`. Remaining intentional custom JSON/query reads are confined to OAuth redirect query params (`customer-auth.routes.ts`), private runtime webhook/reconciliation routes returning 404 before auth (`private-runtime.routes.ts`), `readValidJsonOrBody` helper fallback (`customer-class-checkout.routes.ts`), and `schema-validator.ts` itself (`communication.routes.ts` line 243 re-reads `c.req.json()` after `triggerEventValidator` already runs on line 328).
  - `[G3]` `packages/frontend/src/lib/api.ts` is reduced to a 120-line barrel (`<=200L`). Every non-test `.ts` source file created or modified in S12 is `<=500` lines (`packages/frontend/src/lib/api/registration.ts` is 500L; `packages/backend/src/routes/customer/customer-class-checkout.routes.ts` is 499L), and no modified or new function exceeds 60 lines (`validateCreateRoomInput` at 70L in `packages/common/src/room.ts` is untouched pre-existing code). Internal route and client helpers were refactored to `<=3` parameters (`S12-003`); remaining `>3`-parameter non-test functions are pre-existing exported frontend API signatures and `ApiError`.
  - `[G4]` `packages/backend/src/routes/route-security.ts` is 153 lines (`<=300L`) using co-located metadata helpers (`packages/backend/src/routes/shared/route-security-metadata.ts`), and `assertRouteSecurityInventory(app.routes)` fails closed across all 171 mounted routes (`packages/backend/tests/route-security.test.ts`).
- Verification observed on current workspace state:
  - `bun run format:check`: exit 0 (`792` files checked).
  - `bun run lint`: exit 0 (`792` files checked).
  - `bun run check:sql`: exit 0 (`495` backend TypeScript files validated).
  - `bun run build`: exit 0 (`verify:toolchain`, `build:common`, `build:backend`, `build:frontend`, `build:confirmation`).
  - `bun run --cwd packages/frontend check:types`: exit 0.
  - `bunx --bun tsc -p packages/backend/tsconfig.json --noEmit`: exit 0.
  - `bun run test:common`: `360 pass, 0 fail` across `23` files (`62.00ms`).
  - `bun run test:frontend`: `476 pass, 0 fail, 2611 expect() calls` across `54` files (`1417.00ms`).
  - `bun run test:confirmation`: `20 pass, 0 fail, 29 expect() calls` across `1` file (`9.00ms`).
  - `packages/backend` tests (`POSTGRES_INTEGRATION_URL` / `DATABASE_URL` = `postgres://postgres:postgres@127.0.0.1:5432/festival_test`, all `152` test files executed across four non-contending batches): `1,624 pass, 0 fail, 9,541 expect() calls` (`1275 pass` across `116` files `< read-models-query-count.integration.test.ts` excluding `migrate-runner.test.ts` in `52.81s`; `9 pass` in `tests/migrate-runner.test.ts` in `461.00ms`; `3 pass` in `tests/read-models-query-count.integration.test.ts` in `1183.00ms`; `337 pass` across `34` files `> read-models-query-count.integration.test.ts` in `2.28s`). Note: invoking `bun run --cwd packages/backend test` as a single unbatched run stalled after `tests/migrate-runner.test.ts`.

## Findings JSON

```json
[]
```

## Verdict

- Verdict: patch is correct
- Confidence: high
- Justification: Independent re-review against `goals/s12-common-schemas-and-typed-hono-rpc/goals.v0.md`, `tasks/s12-common-schemas-and-typed-hono-rpc/spec.md`, and `origin/main` confirms all prior findings (`S12-001`, `S12-002`, `S12-003`) are resolved, locked goals `[G1]` through `[G4]` are satisfied within file and function limits, and formatting, linting, SQL validation, full builds, strict typechecks, and common/frontend/confirmation/backend test suites pass.
