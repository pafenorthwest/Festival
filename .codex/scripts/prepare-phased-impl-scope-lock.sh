#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
SPEC_FILE="${TASK_DIR}/spec.md"
LOCK_FILE="${TASK_DIR}/.scope-lock.md"

usage() {
  echo "Usage (canonical): ./.codex/scripts/prepare-phased-impl-scope-lock.sh <task-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/prepare-phased-impl-scope-lock.sh <task-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/prepare-phased-impl-scope-lock.sh <task-name>"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

if [[ ! -f "${SPEC_FILE}" ]]; then
  echo "Abort: missing ${SPEC_FILE}"
  exit 1
fi

extract_section() {
  local heading_regex="$1"
  awk -v heading_regex="${heading_regex}" '
    $0 ~ heading_regex {in_section=1; next}
    /^## / && in_section {exit}
    in_section {print}
  ' "${SPEC_FILE}"
}

IN_SCOPE="$(extract_section '^##[[:space:]]+IN SCOPE$')"
OUT_SCOPE="$(extract_section '^##[[:space:]]+OUT OF SCOPE$')"

if [[ -z "${IN_SCOPE//[[:space:]]/}" ]]; then
  echo "Abort: missing or empty '## IN SCOPE' section in ${SPEC_FILE}"
  exit 1
fi

if [[ -z "${OUT_SCOPE//[[:space:]]/}" ]]; then
  echo "Abort: missing or empty '## OUT OF SCOPE' section in ${SPEC_FILE}"
  exit 1
fi

{
  echo "## IN SCOPE"
  printf '%s\n' "${IN_SCOPE}"
  echo
  echo "## OUT OF SCOPE"
  printf '%s\n' "${OUT_SCOPE}"
} > "${LOCK_FILE}"

echo "Scope lock written: ${LOCK_FILE}"
