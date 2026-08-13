# Revalidate Code Review
- Task name: tenant-bound-shopify-secret-keyring
- Findings status: none

## Reviewer Prompt
You are acting as a reviewer for a proposed code change made by another engineer.
Focus on issues that impact correctness, performance, security, maintainability, or developer experience.
Flag only actionable issues introduced by the pull request.
When you flag an issue, provide a short, direct explanation and cite the affected file and line range.
Prioritize severe issues and avoid nit-level comments unless they block understanding of the diff.
After listing findings, produce an overall correctness verdict ("patch is correct" or "patch is incorrect") with a concise justification and a confidence score between 0 and 1.
Ensure that file citations and line numbers are exactly correct using the tools available; if they are incorrect your comments will be rejected.

## Output Schema
```json
[
  {
    "file": "path/to/file",
    "line_range": "10-25",
    "severity": "high",
    "explanation": "Short explanation."
  }
]
```

## Review Context (auto-generated)
<!-- REVIEW-CONTEXT START -->
- Generated at: 2026-08-13T05:19:08Z
- Base branch: main
- Diff mode: working-tree
- Diff command: `git diff --cached && git diff`
- Diff bytes: 126796

### Changed files
- `README.md`
- `SECURITY.md`
- `SETUP.md`
- `develop.env`
- `goals/tenant-bound-shopify-secret-keyring/establish-goals.v0.md`
- `goals/tenant-bound-shopify-secret-keyring/goals.v0.md`
- `packages/backend/src/app.ts`
- `packages/backend/src/config/env.ts`
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/shopify/encryption.ts`
- `packages/backend/src/shopify/shopify-integration-service.ts`
- `packages/backend/src/shopify/shopify-membership-product-service.ts`
- `packages/backend/tests/organization-routes.test.ts`
- `packages/backend/tests/shopify-encryption.test.ts`
- `packages/backend/tests/shopify-integration-service.test.ts`
- `packages/backend/tests/shopify-membership-product-service.test.ts`
- `specs/tech-requirements.md`
- `tasks/tenant-bound-shopify-secret-keyring/.complexity-lock.json`
- `tasks/tenant-bound-shopify-secret-keyring/.scope-lock.md`
- `tasks/tenant-bound-shopify-secret-keyring/complexity-signals.json`
- `tasks/tenant-bound-shopify-secret-keyring/final-phase.md`
- `tasks/tenant-bound-shopify-secret-keyring/lifecycle-state.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-1.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-2.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-3.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-4.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-5.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-6.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-7.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-8.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-9.md`
- `tasks/tenant-bound-shopify-secret-keyring/phase-plan.md`
- `tasks/tenant-bound-shopify-secret-keyring/revalidate-code-review.md`
- `tasks/tenant-bound-shopify-secret-keyring/risk-acceptance.md`
- `tasks/tenant-bound-shopify-secret-keyring/spec.md`

### Citation candidates (verify before use)
- `README.md:87-89`
- `SECURITY.md:11-12`
- `SETUP.md:203-203`
- `SETUP.md:211-211`
- `SETUP.md:214-215`
- `SETUP.md:218-222`
- `develop.env:51-57`
- `goals/tenant-bound-shopify-secret-keyring/establish-goals.v0.md:1-99`
- `goals/tenant-bound-shopify-secret-keyring/goals.v0.md:1-47`
- `packages/backend/src/app.ts:17-17`
- `packages/backend/src/app.ts:66-69`
- `packages/backend/src/app.ts:72-72`
- `packages/backend/src/app.ts:75-75`
- `packages/backend/src/app.ts:81-81`
- `packages/backend/src/app.ts:84-84`
- `packages/backend/src/config/env.ts:8-9`
- `packages/backend/src/config/env.ts:89-91`
- `packages/backend/src/routes/api-router.ts:301-301`
- `packages/backend/src/routes/api-router.ts:323-323`
- `packages/backend/src/routes/api-router.ts:347-347`
- `packages/backend/src/shopify/encryption.ts:112-114`
- `packages/backend/src/shopify/encryption.ts:116-127`
- `packages/backend/src/shopify/encryption.ts:130-280`
- `packages/backend/src/shopify/encryption.ts:15-15`
- `packages/backend/src/shopify/encryption.ts:17-110`
- `packages/backend/src/shopify/encryption.ts:282-286`
- `packages/backend/src/shopify/encryption.ts:289-289`
- `packages/backend/src/shopify/encryption.ts:291-299`
- `packages/backend/src/shopify/encryption.ts:302-309`
- `packages/backend/src/shopify/encryption.ts:312-315`
- `packages/backend/src/shopify/encryption.ts:317-329`
- `packages/backend/src/shopify/encryption.ts:5-13`
- `packages/backend/src/shopify/shopify-integration-service.ts:13-16`
- `packages/backend/src/shopify/shopify-integration-service.ts:41-41`
- `packages/backend/src/shopify/shopify-integration-service.ts:81-84`
- `packages/backend/src/shopify/shopify-integration-service.ts:91-94`
- `packages/backend/src/shopify/shopify-membership-product-service.ts:12-15`
- `packages/backend/src/shopify/shopify-membership-product-service.ts:143-143`
- `packages/backend/src/shopify/shopify-membership-product-service.ts:261-267`
- `packages/backend/tests/organization-routes.test.ts:14-17`
- `packages/backend/tests/organization-routes.test.ts:175-175`
- `packages/backend/tests/organization-routes.test.ts:187-187`
- `packages/backend/tests/organization-routes.test.ts:254-254`
- `packages/backend/tests/organization-routes.test.ts:265-268`
- `packages/backend/tests/organization-routes.test.ts:281-351`
- `packages/backend/tests/organization-routes.test.ts:29-37`
- `packages/backend/tests/shopify-encryption.test.ts:1-352`
- `packages/backend/tests/shopify-integration-service.test.ts:107-109`
- `packages/backend/tests/shopify-integration-service.test.ts:111-113`
- `packages/backend/tests/shopify-integration-service.test.ts:124-124`
- `packages/backend/tests/shopify-integration-service.test.ts:15-23`
- `packages/backend/tests/shopify-integration-service.test.ts:160-204`
- `packages/backend/tests/shopify-integration-service.test.ts:3-6`
- `packages/backend/tests/shopify-integration-service.test.ts:67-67`
- `packages/backend/tests/shopify-integration-service.test.ts:69-72`
- `packages/backend/tests/shopify-integration-service.test.ts:74-80`
- `packages/backend/tests/shopify-integration-service.test.ts:88-88`
- `packages/backend/tests/shopify-membership-product-service.test.ts:154-154`
- `packages/backend/tests/shopify-membership-product-service.test.ts:159-162`
- `packages/backend/tests/shopify-membership-product-service.test.ts:23-31`
- `packages/backend/tests/shopify-membership-product-service.test.ts:243-243`
- `packages/backend/tests/shopify-membership-product-service.test.ts:397-433`
- `packages/backend/tests/shopify-membership-product-service.test.ts:69-69`
- `packages/backend/tests/shopify-membership-product-service.test.ts:81-81`
- `packages/backend/tests/shopify-membership-product-service.test.ts:9-12`
- `specs/tech-requirements.md:27-29`
- `tasks/tenant-bound-shopify-secret-keyring/.complexity-lock.json:1-23`
- `tasks/tenant-bound-shopify-secret-keyring/.scope-lock.md:1-17`
- `tasks/tenant-bound-shopify-secret-keyring/complexity-signals.json:1-24`
- `tasks/tenant-bound-shopify-secret-keyring/final-phase.md:1-69`
- `tasks/tenant-bound-shopify-secret-keyring/lifecycle-state.md:1-4`
- `tasks/tenant-bound-shopify-secret-keyring/phase-1.md:1-38`
- `tasks/tenant-bound-shopify-secret-keyring/phase-2.md:1-34`
- `tasks/tenant-bound-shopify-secret-keyring/phase-3.md:1-35`
- `tasks/tenant-bound-shopify-secret-keyring/phase-4.md:1-34`
- `tasks/tenant-bound-shopify-secret-keyring/phase-5.md:1-38`
- `tasks/tenant-bound-shopify-secret-keyring/phase-6.md:1-39`
- `tasks/tenant-bound-shopify-secret-keyring/phase-7.md:1-36`
- `tasks/tenant-bound-shopify-secret-keyring/phase-8.md:1-39`
- `tasks/tenant-bound-shopify-secret-keyring/phase-9.md:1-42`
- `tasks/tenant-bound-shopify-secret-keyring/phase-plan.md:1-36`
- `tasks/tenant-bound-shopify-secret-keyring/revalidate-code-review.md:1-164`
- `tasks/tenant-bound-shopify-secret-keyring/risk-acceptance.md:1-11`
- `tasks/tenant-bound-shopify-secret-keyring/spec.md:1-231`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.95
- Justification: The staged implementation matches the locked keyring, tenant-binding, startup, redaction, and non-goal contracts. Configuration and envelope inputs are bounded and fail explicitly, AES-GCM authenticates canonical server-resolved context, service call sites preserve tenant identity, and deterministic tests plus canonical repository verification cover the introduced behavior. No actionable correctness, security, performance, maintainability, or developer-experience issue was found.
