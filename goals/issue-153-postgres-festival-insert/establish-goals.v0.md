# Establish Goals

## Status

- Task name: issue-153-postgres-festival-insert
- Iteration: v0
- State: locked

## Request

- Fix GitHub issue #153 found during the requested review of PR #150: correct the PostgreSQL festival INSERT and add regression coverage.

## Blocking ambiguity

- None. The issue's source location and acceptance criteria fully specify the change, and the user's request authorizes selecting and fixing a linked issue.

## Assumptions

- PostgreSQL integration coverage can use the repository's existing test infrastructure without changing database bootstrap behavior.

## Goals

1. Make `PostgresOrganizationRepository.createFestival` bind every target column with the corresponding value so PostgreSQL festival creation succeeds.
2. Add focused regression coverage that verifies PostgreSQL festival creation preserves its expected fields.

## Non-goals

- Do not redesign schema initialization, primary-Festival policy, or unrelated festival operations.

## Success criteria

- [G1] The target columns, SQL placeholders, and parameter list agree in `createFestival`.
- [G1] A PostgreSQL-backed festival creation succeeds and returns expected values.
- [G2] The relevant automated tests pass.

## Next action

- Hand off to implement
