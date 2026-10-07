# Establish Goals

## Status

- Task name: pr-250
- Iteration: v0
- State: locked

## Request

- On a new branch based on `feat/issue-248-multi-line-purchase`, fix the five confirmed PR-250 review regressions.

## Blocking ambiguity

- None.

## Assumptions

- The user's explicit request to fix the enumerated review findings approves this exact scope.

## Goals

1. Make schema initialization safe for pre-PR `registration_metadata` and `registration_catalog_values` tables.
2. Permit upgraded databases to persist metadata for every multi-line checkout intent.
3. Ensure all paid multi-line class entitlements are persisted before the webhook delivery and checkout intent become terminal.
4. Limit client-side cart cascades to prerequisite providers in the same division and age-band eligibility cohort.

## Non-goals

- Refactor unrelated portions of the multi-line purchase feature.
- Change eligibility policy, run data backfills, or alter unrelated Shopify workflows.

## Success criteria

- [G1] Initialization succeeds from the pre-PR table shapes and is repeatable.
- [G2] A multi-line checkout can insert all corresponding metadata rows on an upgraded schema.
- [G3] A failed multi-line projection remains retryable and cannot terminally persist only some line entitlements.
- [G4] Removing a same-subtype class in another division or age band does not affect the dependent cascade.

## Next action

- Hand off to implement.
