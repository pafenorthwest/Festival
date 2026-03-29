# Phase 2 — Repo Metadata And README

## Objective
Update repository metadata and contributor-facing documentation so they describe the current SolidJS + Hono, Firebase, and PostgreSQL multi-tenant starter.

## Code areas impacted
- `.codex/project-structure.md`
- `README.md`

## Work items
- [ ] Rewrite `.codex/project-structure.md` to reflect the current app purpose, workspace layout, and canonical verification commands.
- [ ] Rewrite `README.md` to replace the obsolete Shopify/Stripe description and document current local commands plus env requirements.
- [ ] Document the operator-managed PostgreSQL schema requirement and the Firebase environment variables without adding secrets.

## Deliverables
- Updated repo metadata in `.codex/project-structure.md`.
- Updated root README for the current starter.

## Gate (must pass before proceeding)
Both documentation files accurately describe the current repo and match the pinned commands selected for CI.
- [ ] Metadata and README text are consistent with the implemented multi-tenant starter and workflow commands.

## Verification steps
- [ ] Command: `sed -n '1,240p' .codex/project-structure.md`
  - Expected: the file describes the multi-tenant starter and canonical Bun commands.
- [ ] Command: `sed -n '1,240p' README.md`
  - Expected: the README documents the current stack, local commands, and Firebase/PostgreSQL env setup.

## Risks and mitigations
- Risk: repo metadata and README diverge again from the actual command set or implementation.
- Mitigation: keep both documents grounded in `package.json`, the workflow file, and the existing app structure.
