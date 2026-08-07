# Revalidate Code Review
- Task name: build-shopify-festival-app
- Findings status: complete

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
- Generated at: 2026-08-07T23:26:52Z
- Base branch: main
- Diff mode: base-branch
- Diff command: `git diff main...HEAD`
- Diff bytes: 127901

### Changed files
- `bun.lock`
- `packages/backend/src/app.ts`
- `packages/backend/src/repo/in-memory-organization-repository.ts`
- `packages/backend/src/repo/organization-repository.ts`
- `packages/backend/src/repo/postgres-organization-repository.ts`
- `packages/backend/src/routes/api-router.ts`
- `packages/backend/src/services/organization-service.ts`
- `packages/backend/tests/organization-routes.test.ts`
- `packages/common/src/organization.ts`
- `packages/common/tests/organization.test.ts`
- `packages/frontend/package.json`
- `packages/frontend/src/App.tsx`
- `packages/frontend/src/lib/api.ts`
- `packages/frontend/src/lib/routes.ts`
- `packages/frontend/src/main.tsx`
- `packages/frontend/src/styles.css`
- `packages/frontend/tests/onboarding-integration.test.ts`
- `packages/frontend/tests/routes.test.ts`
- `packages/frontend/tests/verification.test.ts`
- `specs/Multi-Tenant-Starter.md`
- `specs/tech-requirements.md`

### Citation candidates (verify before use)
- `packages/backend/src/services/organization-service.ts:154-164`
- `packages/backend/src/services/organization-service.ts:234-239`
- `packages/backend/src/services/organization-service.ts:258-361`
- `packages/backend/src/services/organization-service.ts:534-546`
- `packages/frontend/src/App.tsx:533-542`
- `packages/frontend/src/App.tsx:562-577`
- `packages/frontend/src/App.tsx:649-655`
- `packages/frontend/src/App.tsx:755-802`
- `packages/frontend/src/App.tsx:834-877`
- `packages/frontend/src/App.tsx:1351-1518`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[
  {
    "file": "packages/backend/src/services/organization-service.ts",
    "line_range": "154-164",
    "severity": "medium",
    "explanation": "After splitting organization display name from short-name slug, creation only checks for an existing slug before inserting. Postgres still has a unique organization name constraint, so creating the same organization name with a different short name bypasses the service's conflict path and fails as an unhandled 500 in production, while the in-memory test repository allows the duplicate."
  },
  {
    "file": "packages/frontend/src/App.tsx",
    "line_range": "533-542",
    "severity": "medium",
    "explanation": "The route effect now loads organization data for the new admin routes, but the same effect also reads sessionMembership and loadOrganization updates session.membership. On /org/:slug/admin and its subroutes each successful fetch changes the session object, retriggers the effect, and issues another getOrganization request indefinitely."
  }
]
```

## Overall Correctness Verdict
- Verdict: patch is incorrect
- Confidence: 0.87
- Justification: The branch passes the current verification commands, but it introduces an organization-name uniqueness gap in the service/repository contract and repeated organization fetches on the new admin routes.
