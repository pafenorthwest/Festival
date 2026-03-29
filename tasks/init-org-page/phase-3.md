# Phase 3 — Verification And Closeout

## Objective
Validate the workflow/documentation follow-up and capture the required closeout evidence for landing.

## Code areas impacted
- `tasks/init-org-page/final-phase.md`
- `tasks/init-org-page/phase-plan.md`
- repo verification outputs

## Work items
- [ ] Run the pinned root verification commands.
- [ ] Update `final-phase.md` with evaluated checklist items and explicit lint/build/test outcomes.
- [ ] Revalidate the task so Stage 4 can emit `READY TO LAND`.

## Deliverables
- Passing local verification for lint, build, and tests.
- Updated final-phase evidence for landing.

## Gate (must pass before proceeding)
All pinned verification commands pass and the closeout ledger records the outcomes truthfully.
- [ ] Lint, build, and tests are recorded as PASS in `final-phase.md`.

## Verification steps
- [ ] Command: `bun run lint`
  - Expected: exits successfully.
- [ ] Command: `bun run build`
  - Expected: exits successfully.
- [ ] Command: `bun run test`
  - Expected: exits successfully without requiring live DB or Firebase services.
- [ ] Command: `./.codex/scripts/implement-validate.sh init-org-page`
  - Expected: emits `READY TO LAND` after the final-phase ledger is updated.

## Risks and mitigations
- Risk: documentation-only changes mask a workflow or command mismatch that only shows up during validation.
- Mitigation: run the pinned commands locally and keep the final-phase ledger synchronized with the actual outcomes.
