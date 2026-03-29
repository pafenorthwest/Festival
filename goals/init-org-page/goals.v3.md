# Goals Extract
- Task name: init-org-page
- Iteration: v3
- State: locked

## Goals (1-20, verifiable)

1. Define and document the accepted architecture for this feature set, including the current SolidJS + Hono stack, real Firebase authentication, and PostgreSQL-backed organization persistence without assuming a default database schema exists.
2. Add a default no-organization landing experience that presents welcome content and starts a sign-up flow offering Google SSO plus passwordless Firebase email-link sign-in for creating a new organization.
3. Add an organization-creation flow that captures an organization name, enforces the allowed slug rules and uniqueness requirement, and records the originating user as the `Admin` role for that organization.
4. Add invitation creation and acceptance flows that let an admin invite users by email with only these roles: `Admin`, `Division Chair`, `Music Reviewer`, `Concert Chair`, and `Read Only`, and let an invited user complete sign-up into the assigned organization role.
5. Add an organization landing page at `/org/<organization-slug>` showing the required organization name, logout affordance, role-specific welcome message, and a dismissible first-visit welcome box for newly invited users.
6. Add backend APIs and PostgreSQL persistence needed to create organizations, users, invitations, and role assignments, including database tables that store user records and their associated organizations, with authenticated requests using Firebase-authenticated tokens for backend API access and without relying on a `public` schema.
7. Connect the frontend to the new organization APIs and auth state so existing users are routed to their organization landing page after login.
8. Add or update automated tests to cover the new auth/org flows and keep the repository-level `lint`, `build`, and `test` verification commands passing.


## Non-goals (explicit exclusions)

- Production deployment, domain management, and CI/CD setup.
- Full enterprise tenancy features beyond the starter flows explicitly described in `specs/Multi-Tenant-Starter.md`.
- Production-grade onboarding content beyond a starter welcome box for first-time invited users.


## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] A locked decision exists for the Firebase auth mode, persistence, token, backend framework, and no-default-schema PostgreSQL constraint, and downstream implementation stays within that confirmed architecture.
- [G2] The frontend exposes a no-org landing page with a sign-up entry point offering Google SSO and passwordless Firebase email-link authentication, and cancellation returns to the landing page.
- [G3] Organization creation rejects invalid slugs, enforces the length limit, prevents duplicate names, and records the originating user as the `Admin` role.
- [G4] Admins can create invites only for the roles `Admin`, `Division Chair`, `Music Reviewer`, `Concert Chair`, and `Read Only`, and invited users complete the acceptance flow into the assigned role.
- [G5] Authenticated users with an organization are routed to `/org/<organization-slug>` and see the required header and welcome message, and first-time invited users see a dismissible welcome box.
- [G6] Backend endpoints exist for the new organization/auth flows, use PostgreSQL-backed org data, reject unauthorized requests, do not rely on a `public` schema being present, and persist database tables for user records plus their organization associations.
- [G7] Frontend API integration uses the authenticated token mechanism agreed in Goal 1.
- [G8] `bun run lint`, `bun run build`, and `bun run test` pass with coverage for the new organization/auth behavior.

