# establish-goals

## Status

- Iteration: v0
- State: blocked
- Task name (proposed, kebab-case): init-org-page

## Request restatement

- Implement the multi-tenant organizational onboarding and landing flow described in `specs/Multi-Tenant-Starter.md`, but stop at goal lock and ask clarifying questions before any planning or code changes.

## Context considered

- Repo/rules/skills consulted:
  - `/Users/eric/pafenorthwest/Festival/AGENTS.md`
  - `/Users/eric/.codex/skills/acac/SKILL.md`
  - `/Users/eric/.codex/skills/establish-goals/SKILL.md`
  - `/Users/eric/pafenorthwest/Festival/project-structure.md`
- Relevant files (if any):
  - `/Users/eric/pafenorthwest/Festival/specs/Multi-Tenant-Starter.md`
  - `/Users/eric/pafenorthwest/Festival/specs/Style.md`
  - `/Users/eric/pafenorthwest/Festival/package.json`
  - `/Users/eric/pafenorthwest/Festival/packages/frontend/src/App.tsx`
  - `/Users/eric/pafenorthwest/Festival/packages/frontend/src/lib/api.ts`
  - `/Users/eric/pafenorthwest/Festival/packages/backend/src/app.ts`
  - `/Users/eric/pafenorthwest/Festival/packages/backend/src/routes/api-router.ts`
  - `/Users/eric/pafenorthwest/Festival/packages/frontend/package.json`
  - `/Users/eric/pafenorthwest/Festival/packages/backend/package.json`
- Constraints (sandbox, commands, policy):
  - Goal lock stage only; no implementation or planning allowed yet.
  - Establish-goals artifacts must be created and validated through the approved `./.codex/scripts/*` workflow.
  - Root verification commands are `bun run lint`, `bun run build`, and `bun run test`.

## Ambiguities

### Blocking (must resolve)

1. The spec requires Firebase authentication and Hono APIs, but the repository currently uses SolidJS on the frontend and Express on the backend. It is unclear whether this task should introduce Firebase and replace Express with Hono, or preserve the current stack and implement equivalent behavior within it.
2. The organizational URL rule is underspecified. "`base name` + organization name" does not define whether the app should use path-based routing such as `/org/<name>`, subdomains, or another convention.
3. The data persistence scope is unclear. The spec says to create database tables with Firebase and use a single Firebase tenant, but it does not define whether Firestore, Realtime Database, or another persistence layer is required.
4. The invite flow says invited users go to an invite landing page and after signup continue to a "create organization landing page". It is unclear whether invited users should land on the shared organization landing page or a separate post-acceptance screen.
5. The spec requires Google SSO and email login, but it does not define whether email login means passwordless email link, email/password, or a placeholder local login flow.

### Non-blocking (can proceed with explicit assumptions)

1. The organization slug validation should be lowercase letters and hyphens only, maximum 40 characters, with uniqueness enforced case-insensitively.
2. The initial UI should follow the theme direction in `specs/Style.md` without requiring a full Skeleton integration if the current frontend can implement the same visual tokens directly.

## Questions for user

1. Should this task actually migrate the backend from Express to Hono and add real Firebase auth/storage now, or should I keep the existing repo stack and build the organization flow using the current SolidJS + Express architecture?
2. What exact login modes do you want for "email login": email/password, passwordless email link, or a temporary mocked email flow for this starter?
3. What URL format should the organization landing page use: `/org/<organization-slug>`, another path shape, or subdomains?
4. For persistence, do you want Firebase Firestore specifically, or is another Firebase-backed storage/auth combination acceptable?
5. When an invited user completes signup, should they land directly on the shared organization landing page for their organization, or on a separate invite confirmation page first?

## Assumptions (explicit; remove when confirmed)

1. The user-provided task name `init-org-page` is accepted as the stable kebab-case task name.
2. This task is intended to cover a starter-grade but functioning end-to-end flow, not production-hardening concerns such as email delivery infrastructure, CI/CD, or advanced tenancy isolation.

## Goals (1-20, verifiable)

1. Define and document the accepted architecture for this feature set, including whether the implementation must use real Firebase authentication/storage and whether the backend framework remains Express or changes to Hono.
2. Add a default no-organization landing experience that presents welcome content and starts the sign-up flow for creating a new organization.
3. Add an organization-creation flow that captures an organization name, enforces the allowed slug rules and uniqueness requirement, and records the creator as the default admin role.
4. Add invitation creation and acceptance flows that let an admin invite users by email with one of the specified roles and let an invited user complete sign-up into the assigned organization role.
5. Add an organization landing page routed by the confirmed organization URL scheme and showing the required organization name, logout affordance, and role-specific welcome message.
6. Add backend APIs and persistence needed to create organizations, users, invitations, and role assignments, with authenticated requests using the agreed JWT or Firebase token mechanism.
7. Connect the frontend to the new organization APIs and auth state so existing users are routed to their organization landing page after login.
8. Add or update automated tests to cover the new auth/org flows and keep the repository-level `lint`, `build`, and `test` verification commands passing.

## Non-goals (explicit exclusions)

- Production deployment, domain management, and CI/CD setup.
- Full enterprise tenancy features beyond the starter flows explicitly described in `specs/Multi-Tenant-Starter.md`.

## Success criteria (objective checks)

> Tie each criterion to a goal number when possible.

- [G1] A locked decision exists for the required auth, persistence, token, and backend framework choices, and downstream implementation stays within that confirmed architecture.
- [G2] The frontend exposes a no-org landing page with a sign-up entry point that can be cancelled back to the landing page.
- [G3] Organization creation rejects invalid slugs, enforces the length limit, prevents duplicate names, and records the creator as an admin.
- [G4] Admins can create role-based invites and invited users can complete the acceptance flow into the assigned role.
- [G5] Authenticated users with an organization are routed to the organization landing page using the confirmed URL scheme and see the required header and welcome message.
- [G6] Backend endpoints exist for the new organization/auth flows and reject unauthorized requests.
- [G7] Frontend API integration uses the authenticated token mechanism agreed in Goal 1.
- [G8] `bun run lint`, `bun run build`, and `bun run test` pass with coverage for the new organization/auth behavior.

## Risks / tradeoffs

- Requiring real Firebase plus a Hono migration materially expands scope compared with preserving the current Express-based starter architecture.
- Auth-provider and invite-flow decisions directly affect data modeling, routing, test strategy, and which dependencies must be introduced.

## Next action

- Await user answers to blocking questions, then revise goals and move to ready-for-confirmation or locked state.
