# Document Setup Instructions

## Overview

Document the repository's local setup path end to end. Add a dedicated `SETUP.md`, align `README.md` so it stays requirement-oriented and links to that guide, and reconcile the checked-in env files with the approved setup contract for real Firebase plus local PostgreSQL development.

## Goals

- Create `SETUP.md` with the full local setup sequence, from prerequisites through first local run.
- Align `.env` and `develop.env` with each other and with the approved setup contract.
- Document PostgreSQL setup with `database/init-user-db.sql`, explicit schema creation, and `DB_SCHEMA` alignment.
- Update `README.md` to summarize requirements and link to `SETUP.md`.
- Add official external setup links for the dependency areas involved in setup.
- Record scriptable follow-up setup work as `//TODO` items in `SETUP.md` and open a GitHub issue if such follow-up remains.
- Keep real Firebase plus local PostgreSQL as the primary setup path, with emulator or alternate paths only as optional notes.

## Non-goals

- Changing frontend, backend, Firebase, or PostgreSQL runtime behavior beyond env/documentation alignment.
- Adding deployment, CI, hosting, or production-ops setup beyond what is needed for local development.
- Expanding the task beyond documentation and env sample surfaces unless a mechanical mismatch cannot be resolved otherwise.

## Use cases / user stories

- As a developer, I can read `README.md` to see the prerequisites and where to find the detailed setup guide.
- As a developer, I can follow `SETUP.md` to configure Bun, Firebase, PostgreSQL, and the repo env files without guessing the required variables.
- As a developer, I understand that the backend uses a non-`public` Postgres schema and that `DB_SCHEMA` must match the schema I create.
- As a maintainer, I can compare `.env` and `develop.env` without conflicting naming schemes or stale setup placeholders.

## Current behavior
- Notes:
  - `README.md` currently mixes high-level project information with setup details and does not link to a dedicated setup guide.
  - `SETUP.md` does not exist.
  - The repo-root `.env` and `develop.env` currently use a mixed and partially stale naming scheme that does not cleanly reflect the approved setup contract.
  - PostgreSQL bootstrap currently has an init script for role/database creation, but the repo does not automatically create the application schema.
  - The backend code requires `DB_SCHEMA`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`; the frontend code requires `VITE_API_BASE`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, and `VITE_FIREBASE_APP_ID`.
- Key files:
  - `README.md`
  - `.env`
  - `develop.env`
  - `database/init-user-db.sql`
  - `packages/backend/src/config/env.ts`
  - `packages/backend/src/repo/postgres-organization-repository.ts`
  - `packages/backend/src/auth/firebase-auth-verifier.ts`
  - `packages/frontend/src/lib/firebase-auth.ts`
  - `packages/frontend/src/lib/api.ts`

## Proposed behavior
- Behavior changes:
  - Add `SETUP.md` as the detailed setup document.
  - Keep `README.md` concise and have it link to `SETUP.md` for the step-by-step procedure.
  - Align `.env` and `develop.env` to the approved env contract, including the required shared additions `APP_URL`, `API_URL`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_USE_EMULATOR`, `AUTH_PROVIDER`, `AUTH_MODE`, and `AUTH_REQUIRE_EMAIL_VERIFIED`.
  - Preserve the frontend URL variables `FRONT_APP_URL` and `FRONT_API_URL` while also documenting backend `APP_URL` and `API_URL`.
  - Document real Firebase plus local PostgreSQL as the primary path, with emulator or alternate flows demoted to optional notes.
- Edge cases:
  - The guide must explain that the checked-in database init SQL is not sufficient on its own because the schema must still be created manually.
  - The schema example must not imply that `public` is acceptable or assumed.
  - Any `//TODO` items must reflect genuinely scriptable setup follow-up work rather than vague future ideas.

## Technical design
### Architecture / modules impacted
- `README.md`
- `SETUP.md`
- `.env`
- `develop.env`
- `tasks/document-setup-instructions/*`

### API changes (if any)

None.

### UI/UX changes (if any)

None.

### Data model / schema changes (PostgreSQL)
- Migrations: None.
- Backward compatibility: No application schema or runtime data-shape changes.
- Rollback: Restore the previous docs and env sample surfaces.

## Security & privacy

- Do not introduce or expose secret values in the new documentation.
- Env examples should use placeholders where secrets are shown in samples.
- PostgreSQL instructions must avoid implying broad privileges beyond what local setup requires.
- Documentation should keep the distinction clear between frontend config values and backend-only secrets.

## Observability (logs/metrics)

- No runtime logging or metrics changes.
- Validation evidence will come from pinned lint/build/test commands and any GitHub issue creation output if a TODO issue is required.

## Verification Commands
> Pin the exact commands discovered for this repo (also update `./codex/project-structure.md` and `./codex/codex-config.yaml`).

- Lint:
  - `bun run format:check`
- Build:
  - `bun run build`
- Test:
  - `bun run test`

## Test strategy
- Unit: Existing unit/integration suites remain the regression check; no new behavior-specific tests are expected for documentation-only changes.
- Integration: Verify the edited docs and env files stay internally consistent with the runtime env surface and database setup requirements.
- E2E / UI (if applicable): Not in scope.

## Acceptance criteria checklist
- [ ] `SETUP.md` exists and documents the full local setup path.
- [ ] `README.md` links to `SETUP.md` and remains requirement-oriented.
- [ ] `.env` and `develop.env` are aligned with the approved env contract.
- [ ] PostgreSQL setup explicitly covers `database/init-user-db.sql`, schema creation, and `DB_SCHEMA` alignment.
- [ ] Official external setup links are present in `SETUP.md`.
- [ ] If scriptable setup work remains, `SETUP.md` includes `//TODO` items and a GitHub issue exists for that follow-up.
- [ ] Pinned verification commands pass.

## IN SCOPE
- Documentation changes in `README.md` and new `SETUP.md`.
- Env sample/config updates in `.env` and `develop.env`.
- Task lifecycle artifacts required by the repository contract.
- Creating a GitHub issue for scriptable follow-up setup work if needed.

## OUT OF SCOPE
- Runtime code changes in `packages/backend`, `packages/frontend`, or `packages/common`.
- New automation scripts or setup helpers as part of this task.
- Changing the canonical verification commands.
- Production deployment setup.

## Goal lock assertion

- Locked goals approved from `goals/document-setup-instructions/goals.v2.md`.
- No reinterpretation or expansion is allowed without reopening goal lock.

## Ambiguity check

- Blocking ambiguity: none.
- Approved setup posture: real Firebase plus local PostgreSQL is primary; emulator or alternate flows are optional notes only.
- Non-blocking implementation note: preserve frontend `FRONT_*` URL variables while also including backend `APP_URL` and `API_URL`.

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
- Sandbox and repo context:
  - Workspace-write filesystem sandbox.
  - Shell network access is restricted; external documentation links will be gathered with the web tool.
  - Current branch is `ericp/setup-instructions`.
  - Stage 2 safety prep reported uncommitted lifecycle/bootstrap artifacts only.

## Execution posture lock

- Simplicity bias is locked for downstream stages.
- Changes must stay surgical and limited to documentation, env sample surfaces, and required lifecycle artifacts.
- Fail-fast handling remains required for repo scripts and for any GitHub issue creation/auth checks.

## Change control

- Any change to goals, non-goals, success criteria, scope boundaries, or verification commands requires explicit relock.
- Override authority rests with the user.

## Readiness verdict

READY FOR PLANNING

## Implementation phase strategy
- Complexity: surgical
- Complexity scoring details: score=4; recommended-goals=1; guardrails-all-true=true; signals=/Users/eric/pafenorthwest/Festival/tasks/document-setup-instructions/complexity-signals.json
- Active phases: 1..1
- No new scope introduced: required
