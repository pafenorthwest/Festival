# Phase 3 — Documentation and Verification Closeout

## Objective
Document the new root command flows and complete repository verification with accurate lifecycle evidence.

## Code areas impacted
- `README.md`
- `tasks/add-root-dev-prod-service-commands/final-phase.md`
- any touched script/config files from earlier phases

## Work items
- [x] Update README with root development commands, production backend command, combined production command, and nginx expectations.
- [x] Record full verification evidence in `final-phase.md`.
- [x] Confirm the canonical lint/build/test commands remain unchanged.

## Deliverables
- README instructions for the new root script surface.
- Completed verification evidence for lint/build/test.
- Task artifacts updated to support Stage 4 and landing.

## Gate (must pass before proceeding)
Define objective pass/fail criteria.
- [x] README accurately describes the new command matrix and production nginx flow.
- [x] `final-phase.md` can be completed with truthful verification results.
- [x] Root lint/build/test remain the canonical validation commands.

## Verification steps
List exact commands and expected results.
- [x] Command: `bun run lint`
  - Expected: no TypeScript or workspace lint failures. PASS
- [x] Command: `bun run build`
  - Expected: all workspace packages build successfully. PASS
- [x] Command: `bun run test`
  - Expected: all workspace tests pass successfully. PASS

## Risks and mitigations
- Risk:
  - Documentation can drift from the actual command behavior if implementation changes during earlier phases.
- Mitigation:
  - Update README after the scripts are in place and verify command names/assumptions directly from the final implementation.
