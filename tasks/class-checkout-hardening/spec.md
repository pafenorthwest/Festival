# Class checkout hardening

## Goal reference

- `goals/class-checkout-hardening/goals.v0.md`

## Scope

### In scope

- Preserve the scalar repertoire snapshot persistence fix.
- Classify and safely diagnose database failures without misreporting them as
  Shopify/upstream 503s.
- Remove canary-specific debugging and prove redaction through structure rather
  than a feature flag.

### Out of scope

- Do not change the customer checkout request shape, Shopify configuration,
  database schema, or catalogue behavior.
- Do not expose SQLSTATE, database identifiers, raw errors, request data,
  customer data, tokens, or stack traces to customers.
- Do not add a feature flag or broad logging framework.

## Approach

- Keep the existing metadata transaction. Replace only its JSON-recordset
  snapshots with scalar parameter writes. Use an explicit failure classifier at
  the class checkout boundary so the API contract remains stable and safe.

## Verification commands

- Lint: `bun run lint:backend`
- Build: `bun run build:backend`
- Tests: `bun test packages/backend/tests/postgres-checkout-helpers.test.ts packages/backend/tests/class-checkout-service.test.ts packages/backend/tests/customer-registration.routes.test.ts`

## Delivery

- Delivered: scalar repertoire snapshot persistence, database-failure
  classification and safe diagnostics, production logger wiring, and focused
  service/route/persistence regression coverage.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue — only approved task artifacts and the
  implementation files described above are present.

## Quality gate results

- Lint: passed — `bun run lint:backend`
- Build: passed — `bun run build:backend`
- Tests: passed — 94 focused tests across checkout helper, class checkout
  service, and customer registration routes
- Code review: passed — no actionable findings, confidence 0.92
- Clean merge: not run — landing was not requested
