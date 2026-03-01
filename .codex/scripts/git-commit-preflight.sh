#!/usr/bin/env bash
set -euo pipefail

conflicts="$(git diff --name-only --diff-filter=U)"
if [ -n "$conflicts" ]; then
  echo "Abort: merge conflicts/unmerged paths detected:"
  echo "$conflicts"
  exit 1
fi

branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "Preflight notice: detached HEAD detected."
  echo "Skipping branch protection and upstream fast-forward checks."
  echo "Preflight OK in detached HEAD mode."
  exit 0
fi

if ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  if [[ "${branch}" == land-the-plan/* ]]; then
    echo "Preflight notice: branch '${branch}' has no upstream yet."
    echo "Allowed for first commit on land-the-plan namespace branches."
    echo "Preflight OK on branch '${branch}' (no upstream yet)."
    exit 0
  fi

  echo "Abort: branch '$branch' has no upstream and must be pushed first."
  echo "Run: git push -u origin $branch"
  exit 1
fi

if ! pull_output="$(git pull --ff-only 2>&1)"; then
  echo "$pull_output"
  case "$pull_output" in
    *"couldn't find remote ref"*|*"no such ref"*|*"no tracking information"*)
      echo "Abort: branch '$branch' has no valid upstream ref."
      echo "Push the branch first or configure a working upstream."
      ;;
    *)
      echo "Abort: fast-forward pull failed and requires manual intervention."
      ;;
  esac
  exit 1
fi

echo "$pull_output"
echo "Preflight OK on branch '$branch' (upstream: $upstream)."
