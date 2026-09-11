# Reusable frontend button component

## Goal reference

- `goals/button-component/goals.v0.md`

## Scope

### In scope

- Add a Solid `Button` component for primary, secondary, and compact-header secondary buttons.
- Migrate existing buttons matching the locked scope: unclassified `type="button"`, `secondary-button`, and `secondary-button compact-header-button` forms.
- Change component button corners and the two requested accent tokens.
- Add focused source-level test coverage for the component contract and token values.
- Replace all `shopify-submit-button` instances with the shared primary `Button` component.

### Out of scope

- Do not migrate specialized buttons such as icon, workflow-card, or organization-choice.
- Do not change non-button radius values, layouts, or interaction behavior.

## Approach

- Preserve the existing CSS class hooks through component variants so page-specific rules and visual behavior remain intact.

## Verification commands

- Lint: `bun run --cwd packages/frontend lint`
- Build: `bun run --cwd packages/frontend build`
- Tests: `bun run --cwd packages/frontend test`

## Delivery

- Delivered: Added `src/components/Button.tsx` with primary, secondary, and compact-header variants; migrated all buttons in the locked scope, including all former Shopify submit controls, while retaining required behavior; set the requested color tokens and 4px component radius; added focused source-level regression coverage.
- Exceptions: None
- Deferred work: None
- Dirty-worktree decision: continue; `.codex/scripts/goals-scaffold.sh` and `goals/task-manifest.csv` were already modified and are out of scope. Task-created goal/spec artifacts are in scope.

## Quality gate results

- Lint: passed (`bun run --cwd packages/frontend lint`)
- Build: passed (`bun run --cwd packages/frontend build`)
- Tests: passed (`bun run --cwd packages/frontend test`, 49 passing)
- Code review: pending
- Clean merge: pending
