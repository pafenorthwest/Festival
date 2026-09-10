# Goals Extract
- Task name: membership-checkout-503
- Iteration: v0
- State: ready-for-confirmation

## Goals

1. Identify the failure responsible for membership checkout returning checkout_retryable_upstream, using reproducible evidence or available runtime diagnostics.
2. Correct the confirmed cause with minimal changes and verify successful checkout plus relevant failure behavior.


## Non-goals

- Membership redesign, unrelated refactors, production deployment, real purchases, or changes to unrelated working-tree files.


## Success criteria

- [G1] Document the failing stage and supporting evidence; explicitly report any unavailable production evidence rather than guessing the cause.
- [G2] A regression test reproduces the confirmed failure and passes with the correction; relevant checkout tests and required checks pass. Preserve authentication, checkout destination validation, and idempotency safeguards.

