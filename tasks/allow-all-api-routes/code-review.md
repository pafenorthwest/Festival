# Code Review

- Task name: allow-all-api-routes
- Findings status: none

## Context

- Base branch: `origin/main` at `be77c73189fddcbce1eb00ef94cfcd383ba138cf`.
- Diff commands: `git diff origin/main -- docker/nginx.festival.conf packages/backend/tests/nginx-security.test.ts`; inspect new task and goal artifacts.
- Changed implementation files:
  - `docker/nginx.festival.conf`
  - `packages/backend/tests/nginx-security.test.ts`
- Workflow artifacts: `goals/allow-all-api-routes/goals.v0.md`, this review, and `tasks/allow-all-api-routes/spec.md`.
- Native PowerShell equivalents replace Bash-only review helpers under the user's shell requirement.

## Findings JSON

```json
[]
```

## Evidence

- Docker config lines 95-97, 130-152, and 202-273 expand anchored explicit
  allowlist groups with supported methods and retain the existing upstream.
  No new group shadows an earlier existing route with incompatible methods.
- Independent inventory comparison finds 132 allowed public method/path pairs
  and exactly three blocked private pairs among 135 declarations. Runtime
  startup with drop/transfer enabled independently reconciles the same 135
  unique registered pairs against the declarations.
- Config lines 47-48 and 276-281 preserve explicit private health denial,
  reserved prefixes, unknown API default denial, and the frontend SPA fallback.
  Headers, body limits, safe logging, timeouts, existing method rules, and
  webhook-only ingress are unchanged; new customer groups use the existing
  customer timeout convention. Host nginx is unchanged.
- Test lines 23-130 parse this repository's flat location configuration,
  including quoted JSON and nested limit blocks, and evaluate exact-match,
  longest-prefix, ordered-regex, and GET-implies-HEAD semantics.
- Test lines 133-209 reconcile actual runtime registrations, enable conditional
  drop/transfer behavior, check every public supported method, require selected
  private/unknown locations to return 404, and prevent private proxying across
  browser methods.
- Test lines 211-278 demonstrate omission of a location or supported PATCH
  method is detected, reject unsupported DELETE for the selected new route,
  and check location precedence against an independent fixture.
- The test author reports focused regression checks passed: 7 tests and 144
  assertions, plus test formatting and backend TypeScript checks. The reviewer
  inspected final code and `git diff --check` passed; repository-wide gates
  remain separately owned by the validation agent.
- No secrets, debug logging, broad `/api` proxy, dependency changes, backend
  business changes, or unrelated file edits were introduced.

## Verification limitation

- Native `nginx -t` is unavailable: no nginx executable is installed and the
  existing Docker daemon is not running. No tools/images were installed or
  downloaded. Review confidence relies on the anchored config inspection,
  runtime route reconciliation, and policy regression tests; those model the
  syntax and location features currently used by this repository.

## Verdict

- Verdict: patch is correct
- Confidence: 0.96
- Justification: The scoped Docker allowlist expansion permits all existing public API methods while preserving private endpoints, unknown-path default denial, and frontend fallback. Runtime-inventory regression coverage and omission mutations address the original coverage gap; no actionable introduced regression was found.
