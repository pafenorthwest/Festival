# Goals Extract
- Task name: issue-153-postgres-festival-insert
- Iteration: v0
- State: locked

## Goals

1. Make `PostgresOrganizationRepository.createFestival` bind every target column with the corresponding value so PostgreSQL festival creation succeeds.
2. Add focused regression coverage that verifies PostgreSQL festival creation preserves its expected fields.


## Non-goals

- Do not redesign schema initialization, primary-Festival policy, or unrelated festival operations.


## Success criteria

- [G1] The target columns, SQL placeholders, and parameter list agree in `createFestival`.
- [G1] A PostgreSQL-backed festival creation succeeds and returns expected values.
- [G2] The relevant automated tests pass.

