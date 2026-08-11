#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage (canonical): ./.codex/scripts/git-commit-safe.sh <commit-message> [-- <path>...]"
  echo "Usage (repo-local fallback): ./codex/scripts/git-commit-safe.sh <commit-message> [-- <path>...]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/git-commit-safe.sh <commit-message> [-- <path>...]"
  echo "Example: ./codex/scripts/git-commit-safe.sh \"Update lifecycle git helpers\""
}

MESSAGE="${1:-}"
if [[ -z "${MESSAGE}" ]]; then
  usage
  exit 2
fi
shift

if [[ "${#MESSAGE}" -gt 200 ]]; then
  echo "Abort: commit message is unexpectedly long; provide a concise summary."
  exit 1
fi

if [[ "$#" -gt 0 ]]; then
  if [[ "$1" != "--" ]]; then
    echo "Abort: path-limited commits must separate paths with '--'."
    exit 2
  fi
  shift
fi

if [[ "$#" -gt 0 ]]; then
  git commit -m "${MESSAGE}" -- "$@"
else
  git commit -m "${MESSAGE}"
fi
