# Revalidate Code Review
- Task name: phase-0-organization-membership-foundation-api
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
- Generated at: 2026-05-16T16:39:45Z
- Base branch: main
- Diff mode: fallback
- Diff command: `git diff`
- Diff bytes: 18806

### Changed files
- `.codex/codex-config.yaml`
- `goals/task-manifest.csv`
- `packages/backend/src/repo/in-memory-organization-repository.ts`
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/tests/organization-routes.test.ts`
- `packages/common/src/organization.ts`

### Citation candidates (verify before use)
- `.codex/codex-config.yaml:19-19`
- `.codex/codex-config.yaml:22-23`
- `goals/task-manifest.csv:11-12`
- `packages/backend/src/repo/in-memory-organization-repository.ts:114-122`
- `packages/backend/src/repo/in-memory-organization-repository.ts:126-126`
- `packages/backend/src/repo/in-memory-organization-repository.ts:159-163`
- `packages/backend/src/repo/in-memory-organization-repository.ts:174-178`
- `packages/backend/src/repo/in-memory-organization-repository.ts:242-244`
- `packages/backend/src/repo/in-memory-organization-repository.ts:26-27`
- `packages/backend/src/repo/in-memory-organization-repository.ts:66-67`
- `packages/backend/src/repo/in-memory-organization-repository.ts:72-96`
- `packages/backend/src/repo/organization-repository.ts:39-41`
- `packages/backend/src/repo/postgres-organization-repository.ts:162-162`
- `packages/backend/src/repo/postgres-organization-repository.ts:179-184`
- `packages/backend/src/repo/postgres-organization-repository.ts:243-249`
- `packages/backend/src/repo/postgres-organization-repository.ts:268-268`
- `packages/backend/src/repo/postgres-organization-repository.ts:272-272`
- `packages/backend/src/routes/api-router.ts:91-98`
- `packages/backend/src/services/organization-service.ts:124-124`
- `packages/backend/src/services/organization-service.ts:14-14`
- `packages/backend/src/services/organization-service.ts:238-241`
- `packages/backend/src/services/organization-service.ts:243-245`
- `packages/backend/src/services/organization-service.ts:55-55`
- `packages/backend/src/services/organization-service.ts:77-77`
- `packages/backend/src/services/organization-service.ts:88-89`
- `packages/backend/src/services/organization-service.ts:95-110`
- `packages/backend/tests/organization-routes.test.ts:189-189`
- `packages/backend/tests/organization-routes.test.ts:192-211`
- `packages/backend/tests/organization-routes.test.ts:230-311`
- `packages/backend/tests/organization-routes.test.ts:39-43`
- `packages/backend/tests/organization-routes.test.ts:83-150`
- `packages/common/src/organization.ts:104-107`
- `packages/common/src/organization.ts:129-129`
- `packages/common/src/organization.ts:84-85`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.86
- Justification: The patch stays within the locked backend/common scope, adds membership listing and invite status contracts, updates in-memory and Postgres membership uniqueness to user/org pairs, preserves authenticated org and invite behavior, and passes `bun run format:check`, `bun run build`, and `bun run test`.
