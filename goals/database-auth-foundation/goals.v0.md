# Goals Extract
- Task name: database-auth-foundation
- Iteration: v0
- State: locked

## Goals (1-20, verifiable)

1. Add a Postgres migration/schema change for `app_user` with UUID primary key, unique `firebase_uid`, unique email behavior, optional `full_name`, `is_active`, and timestamp columns matching issue #16.
2. Add a Postgres migration/schema change for append-only `user_login_event` records linked to `app_user`, including duplicated `firebase_uid`, `provider`, optional IP address, optional user agent, and `login_at`.
3. Add required indexes/constraints for user lookup and audit queries, including `user_login_event.user_id`, `user_login_event.firebase_uid`, and case-insensitive email uniqueness for `app_user`.
4. Add server-side Firebase Admin token verification for `Authorization: Bearer <token>` requests and expose verified Firebase identity to downstream Hono handlers.
5. Add database access functions/types needed to find users by Firebase UID, upsert app users from Firebase identity, and insert login events without creating duplicate users for the same Firebase UID.
6. Implement `POST /api/v1/auth/sync` so an authenticated Firebase user creates a new `app_user` or updates changed email/name fields, then returns the canonical user payload.
7. Implement `POST /api/v1/auth/login-event` so an authenticated, already-synced app user can record a login event with validated provider, request IP, and user-agent metadata.
8. Implement `GET /api/v1/auth/me` so an authenticated, already-synced app user receives the canonical current user payload.
9. Add focused automated coverage for migration/schema expectations, auth middleware behavior, user repository behavior, and the three auth endpoints at the level supported by the repository's test stack.
10. Run and record the repository-pinned lint, build, and test verification commands required by the ACAC contract.


## Non-goals (explicit exclusions)

- No organization creation, organization membership, invite, role, permission, or authorization logic.
- No new organization-related database tables; if an incidental existing organization table reference is required, the table name must be `orgs`.
- No frontend authentication UI, Firebase client setup, landing page, invite flow, or session-routing UX.
- No auth providers beyond Firebase-supported Google SSO and email/password identity.
- No session context that is organization-aware.


## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] The database migration/schema defines `app_user` with the columns, defaults, and Firebase UID uniqueness required by issue #16.
- [G2] The database migration/schema defines `user_login_event` with an `app_user` foreign key, audit fields, optional IP/user-agent fields, and default login timestamp.
- [G3] Database indexes or constraints support login-event lookup by user ID and Firebase UID, and enforce case-insensitive email uniqueness for app users.
- [G4] Requests without a valid bearer token fail explicitly, and requests with a valid Firebase token expose decoded identity to handlers.
- [G5] Repository/database functions can find an app user by Firebase UID, upsert without duplicate Firebase users, update changed email/name fields, and insert login events.
- [G6] `POST /api/v1/auth/sync` verifies Firebase identity, creates a new user when absent, updates existing user email/name when changed, and returns `{ "user": ... }`.
- [G7] `POST /api/v1/auth/login-event` verifies identity, requires an existing synced user, accepts only supported providers, captures request metadata, inserts one event, and returns `{ "status": "ok" }`.
- [G8] `GET /api/v1/auth/me` verifies identity, requires an existing synced user, and returns `{ "user": ... }`.
- [G9] Automated tests or equivalent repository-supported validation cover the new behavior and failure paths.
- [G10] The pinned lint, build, and test commands complete successfully, or any blocker is documented with command output and cause.
- [G1-G10] No organization/membership/role/invite behavior is introduced, and any incidental organization database table reference uses `orgs`.

