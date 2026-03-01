# Revalidate Code Review
- Task name: build-shopify-festival-app
- Findings status: pending

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
- Generated at: 2026-03-01T20:53:40Z
- Base branch: main
- Diff mode: fallback
- Diff command: `git diff`
- Diff bytes: 8281

### Changed files
- `README.md`
- `goals/task-manifest.csv`
- `package.json`
- `project-structure.md`

### Citation candidates (verify before use)
- `README.md:2-24`
- `goals/task-manifest.csv:2-3`
- `package.json:11-25`
- `package.json:4-5`
- `package.json:7-9`
- `project-structure.md:11-15`
- `project-structure.md:23-23`
- `project-structure.md:25-26`
- `project-structure.md:31-31`
- `project-structure.md:36-36`
- `project-structure.md:37-37`
- `project-structure.md:4-6`
- `project-structure.md:42-42`
- `project-structure.md:43-43`
- `project-structure.md:44-44`
- `project-structure.md:48-51`
- `project-structure.md:60-62`
- `project-structure.md:65-69`
- `project-structure.md:72-74`
- `project-structure.md:8-8`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: pending
- Confidence: pending
- Justification:
