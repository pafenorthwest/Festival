# Init Org Page

## Overview
Implement starter multi-tenant organization onboarding on the current SolidJS + Hono monorepo using Firebase authentication and PostgreSQL-backed organization persistence. The feature set covers no-org entry, organization creation, role-based invites, invite acceptance, and organization landing routing at `/org/<organization-slug>`.

## Goals
1. Define the architecture around the current `SolidJS + Hono` stack, real Firebase authentication, and PostgreSQL organization persistence without assuming any default database schema exists.
2. Add a no-org landing page with Google SSO and passwordless Firebase email-link sign-in to start organization creation.
3. Add organization creation with slug validation, uniqueness, and the originating user recorded as the `Admin` role.
4. Add invite creation and acceptance where invited users may only be assigned `Admin`, `Division Chair`, `Music Reviewer`, `Concert Chair`, or `Read Only`.
5. Add the organization landing page at `/org/<organization-slug>` with organization name, logout, role message, and a dismissible first-visit welcome box for invited users.
6. Add authenticated backend APIs and PostgreSQL persistence for organizations, users, invites, and roles, including database tables for user records and their organization associations, without relying on a `public` schema.
7. Connect frontend auth/API state so returning users route to their organization landing page after login.
8. Add automated coverage for the new organization/auth flows and keep `bun run lint`, `bun run build`, and `bun run test` passing.

## Non-goals
- Production deployment, domains, and CI/CD wiring.
- Enterprise tenancy features beyond the starter flows in `specs/Multi-Tenant-Starter.md`.
- Rich onboarding content beyond the starter welcome box for first-time invited users.

## Use cases / user stories
- As a new user without an organization, I can choose Google SSO or passwordless email-link sign-in and start creating an organization.
- As the originating user, I become the `Admin` for the organization I create.
- As an admin, I can invite other users into my organization with one of the allowed roles.
- As an invited user, I can accept the invite, complete sign-in, and land on my organization page with a first-visit welcome box.
- As a returning member, I sign in and route directly to my organization landing page.

## Current behavior
- Notes: the repository currently contains a festival registration app skeleton, but no organization onboarding, invite, tenancy, or authentication flows for this task.
- Key files:
  - `packages/frontend/src/App.tsx`
  - `packages/backend/src/app.ts`
  - `packages/common/src/domain.ts`
  - `specs/Multi-Tenant-Starter.md`

## Proposed behavior
- Behavior changes:
  - add frontend routes and UI states for no-org landing, sign-in choice, organization creation, invite acceptance, and organization landing;
  - add backend routes and persistence for organizations, memberships, invites, and authenticated user association;
  - use Firebase for Google SSO and passwordless email-link authentication;
  - use PostgreSQL for application data with an operator-created schema and no dependency on `public`.
- Edge cases:
  - invalid or duplicate organization slugs must be rejected;
  - sign-in cancellation must return to the no-org landing page;
  - unauthorized API access must be rejected;
  - invite acceptance must honor only the assigned role and organization;
  - first-visit welcome messaging must only appear for newly invited users.

## Technical design
### Architecture / modules impacted
- `packages/frontend/*` for routing, auth UI, invite flow, and organization landing.
- `packages/backend/*` for auth verification, organization APIs, and persistence wiring.
- `packages/common/*` for shared role, invite, organization, and membership contracts.
- Root workspace/tooling files only as needed to support dependencies and verification.

### API changes (if any)
- New or updated Hono endpoints for:
  - auth session/user bootstrap
  - organization creation
  - invite creation and acceptance
  - organization membership lookup / landing bootstrap

### UI/UX changes (if any)
- New organization onboarding and landing surfaces in the SolidJS frontend.
- Sign-in choice entry point with Google and passwordless email-link options.
- Dismissible welcome box on first invited-user landing.

### Data model / schema changes (PostgreSQL)
- Migrations: required for organization, user, membership, invite, and first-visit welcome state tables or equivalent persisted structures.
- Backward compatibility: new feature surface; no existing org schema to preserve.
- Rollback: remove newly added org/auth routes and schema objects created for this task.

## Security & privacy
- Firebase-issued identity must be verified before granting organization API access.
- No secrets may be committed; Firebase and PostgreSQL configuration stays in environment variables.
- Invite acceptance must bind the authenticated user to only the intended organization and assigned role.

## Observability (logs/metrics)
- Log auth/bootstrap failures, invite acceptance failures, and organization API authorization failures with enough context for diagnosis and without leaking secrets.

## Governing context
- Rules:
  - `.codex/rules/expand-task-spec.rules`
  - `.codex/rules/git-safe.rules`
- Skills:
  - `acac`
  - `establish-goals`
  - `prepare-takeoff`
  - `prepare-phased-impl`
  - `implement`
  - `land-the-plan`
- Sandbox constraints:
  - workspace-write filesystem
  - network-restricted shell

## Goal lock assertion
Locked goals source: `goals/init-org-page/goals.v3.md` (state: `locked`).
No reinterpretation or scope expansion is permitted without relock.

## Ambiguity check
No blocking ambiguity remains for Stage 2.
Resolved contract items include Firebase Google + passwordless email-link auth, `/org/<organization-slug>` routing, PostgreSQL persistence, allowed invite roles, and no reliance on a `public` schema.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml` if canonical command records change).

- Lint:
  - `bun run lint`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit:
  - role, slug, invite, and org-membership rule logic in shared/backend surfaces
- Integration:
  - Hono route tests for auth bootstrap, organization creation, invites, and membership lookup
- E2E / UI (if applicable):
  - frontend tests for no-org landing, auth choice flow, organization creation, invite landing, and organization routing

## Acceptance criteria checklist
- [ ] No-org landing exposes Google SSO and passwordless email-link sign-in, with cancel returning home.
- [ ] Organization creation enforces lowercase-hyphen slug rules, maximum length, and uniqueness.
- [ ] The originating user is persisted as the `Admin` role for the created organization.
- [ ] Invite creation is limited to `Admin`, `Division Chair`, `Music Reviewer`, `Concert Chair`, and `Read Only`.
- [ ] Invited users can accept an invite and land on the shared organization page with a dismissible first-visit welcome box.
- [ ] Backend persistence includes tables or equivalent persisted structures for users and their organization associations.
- [ ] Backend routes reject unauthorized access and do not rely on a `public` schema.
- [ ] Returning authenticated users route to `/org/<organization-slug>`.
- [ ] Root `bun run lint`, `bun run build`, and `bun run test` pass.

## IN SCOPE
- Frontend changes required for organization onboarding, invite acceptance, and organization landing.
- Backend API and persistence changes required for organizations, memberships, invites, and auth-backed access control.
- Shared domain contract changes required for organization roles and tenancy data.
- PostgreSQL integration work required to operate against an operator-created non-`public` schema.
- Automated tests needed for the new org/auth behavior.

## OUT OF SCOPE
- Deployment infrastructure, CI/CD, and domain/subdomain provisioning.
- Broader tenant administration features beyond the listed roles and starter onboarding flow.
- Non-starter onboarding instructions beyond the initial dismissible welcome box.

## Execution posture lock
- Simplicity bias locked.
- Surgical changes only, limited to task surfaces.
- Fail-fast behavior required for uncertain, unauthorized, or blocked states.

## Change control
- Goal, constraint, and success-criteria changes require relock through `establish-goals`.
- Verification contract (`lint`, `build`, `test`) cannot be weakened or bypassed.
- Database schema assumptions cannot be expanded to include `public` without relock.

## Stage 2 verdict
READY FOR PLANNING

## Implementation phase strategy
- Complexity: scored:L3 (multi-surface)
- Complexity scoring details: score=12; recommended-goals=6; guardrails-all-true=false; signals=/Users/eric/.codex/worktrees/d85b/Festival/tasks/init-org-page/complexity-signals.json
- Active phases: 1..6
- No new scope introduced: required
