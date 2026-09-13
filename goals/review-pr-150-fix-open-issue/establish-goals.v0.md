# Establish Goals

## Status

- Task name: review-pr-150-fix-open-issue
- Iteration: v0
- State: ready-for-confirmation

## Request

- Review pull request #150 and its explicitly linked open issues (#129, #137, #138, #141, and #149). Select one contained, unresolved issue and implement its remaining work.

## Blocking ambiguity

- The specific open issue and exact remaining acceptance criterion must be selected from review evidence before implementation.

## Assumptions

- PR #150's body identifies #149 as partially started and specifically calls out server-side canonical Festival resolution and completed Admin context as remaining work.
- Select #149 unless review evidence identifies a smaller, safer unresolved issue with a verifiable regression test.
- Existing unrelated working-tree changes, if any, remain untouched.

## Goals

1. Review PR #150 for actionable regressions and record an evidence-backed correctness verdict.
2. Review the linked open issues and select one unresolved issue with a narrowly verifiable implementation target.
3. Implement only the selected issue's target and its focused automated tests.

## Non-goals

- Do not close, modify, or expand other linked issues.
- Do not implement payment checkout, class registration, Shopify catalog lifecycle, or scheduling unless the selected target strictly requires it.
- Do not alter unrelated PR #150 changes.

## Success criteria

- [G1] PR review produces an exact-citation verdict with no unaddressed actionable finding in the reviewed patch.
- [G2] The selected issue is open and the completed acceptance criterion is identified from its issue text and verified by tests.
- [G3] Relevant formatting and automated tests pass after the focused change.

## Next action

- Request goal approval
