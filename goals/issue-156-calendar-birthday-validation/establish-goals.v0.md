# Establish Goals

## Status

- Task name: issue-156-calendar-birthday-validation
- Iteration: v0
- State: locked

## Request

- Fix GitHub issue #156 from PR #150: reject birthdays that match the required YYYY-MM-DD shape but are not real calendar dates before calculating a customer child's age snapshot.

## Blocking ambiguity

- None.

## Assumptions

- Only the age-snapshot birthday validator and its automated tests need to change. Existing date-format requirements and valid leap-day behavior remain unchanged.

## Goals

1. Validate parsed birthday year, month, and day as a real calendar date before calculating an age snapshot.
2. Add regression coverage for dates JavaScript would otherwise normalize and for valid leap days.

## Non-goals

- Do not alter snapshot persistence, customer authorization, API shapes, or unrelated birthday validation behavior.

## Success criteria

- [G1] Age-snapshot creation rejects calendar-invalid dates such as February 31.
- [G1] Valid leap-day birthdays are accepted when the year is a leap year.
- [G2] The relevant automated test suite passes with regression coverage for the above cases.

## Next action

- Hand off to implement.
