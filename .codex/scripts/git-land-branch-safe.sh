#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage (canonical): ./.codex/scripts/git-land-branch-safe.sh <task-name> [agent-id] [timestamp] [--dry-run]"
  echo "Usage (repo-local fallback): ./codex/scripts/git-land-branch-safe.sh <task-name> [agent-id] [timestamp] [--dry-run]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/git-land-branch-safe.sh <task-name> [agent-id] [timestamp] [--dry-run]"
  echo "Example: ./codex/scripts/git-land-branch-safe.sh add-feature-x codex-agent 20260210153045"
}

is_valid_branch() {
  local branch="$1"
  [[ "${branch}" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "${branch}" != *".."* ]] && [[ "${branch}" != */. ]] && [[ "${branch}" != ./* ]]
}

sanitize_agent_id() {
  local raw="$1"
  printf '%s' "${raw}" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g'
}

resolve_agent_id() {
  local input="$1"
  local candidate=""

  if [[ -n "${input}" ]]; then
    candidate="${input}"
  elif [[ -n "${CODEX_AGENT_ID:-}" ]]; then
    candidate="${CODEX_AGENT_ID}"
  elif [[ -n "${AGENT_ID:-}" ]]; then
    candidate="${AGENT_ID}"
  elif [[ -n "${USER:-}" ]]; then
    candidate="${USER}"
  else
    candidate="$(whoami 2>/dev/null || true)"
  fi

  candidate="$(sanitize_agent_id "${candidate}")"
  if [[ -z "${candidate}" ]]; then
    RAND="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6 || true)"
    if [[ -z "${RAND}" ]]; then
      RAND="000000"
    fi
    candidate="agent-${RAND}"
  fi

  printf '%s' "${candidate}"
}

resolve_timestamp() {
  local input="$1"

  if [[ -n "${input}" ]]; then
    if [[ ! "${input}" =~ ^[0-9]{14}$ ]]; then
      echo "Abort: timestamp must use UTC format YYYYMMDDHHMMSS." >&2
      exit 1
    fi
    printf '%s' "${input}"
    return 0
  fi

  date -u "+%Y%m%d%H%M%S"
}

TASK_NAME=""
AGENT_ID_INPUT=""
TIMESTAMP_INPUT=""
DRY_RUN=0

POSITIONAL=()
for arg in "$@"; do
  case "${arg}" in
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      POSITIONAL+=("${arg}")
      ;;
  esac
done

if [[ "${#POSITIONAL[@]}" -lt 1 || "${#POSITIONAL[@]}" -gt 3 ]]; then
  usage
  exit 2
fi

TASK_NAME="${POSITIONAL[0]}"
AGENT_ID_INPUT="${POSITIONAL[1]:-}"
TIMESTAMP_INPUT="${POSITIONAL[2]:-}"

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -n "${CURRENT_BRANCH}" ]]; then
  echo "Abort: expected detached HEAD but current branch is '${CURRENT_BRANCH}'."
  exit 1
fi

AGENT_ID="$(resolve_agent_id "${AGENT_ID_INPUT}")"
TIMESTAMP="$(resolve_timestamp "${TIMESTAMP_INPUT}")"
LANDING_BRANCH="land-the-plan/${TASK_NAME}/${AGENT_ID}-${TIMESTAMP}"

if ! is_valid_branch "${LANDING_BRANCH}"; then
  echo "Abort: generated branch name is invalid: ${LANDING_BRANCH}"
  exit 1
fi

git fetch origin --prune

if git show-ref --verify --quiet "refs/heads/${LANDING_BRANCH}"; then
  echo "Abort: local landing branch already exists: ${LANDING_BRANCH}"
  exit 1
fi

if git ls-remote --exit-code --heads origin "${LANDING_BRANCH}" >/dev/null 2>&1; then
  echo "Abort: remote landing branch already exists on origin: ${LANDING_BRANCH}"
  exit 1
fi

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "Dry run: landing branch is available and valid."
  echo "Landing branch: ${LANDING_BRANCH}"
  exit 0
fi

git switch -c "${LANDING_BRANCH}"
echo "Landing branch prepared: ${LANDING_BRANCH}"
