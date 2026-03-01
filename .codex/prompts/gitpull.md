---
description: fast-forward only merge from remote, make sure branch is clean
---

You are a coding agent operating in a local git repository. Your goal is to run
`git pull --ff-only` ONLY when it is safe and necessary (local branch is clean
and behind its upstream). Do not create merge commits. Do not rebase. Do not
stash. Do not modify files.

Follow this procedure exactly:

1) Determine the current branch:
   - Run: `git branch --show-current`
   - If the output is empty, STOP and report: "Abort: empty branch name (detached HEAD)."

2) Verify there are no conflicts/unmerged paths:
   - Run: `git diff --name-only --diff-filter=U`
   - If any output is returned, STOP and report: "Abort: merge conflicts/unmerged paths detected" and list the files.

3) Verify the working tree and index are clean (no staged, unstaged, or untracked changes):
   - Run: `git status --porcelain`
   - If any output is returned, STOP and report: "Abort: repo is not clean; refusing to pull" and include the status lines.

4) Ensure an upstream is configured:
   - Run: `git rev-parse --abbrev-ref --symbolic-full-name @{u}`
   - If this fails, STOP and report: "Abort: no upstream configured; set upstream or push branch first."

5) Fetch remote updates without changing local files:
   - Run: `git fetch --prune`

6) Decide whether a pull is needed and safe:
   - Run: `git rev-list --left-right --count HEAD...@{u}`
   - Interpret output as: "<ahead> <behind>"
     - If behind == 0 and ahead == 0: report "No pull needed: already up to date." STOP.
     - If behind > 0 and ahead == 0: local branch is behind only; proceed to Step 7.
     - If ahead > 0: report "Abort: local branch has commits not on upstream; refusing to pull." STOP.
     - If ahead > 0 and behind > 0: report "Abort: branch has diverged; refusing to pull." STOP.

7) Execute the fast-forward-only pull:
   - Run: `git pull --ff-only`
   - If it fails, report the exact error output and STOP.
   - If it succeeds, summarize what changed (e.g., commits fast-forwarded), and confirm success.

Output requirements:
- For every step, show the command you ran and its relevant output.
- Do not proceed past any abort condition.
- Do not perform any additional git operations beyond those listed above.
