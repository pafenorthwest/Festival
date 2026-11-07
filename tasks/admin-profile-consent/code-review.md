# Code Review
- Task name: admin-profile-consent
- Findings status: none

## Context
- Base branch: feat/97-public-directory at 356a721d6695978f95ee3a24606b5c7d70d15be0
- Diff command: git diff 356a721d6695978f95ee3a24606b5c7d70d15be0 -- listed files; inspect new scoped tests and task artifacts
- Scope: Current-version consent and awaited actor-UID audit before disclosing contacts through all four Admin profile responses; redact missing/stale consent while retaining moderation and existing self/public behavior.
- Changed production files:
  - packages/backend/src/customer/customer-account-service.ts
  - packages/backend/src/services/participant-profile-service.ts
  - packages/backend/src/routes/participant-profile/participant-profile.routes.ts
- Scoped test files:
  - packages/backend/tests/customer-account-service.test.ts
  - packages/backend/tests/participant-profile-test-harness.ts
  - packages/backend/tests/participant-profile-admin-consent.test.ts
- Review: Independent read-only production and regression-test review against the pinned base after owners reported their changes complete.

## Findings JSON
```json
[]
```

## Verdict
- Verdict: patch is correct
- Confidence: 0.98
- Justification: All four Admin handlers forward the authenticated tenant identity UID. Both profile projections await the current-version organization/customer consent lookup and its access audit before returning the existing contact projection; missing consent or a missing Customer Account service strips the role's contact fields without blocking moderation. Consent lookup and audit failures propagate before serialization. The nullable helper preserves the existing Admin customer-profile method's 404 behavior. Customer-own profile methods, public directory methods, repository data, and consent capture are unchanged. Regression tests exercise both roles and all four responses, consent versions and tenant scope, exact actor UID audits, failure redaction, missing service, unchanged own-profile fields, and the existing 404 contract. No actionable introduced defect found.

## Verification
- Prepared with native PowerShell equivalents because repository instructions prohibit executing Bash-only lifecycle helpers.
- Verified source against current files and inspected the complete scoped test diff, including the new test file. Both actual Customer Account repositories require organization/customer scope and the supplied privacy-notice version.
- Independent build verifier reported common and backend builds passed and three-file production Biome passed without installation or fixes.
- Final six-file Biome check passed without fixes; common and backend builds passed.
- The pinned focused suite passed all 154 tests with 753 assertions across eight files. The full backend suite passed 1295 tests with 26 opt-in PostgreSQL integration skips, no failures, and 4790 assertions across 113 files; no external database was configured or accessed.
- The two absent-consent regression cases fail against the exact pre-fix base in a disposable archive, exposing Teacher postal code and Accompanist phone; both pass with the fix.
