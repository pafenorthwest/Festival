# Goals Extract
- Task name: review-pr-150-fix-open-issue
- Iteration: v1
- State: ready-for-confirmation

## Goals

1. Review PR #150 and record an evidence-backed correctness verdict with exact citations for any actionable finding.
2. Implement #158 by using `postgres:17-alpine` and `festival_sepv2_db` in the local Docker configuration, environment defaults, and setup guidance.
3. Add or update focused verification that proves the local configuration consistently targets the new image and database.


## Non-goals

- Do not redesign the canonical schema (#159), repository initialization (#160), contract tests (#161), onboarding (#162), or application versioning (#163).
- Do not reset or delete a local PostgreSQL volume or preserve/migrate legacy data.
- Do not alter unrelated PR #150 changes.


## Success criteria

- [G1] The PR review has exact citations and a valid correctness verdict.
- [G2] Docker Compose uses `postgres:17-alpine`; `POSTGRES_DB`, health check, backend `DATABASE`, and `develop.env` use `festival_sepv2_db`.
- [G3] Setup documentation no longer instructs a new developer to create or use `festival_db` as the default.
- [G4] Focused automated checks and relevant formatting/lint checks pass.

