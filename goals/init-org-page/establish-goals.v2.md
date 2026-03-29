# establish-goals

## Status

- Iteration: v2
- State: ready-for-confirmation
- Task name (proposed, kebab-case): init-org-page

## Request restatement

- Implement the multi-tenant organizational onboarding and landing flow described in `specs/Multi-Tenant-Starter.md` on the current SolidJS + Hono stack, using real Firebase authentication with Google SSO plus passwordless email-link sign-in, and PostgreSQL-backed organization data, then stop at goal review for approval before any planning or code changes.

## Context considered

- Repo/rules/skills consulted:
  - `/Users/eric/.codex/worktrees/d85b/Festival/AGENTS.md`
  - `/Users/eric/.codex/skills/acac/SKILL.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/.codex/project-structure.md`
- Relevant files (if any):
  - `/Users/eric/.codex/worktrees/d85b/Festival/specs/Multi-Tenant-Starter.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/specs/Style.md`
  - `/Users/eric/.codex/worktrees/d85b/Festival/package.json`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/frontend/src/App.tsx`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/backend/src/app.ts`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/common/src/domain.ts`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/frontend/package.json`
  - `/Users/eric/.codex/worktrees/d85b/Festival/packages/backend/package.json`
- Constraints (sandbox, commands, policy):
  - Goal lock stage only; no implementation or planning allowed yet.
  - Establish-goals artifacts must be created and validated through the approved `./.codex/scripts/*` workflow.
  - Root verification commands are `bun run lint`, `bun run build`, and `bun run test`.
  - Backend organization data must use PostgreSQL with a connection URL assembled from environment variables in `.env` using the user-provided SSL toggle rule.
  - The PostgreSQL user is expected to create and own the schema used by the app; there is no default schema and no `public` schema available to rely on.

## Ambiguities

### Blocking (must resolve)

- None.

### Non-blocking (can proceed with explicit assumptions)

1. The organization slug validation should be lowercase letters and hyphens only, maximum 40 characters, with uniqueness enforced case-insensitively.
2. The initial UI should follow the theme direction in `specs/Style.md` without requiring a full Skeleton integration if the current frontend can implement the same visual tokens directly.
3. The existing stack reference to Hono in `package.json` and backend entrypoints is the intended backend target; the stale earlier draft reference to Express was incorrect.
4. The database connection environment file reference `.evn` is intended to mean `.env`.
5. The first successful invited-user visit to the organization landing page should show a dismissible welcome box, and later visits should not show it again unless implementation constraints force the starter to persist that dismissal only for the current user session or account record.
6. The application must not assume a `public` schema exists in PostgreSQL and should be designed so the operator creates the schema they want to use.

## Questions for user

- None. Ready for goal approval.

## Assumptions (explicit; remove when confirmed)

1. The user-provided task name `init-org-page` is accepted as the stable kebab-case task name.
2. This task is intended to cover a starter-grade but functioning end-to-end flow, not production-hardening concerns such as email delivery infrastructure, CI/CD, or advanced tenancy isolation.
3. The implementation must stay on the current SolidJS frontend and Hono backend stack.
4. Authentication must use a single Firebase tenant and include Google SSO plus passwordless email-link authentication as the primary email sign-in method.
5. Organization, membership, invite, and role data must persist in PostgreSQL rather than Firebase database products.
6. The organization landing route format is `/org/<organization-slug>`.
7. PostgreSQL connection assembly must follow the user-provided pseudo-code convention using `.env` variables `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DATABASE`, and `DB_SSL`.
8. After first successful invite acceptance, the user should land on the shared organization landing page and see a dismissible welcome box.
9. Operators are responsible for creating the database schema used by the app; the implementation cannot depend on a default `public` schema existing.

## Goals (1-20, verifiable)

1. Define and document the accepted architecture for this feature set, including the current SolidJS + Hono stack, real Firebase authentication, and PostgreSQL-backed organization persistence without assuming a default database schema exists.
2. Add a default no-organization landing experience that presents welcome content and starts a sign-up flow offering Google SSO plus passwordless Firebase email-link sign-in for creating a new organization.
3. Add an organization-creation flow that captures an organization name, enforces the allowed slug rules and uniqueness requirement, and records the creator as the default admin role.
4. Add invitation creation and acceptance flows that let an admin invite users by email with one of the specified roles and let an invited user complete sign-up into the assigned organization role.
5. Add an organization landing page at `/org/<organization-slug>` showing the required organization name, logout affordance, role-specific welcome message, and a dismissible first-visit welcome box for newly invited users.
6. Add backend APIs and PostgreSQL persistence needed to create organizations, users, invitations, and role assignments, with authenticated requests using Firebase-authenticated tokens for backend API access and without relying on a `public` schema.
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
- [G3] Organization creation rejects invalid slugs, enforces the length limit, prevents duplicate names, and records the creator as an admin.
- [G4] Admins can create role-based invites and invited users can complete the acceptance flow into the assigned role.
- [G5] Authenticated users with an organization are routed to `/org/<organization-slug>` and see the required header and welcome message, and first-time invited users see a dismissible welcome box.
- [G6] Backend endpoints exist for the new organization/auth flows, use PostgreSQL-backed org data, reject unauthorized requests, and do not rely on a `public` schema being present.
- [G7] Frontend API integration uses the authenticated token mechanism agreed in Goal 1.
- [G8] `bun run lint`, `bun run build`, and `bun run test` pass with coverage for the new organization/auth behavior.

## Risks / tradeoffs

- Real Firebase auth plus PostgreSQL-backed multi-tenant data expands scope materially beyond the current starter screens and requires careful boundary definition between auth identity and organization persistence.
- Passwordless email-link authentication requires mail-driven sign-in handling and careful invite acceptance UX, which increases integration and test complexity compared with a simple credential form.
- The first-visit welcome box requires a persistence decision during implementation for how "dismissed" is tracked per invited user.
- The no-`public`-schema PostgreSQL constraint means migrations and queries must be schema-aware from the start to avoid hidden environment coupling.

## Next action

- Present goals for user approval. If approved, mark this iteration locked and emit `GOALS LOCKED`.
