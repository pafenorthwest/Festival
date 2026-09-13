# Goals Extract
- Task name: issue-156-calendar-birthday-validation
- Iteration: v0
- State: locked

## Goals

1. Validate parsed birthday year, month, and day as a real calendar date before calculating an age snapshot.
2. Add regression coverage for dates JavaScript would otherwise normalize and for valid leap days.


## Non-goals

- Do not alter snapshot persistence, customer authorization, API shapes, or unrelated birthday validation behavior.


## Success criteria

- [G1] Age-snapshot creation rejects calendar-invalid dates such as February 31.
- [G1] Valid leap-day birthdays are accepted when the year is a leap year.
- [G2] The relevant automated test suite passes with regression coverage for the above cases.

