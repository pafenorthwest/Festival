# Phase 1 — Schema and App-User Repository Foundation

## Objective
Create the durable Postgres identity/audit schema and backend repository foundation for app users and login events.

## Code areas impacted
- `packages/backend/src/repo/**`
- Existing backend migration/bootstrap location after confirming repository convention.
- `packages/backend/tests/**`

## Work items
- [ ] Identify the existing Postgres migration/bootstrap pattern without changing organization behavior.
- [ ] Add `app_user` schema support with UUID primary key, unique Firebase UID, email uniqueness behavior, optional full name, active flag, and timestamps.
- [ ] Add `user_login_event` schema support with app-user foreign key, duplicated Firebase UID, provider, optional IP/user-agent fields, and login timestamp.
- [ ] Add indexes/constraints for `user_login_event.user_id`, `user_login_event.firebase_uid`, and case-insensitive `app_user` email uniqueness.
- [ ] Add app-user repository types/functions for Firebase UID lookup, upsert, and login-event insert.
- [ ] Preserve the user constraint that any incidental organization table reference uses `orgs`.

## Deliverables
- Schema/migration code for `app_user` and `user_login_event`.
- App-user repository interface and Postgres implementation.
- Focused repository/schema tests or equivalent assertions.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [ ] Repository code can express find-by-Firebase-UID, upsert app user, and insert login event without duplicate Firebase users.
- [ ] Schema assertions cover required columns, indexes/constraints, and case-insensitive email uniqueness.
- [ ] No organization/membership/role/invite behavior is introduced.

## Verification steps
List exact commands and expected results.
- [ ] Command: `bun run --cwd packages/backend test`
  - Expected: backend tests covering repository/schema behavior pass.
- [ ] Command: `bun run --cwd packages/backend build`
  - Expected: backend TypeScript build passes for repository additions.

## Risks and mitigations
- Risk: Existing bootstrap code currently owns organization tables and may use legacy names.
- Mitigation: Keep auth tables isolated and do not alter organization behavior unless required by compilation, using `orgs` for any unavoidable organization table reference.
- Risk: Case-insensitive uniqueness can be implemented incorrectly as application-only logic.
- Mitigation: Use a database-level unique index or equivalent durable constraint and test/assert it.
