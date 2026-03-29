# Revalidate Code Review
- Task name: document-setup-instructions
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
- Generated at: 2026-03-29T20:59:14Z
- Base branch: main
- Diff mode: fallback
- Diff command: `git diff`
- Diff bytes: 9442

### Changed files
- `.codex/codex-config.yaml`
- `README.md`
- `develop.env`
- `goals/task-manifest.csv`

### Citation candidates (verify before use)
- `.codex/codex-config.yaml:15-15`
- `README.md:10-24`
- `README.md:36-39`
- `develop.env:12-12`
- `develop.env:15-21`
- `develop.env:24-24`
- `develop.env:27-31`
- `develop.env:34-34`
- `develop.env:37-38`
- `develop.env:40-42`
- `develop.env:44-45`
- `develop.env:48-48`
- `develop.env:51-53`
- `develop.env:56-56`
- `develop.env:6-7`
- `develop.env:60-60`
- `goals/task-manifest.csv:5-8`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.85
- Justification: The tracked changes stay within the locked documentation and env-sample scope, the setup guidance now matches the repo's current Firebase and PostgreSQL expectations, and no actionable correctness, security, or maintainability regressions were identified in the reviewed diff.
