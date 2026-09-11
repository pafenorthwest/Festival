# Establish Goals

## Status

- Task name: capacity-allocation-policy
- Iteration: v0
- State: locked

## Request

- Review and reconcile the capacity/allocation policy in GitHub Issues #28 and #146 by applying the repository principles first, scoring additive options, and aligning the selected requirements before issue changes.

## Blocking ambiguity

- None. Approved: the 15-minute process refreshes capacity information for future verified-payment allocation decisions only; it never reclassifies an existing placed or waitlisted registration.

## Assumptions

- Existing paid registrations retain their placed or waitlisted outcome when capacity changes.
- A verified paid order is the only allocation trigger; browser return is non-authoritative.
- The capacity threshold applies to a class, defaults to 100, and must be a positive whole number.
- #28 remains a historical hard-capacity proposal until this policy is approved; no issue content or dependencies are changed in this goal-lock stage.

## Goals

1. Apply AGENTS.md gates: lock goals before changes, minimize scope, preserve explicit failures, require verification, and stop on drift.
2. Evaluate baseline hard capacity, dynamically editable hard capacity, and dynamically editable soft capacity as additive options using the 1/3/5/7 value scale.
3. Establish whether soft capacity is the standard for class allocation, with capacity changes affecting future allocation only and never displacing a confirmed placement.
4. If the standard is approved, reconcile #28 and #146 into one non-duplicative requirement set with explicit checkout, payment, allocation, and reconciliation boundaries.

## Non-goals

- Implementing capacity/allocation code, changing the payment flow, creating lifecycle states, automated promotion, refunds/transfers, or scheduling.
- Treating a capacity threshold as a hard purchase block or retroactively changing a confirmed registration without separately approved policy.

## Success criteria

- [G1] A written comparison scores the three capacity choices and identifies their scope/risk tradeoffs.
- [G2] The selected policy states whether capacity is hard or soft, when allocation occurs, and the outcome of a capacity decrease.
- [G3] The 15-minute process has a defined, testable effect on existing versus future registrations.
- [G4] #28 and #146 can be edited without contradictory capacity, hold, waitlist, or reconciliation requirements.

## Next action

- Reconcile #28 and #146 under the locked soft-capacity policy.
