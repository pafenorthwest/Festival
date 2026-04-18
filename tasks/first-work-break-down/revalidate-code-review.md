# Revalidate Code Review
- Task name: first-work-break-down
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
- Generated at: 2026-04-18T17:03:38Z
- Base branch: main
- Diff mode: base-branch
- Diff command: `git diff main...HEAD`
- Diff bytes: 18963

### Changed files
- `README.md`
- `specs/ROADMAP-2026.md`
- `specs/SIDEQUESTS-2026.md`
- `specs/festival-software-timeline-2026.png`

### Citation candidates (verify before use)
- `README.md:1-56`
- `README.md:57-57`
- `specs/ROADMAP-2026.md:1-283`
- `specs/SIDEQUESTS-2026.md:1-456`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.95
- Justification: The task work is limited to lifecycle artifacts and GitHub backlog issue creation. I did not find a correctness, security, or maintainability problem in the scoped changes that would block landing.
