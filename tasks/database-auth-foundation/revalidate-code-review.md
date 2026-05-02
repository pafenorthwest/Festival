# Revalidate Code Review
- Task name: database-auth-foundation
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
- Generated at: 2026-05-02T20:12:47Z
- Base branch: main
- Diff mode: fallback
- Diff command: `git diff`
- Diff bytes: 4479

### Changed files
- `.codex/codex-config.yaml`
- `goals/task-manifest.csv`
- `packages/backend/src/app.ts`
- `packages/common/src/organization.ts`

### Citation candidates (verify before use)
- `.codex/codex-config.yaml:18-18`
- `.codex/codex-config.yaml:21-22`
- `goals/task-manifest.csv:10-10`
- `packages/backend/src/app.ts:12-12`
- `packages/backend/src/app.ts:18-18`
- `packages/backend/src/app.ts:49-54`
- `packages/backend/src/app.ts:6-7`
- `packages/backend/src/app.ts:64-64`
- `packages/backend/src/app.ts:9-9`
- `packages/common/src/organization.ts:152-157`
- `packages/common/src/organization.ts:32-62`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.91
- Justification: Manual review covered tracked modifications plus untracked implementation/test files omitted by the helper context. The implementation keeps auth identity isolated from organization behavior, creates the required app-user/login-event schema and indexes, verifies bearer auth through the existing seam, validates provider input, requires sync before me/login-event, and has focused route/repository/schema coverage. Pinned lint, build, and test commands pass after a Postgres email-normalization fix identified during review.
