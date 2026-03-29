# Revalidate Code Review
- Task name: add-root-dev-prod-service-commands
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
- Generated at: 2026-03-29T03:43:26Z
- Base branch: main
- Diff mode: fallback
- Diff command: `git diff`
- Diff bytes: 3430

### Changed files
- `.codex/codex-config.yaml`
- `README.md`
- `goals/task-manifest.csv`
- `package.json`

### Citation candidates (verify before use)
- `.codex/codex-config.yaml:23-23`
- `.codex/codex-config.yaml:26-27`
- `README.md:12-16`
- `README.md:23-25`
- `README.md:29-36`
- `goals/task-manifest.csv:4-5`
- `package.json:11-15`
<!-- REVIEW-CONTEXT END -->

## Findings JSON
```json
[]
```

## Overall Correctness Verdict
- Verdict: patch is correct
- Confidence: 0.92
- Justification: The change cleanly adds the requested root command surface, uses small helper scripts for process lifecycle handling without new dependencies, keeps frontend production serving behind checked-in nginx config, and preserves the pinned repo verification commands with passing lint/build/test results. Sandbox limits prevented full long-running smoke tests, but the exposed failure modes are explicit and consistent with the documented runtime assumptions.
