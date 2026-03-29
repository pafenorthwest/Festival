# Phase 1 — Setup Docs And Env Alignment

## Objective

Add the dedicated setup guide, simplify `README.md` into a requirement-oriented entry point, align `.env` and `develop.env` to the approved setup contract, and capture any remaining scriptable setup work as TODOs plus a GitHub issue if applicable.

## Code areas impacted
- `README.md`
- `SETUP.md`
- `.env`
- `develop.env`
- `database/init-user-db.sql` as a referenced artifact only
- `tasks/document-setup-instructions/*` for lifecycle evidence only

## Work items
- [x] Audit the current env/runtime surface and external dependency setup touchpoints needed for Bun, Firebase, and PostgreSQL documentation.
- [x] Create `SETUP.md` with prerequisites, dependency install steps, env-file setup, PostgreSQL bootstrap and schema creation, Firebase project setup, and local run instructions.
- [x] Update `README.md` so it lists requirements, summarizes local commands, and links to `SETUP.md` for the detailed procedure.
- [x] Align `.env` and `develop.env` to the approved env contract, preserving frontend `FRONT_*` URL entries while also including backend `APP_URL` and `API_URL` plus the required shared auth and emulator variables.
- [ ] Decide whether any setup steps remain obviously scriptable; if so, add `//TODO` items to `SETUP.md` and create a GitHub issue documenting that follow-up work. Observed: TODO items were added, but `gh issue create` failed with `GraphQL: Resource not accessible by personal access token (createIssue)`.
- [x] Run pinned repo verification and record outcomes in the task artifacts.

## Deliverables
- `SETUP.md` documents the approved primary local setup path.
- `README.md` links to `SETUP.md` and remains concise.
- `.env` and `develop.env` reflect the approved setup contract.
- Task artifacts capture verification evidence and any TODO or issue follow-up.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] `SETUP.md` covers Bun, Firebase, PostgreSQL, env setup, and local run steps with the real Firebase plus local PostgreSQL path as primary.
- [x] `README.md` and `SETUP.md` are aligned without duplicating the full setup procedure.
- [x] `.env` and `develop.env` are aligned with the approved variable set and naming rules.
- [x] PostgreSQL instructions explicitly require manual schema creation and `DB_SCHEMA` alignment.
- [ ] Any remaining scriptable setup work is either documented as TODO plus GitHub issue or explicitly determined unnecessary. Blocked by current `gh` token permission on issue creation.
- [x] Root verification commands pass.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run format:check`
  - Expected: PASS.
  - Observed: PASS.
- [x] Command: `bun run build`
  - Expected: PASS.
  - Observed: PASS.
- [x] Command: `bun run test`
  - Expected: PASS.
  - Observed: PASS.
- [x] Command: `git diff -- README.md SETUP.md develop.env`
  - Expected: only the planned documentation and env-surface changes are present.
  - Observed: planned README/develop.env edits plus new `SETUP.md`; `.env` was updated locally as a gitignored runtime file.
- [ ] Command: `gh issue create --title "Automate local setup bootstrap for env and Postgres" --body "..."`
  - Expected: returns a created issue URL or number documenting scriptable setup automation follow-up.
  - Observed: `GraphQL: Resource not accessible by personal access token (createIssue)`.

## Risks and mitigations
- Risk: the existing `.env` and `develop.env` naming mismatch could tempt a runtime-code change instead of a bounded doc and sample alignment.
- Mitigation: keep scope limited to docs and env-file surfaces; if runtime mismatch cannot be documented honestly, stop and surface the blocker.
- Risk: setup links could be sourced from non-authoritative or stale references.
- Mitigation: use official vendor documentation pages only.
- Risk: a scriptable setup follow-up could be identified late, after the docs are already written.
- Mitigation: reserve a final pass over the completed setup flow specifically to decide whether TODO plus GitHub issue creation is required.
