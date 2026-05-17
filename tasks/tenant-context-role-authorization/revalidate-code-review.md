# Revalidate Code Review
- Task name: tenant-context-role-authorization
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
- Generated at: 2026-05-17T16:11:18Z
- Base branch: main
- Diff mode: fallback
- Diff command: `git diff`
- Diff bytes: 15273

### Changed files
- `.codex/codex-config.yaml`
- `.codex/scripts/gh-wrap.sh`
- `goals/task-manifest.csv`
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/tests/organization-routes.test.ts`

### Citation candidates (verify before use)
- `.codex/codex-config.yaml:19-19`
- `.codex/codex-config.yaml:22-23`
- `.codex/scripts/gh-wrap.sh:170-170`
- `.codex/scripts/gh-wrap.sh:202-202`
- `goals/task-manifest.csv:13-13`
- `packages/backend/src/routes/api-router.ts:100-100`
- `packages/backend/src/routes/api-router.ts:106-106`
- `packages/backend/src/routes/api-router.ts:111-126`
- `packages/backend/src/routes/api-router.ts:131-138`
- `packages/backend/src/routes/api-router.ts:142-143`
- `packages/backend/src/routes/api-router.ts:147-147`
- `packages/backend/src/routes/api-router.ts:19-19`
- `packages/backend/src/routes/api-router.ts:2-2`
- `packages/backend/src/routes/api-router.ts:21-21`
- `packages/backend/src/routes/api-router.ts:25-27`
- `packages/backend/src/routes/api-router.ts:36-36`
- `packages/backend/src/routes/api-router.ts:45-48`
- `packages/backend/src/routes/api-router.ts:5-5`
- `packages/backend/src/routes/api-router.ts:51-51`
- `packages/backend/src/routes/api-router.ts:57-59`
- `packages/backend/src/routes/api-router.ts:61-61`
- `packages/backend/src/routes/api-router.ts:68-73`
- `packages/backend/src/routes/api-router.ts:7-18`
- `packages/backend/src/routes/api-router.ts:76-76`
- `packages/backend/src/routes/api-router.ts:79-79`
- `packages/backend/src/routes/api-router.ts:87-87`
- `packages/backend/src/services/organization-service.ts:195-224`
- `packages/backend/src/services/organization-service.ts:22-22`
- `packages/backend/src/services/organization-service.ts:324-335`
- `packages/backend/src/services/organization-service.ts:372-396`
- `packages/backend/src/services/organization-service.ts:62-62`
- `packages/backend/tests/organization-routes.test.ts:15-18`
- `packages/backend/tests/organization-routes.test.ts:164-214`
- `packages/backend/tests/organization-routes.test.ts:286-345`
- `packages/backend/tests/organization-routes.test.ts:363-366`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.87
- Justification: The backend change centralizes auth parsing, tenant membership resolution, and role checks without adding schema or dependency changes. Authorized response paths are preserved through tenant-aware service methods, wrong-tenant and non-admin failures are explicit, and the pinned verification commands pass. `.codex/scripts/gh-wrap.sh` is a pre-existing unrelated dirty-worktree change and is excluded from this task's scope.
