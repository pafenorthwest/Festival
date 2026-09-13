# Establish Goals

## Status

- Task name: review-pr-150-fix-open-issue
- Iteration: v2
- State: locked

## Request

- Review pull request #150 for actionable regressions, then fix open issue #151.

## Review finding and selection evidence

- `PostgresOrganizationRepository.ensureReady` alters `${schema}.entitlement_grants` at lines 741–746 before creating it at lines 748–775. On a fresh schema PostgreSQL aborts at the first ALTER, which is exactly #151.
- Select #151 because it is a contained, verifiable regression found in PR #150; #157’s child issues remain out of scope.

## Assumptions

- Move the `entitlement_grants` constraint transition after the table exists while preserving existing-database compatibility behavior.
- Existing unrelated working-tree changes, if any, remain untouched.

## Goals

1. Review PR #150 and record an evidence-backed correctness verdict with exact citations for any actionable finding.
2. Fix #151 so a fresh PostgreSQL schema creates `entitlement_grants` before any constraint alteration targets it.
3. Add a focused regression test that verifies the bootstrap statement order or successfully initializes a fresh schema when the available PostgreSQL test environment permits it.

## Non-goals

- Do not undertake #157 or any child issue, including PostgreSQL 17/database provisioning, canonical-schema consolidation, or reset-only data changes.
- Do not alter unrelated PR #150 changes.

## Success criteria

- [G1] The PR review has exact citations and a valid correctness verdict.
- [G2] No bootstrap SQL alters `entitlement_grants` before its table creation.
- [G3] A fresh-schema regression test covers the order/fresh-initialization condition.
- [G4] Focused automated checks and relevant formatting/lint checks pass.

## Next action

- Request goal approval
