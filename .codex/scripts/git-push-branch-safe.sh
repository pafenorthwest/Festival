#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage (canonical): ./.codex/scripts/git-push-branch-safe.sh <branch>"
  echo "Usage (repo-local fallback): ./codex/scripts/git-push-branch-safe.sh <branch>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/git-push-branch-safe.sh <branch>"
  echo "Example: ./codex/scripts/git-push-branch-safe.sh feature/my-task"
}

is_valid_branch() {
  local branch="$1"
  [[ "${branch}" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "${branch}" != *".."* ]] && [[ "${branch}" != */. ]] && [[ "${branch}" != ./* ]]
}

BRANCH_NAME="${1:-}"
if [[ -z "${BRANCH_NAME}" ]]; then
  usage
  exit 2
fi

if ! is_valid_branch "${BRANCH_NAME}"; then
  echo "Abort: invalid branch name '${BRANCH_NAME}'."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "${CURRENT_BRANCH}" ]]; then
  echo "Notice: detached HEAD detected; pushing HEAD to '${BRANCH_NAME}'."
  git push -u origin "HEAD:${BRANCH_NAME}"
  exit 0
fi

if [[ "${CURRENT_BRANCH}" != "${BRANCH_NAME}" ]]; then
  echo "Abort: branch argument '${BRANCH_NAME}' does not match current branch '${CURRENT_BRANCH}'."
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/${BRANCH_NAME}"; then
  echo "Abort: local branch does not exist: ${BRANCH_NAME}"
  exit 1
fi

git push -u origin "${BRANCH_NAME}"
