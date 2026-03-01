#!/usr/bin/env bash
set -euo pipefail

POSITIONAL_ARGS=()
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load persisted CODEX_ROOT/CODEX_SCRIPTS_DIR for Stage 2 consistency.
if [[ -f "${SCRIPT_DIR}/read-codex-paths.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/read-codex-paths.sh" >/dev/null 2>&1 || true
fi

usage() {
  echo "Usage (canonical): ./.codex/scripts/prepare-takeoff-worktree.sh <task-name> [expected-branch]"
  echo "Usage (repo-local fallback): ./codex/scripts/prepare-takeoff-worktree.sh <task-name> [expected-branch]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/prepare-takeoff-worktree.sh <task-name> [expected-branch]"
  echo "Example: ./.codex/scripts/prepare-takeoff-worktree.sh add-performer-search codex/add-performer-search"
  echo "Note: this helper no longer creates or switches worktrees."
}

for arg in "$@"; do
  case "${arg}" in
    -h|--help)
      usage
      exit 0
      ;;
    *)
      POSITIONAL_ARGS+=("${arg}")
      ;;
  esac
done

TASK_NAME="${POSITIONAL_ARGS[0]:-}"
EXPECTED_BRANCH="${POSITIONAL_ARGS[1]:-}"

if [[ "${#POSITIONAL_ARGS[@]}" -gt 2 ]]; then
  echo "Abort: too many positional arguments."
  usage
  exit 2
fi

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using only lowercase letters, digits, and hyphens."
  exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${REPO_ROOT}" ]]; then
  echo "Abort: not inside a git repository."
  exit 1
fi

cd "${REPO_ROOT}"

CURRENT_BRANCH="$(git branch --show-current)"

if [[ -z "${CURRENT_BRANCH}" ]]; then
  if [[ -n "${EXPECTED_BRANCH}" ]]; then
    echo "Abort: expected branch '${EXPECTED_BRANCH}' but repository is in detached HEAD state."
    echo "Worktree/branch switching is managed outside the agent."
    exit 1
  fi
  CURRENT_BRANCH="(detached HEAD)"
fi

if [[ -n "${EXPECTED_BRANCH}" && "${EXPECTED_BRANCH}" != "${CURRENT_BRANCH}" ]]; then
  echo "Abort: expected branch '${EXPECTED_BRANCH}' but current branch is '${CURRENT_BRANCH}'."
  echo "Worktree/branch switching is managed outside the agent."
  exit 1
fi

if [[ "${CURRENT_BRANCH}" == "main" || "${CURRENT_BRANCH}" == "master" ]]; then
  echo "Warning: running Stage 2 prep from protected branch '${CURRENT_BRANCH}'."
fi

git worktree prune

MERGE_CONFLICTS="$(git diff --name-only --diff-filter=U)"
if [[ -n "${MERGE_CONFLICTS}" ]]; then
  echo "Abort: unresolved merge conflicts detected."
  while IFS= read -r path; do
    [[ -z "${path}" ]] && continue
    echo "  - ${path}"
  done <<< "${MERGE_CONFLICTS}"
  exit 1
fi

STATUS_PORCELAIN="$(git status --porcelain)"
STATUS_COUNT="$(printf '%s\n' "${STATUS_PORCELAIN}" | sed '/^$/d' | wc -l | tr -d ' ')"

echo "Stage 2 safety prep complete."
echo "Repository: ${REPO_ROOT}"
echo "Task: ${TASK_NAME}"
echo "Branch: ${CURRENT_BRANCH}"
echo "Uncommitted entries: ${STATUS_COUNT}"
if [[ "${STATUS_COUNT}" -gt 0 ]]; then
  echo "Status summary:"
  printf '%s\n' "${STATUS_PORCELAIN}" | sed '/^$/d' | sed 's/^/  /'
fi
