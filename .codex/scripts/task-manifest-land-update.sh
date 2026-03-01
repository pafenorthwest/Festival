#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"

usage() {
  echo "Usage (canonical): ./.codex/scripts/task-manifest-land-update.sh <task-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/task-manifest-land-update.sh <task-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/task-manifest-land-update.sh <task-name>"
  echo "Example: ./codex/scripts/task-manifest-land-update.sh add-performer-search"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${ROOT_DIR}" ]]; then
  echo "Abort: not inside a git repository."
  exit 1
fi

cd "${ROOT_DIR}"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ -z "${CURRENT_BRANCH}" ]]; then
  echo "Abort: detached HEAD is not supported for task manifest landing updates."
  exit 1
fi

MANIFEST_FILE="${ROOT_DIR}/goals/task-manifest.csv"
MANIFEST_FILE_REL="goals/task-manifest.csv"
if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "Abort: missing manifest file ${MANIFEST_FILE}"
  exit 1
fi

EXPECTED_HEADER="number,taskname,first_create_date,first_create_hhmmss,first_create_git_hash"
ACTUAL_HEADER="$(head -n 1 "${MANIFEST_FILE}")"
if [[ "${ACTUAL_HEADER}" != "${EXPECTED_HEADER}" ]]; then
  echo "Abort: unexpected manifest header in ${MANIFEST_FILE}"
  echo "Expected: ${EXPECTED_HEADER}"
  echo "Actual:   ${ACTUAL_HEADER}"
  exit 1
fi

if ! git rev-parse --verify HEAD >/dev/null 2>&1; then
  echo "Abort: unable to resolve current git commit (HEAD)."
  exit 1
fi

SOURCE_COMMIT_HASH="$(git rev-parse --short=7 HEAD)"
CURRENT_HHMMSS="$(date -u "+%H%M%S")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPACT_HELPER="${SCRIPT_DIR}/task-artifacts-compact.sh"
TASK_GOALS_DIR="${ROOT_DIR}/goals/${TASK_NAME}"
TASK_ARTIFACT_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
TASK_GOALS_DIR_REL="goals/${TASK_NAME}"
TASK_ARTIFACT_DIR_REL="tasks/${TASK_NAME}"

TMP_FILE="$(mktemp)"
cleanup() {
  rm -f "${TMP_FILE}"
}
trap cleanup EXIT

set +e
awk -F',' -v OFS=',' -v task="${TASK_NAME}" -v hhmmss="${CURRENT_HHMMSS}" -v commit_hash="${SOURCE_COMMIT_HASH}" '
  NR == 1 {
    print
    next
  }
  {
    if ($2 == task) {
      $4 = hhmmss
      $5 = commit_hash
      found = 1
    }
    print
  }
  END {
    if (!found) {
      exit 42
    }
  }
' "${MANIFEST_FILE}" > "${TMP_FILE}"
awk_status=$?
set -e

if [[ "${awk_status}" -eq 42 ]]; then
  echo "Abort: task '${TASK_NAME}' not found in ${MANIFEST_FILE}."
  exit 1
fi

if [[ "${awk_status}" -ne 0 ]]; then
  echo "Abort: failed to update manifest row for task '${TASK_NAME}'."
  exit 1
fi

manifest_changed=0
if cmp -s "${MANIFEST_FILE}" "${TMP_FILE}"; then
  echo "Manifest metadata already current for '${TASK_NAME}'."
  rm -f "${TMP_FILE}"
else
  mv "${TMP_FILE}" "${MANIFEST_FILE}"
  manifest_changed=1
fi

if [[ ! -x "${COMPACT_HELPER}" ]]; then
  echo "Abort: missing executable compaction helper ${COMPACT_HELPER}"
  exit 1
fi

"${COMPACT_HELPER}" "${TASK_NAME}"

git add -A "${MANIFEST_FILE}" "${TASK_ARTIFACT_DIR}"
if [[ -d "${TASK_GOALS_DIR}" ]]; then
  git add -A "${TASK_GOALS_DIR}"
fi

mapfile -t STAGED_SCOPED_FILES < <(
  git diff --cached --name-only -- \
    "${MANIFEST_FILE_REL}" \
    "${TASK_ARTIFACT_DIR_REL}" \
    "${TASK_GOALS_DIR_REL}"
)

if [[ "${#STAGED_SCOPED_FILES[@]}" -eq 0 ]]; then
  echo "No staged manifest/compaction changes detected for '${TASK_NAME}'."
  exit 0
fi

if [[ "${manifest_changed}" -eq 1 ]]; then
  COMMIT_MESSAGE="Update task manifest metadata and compact task artifacts for ${TASK_NAME}"
else
  COMMIT_MESSAGE="Compact task artifacts for ${TASK_NAME}"
fi

git commit -m "${COMMIT_MESSAGE}" -- "${STAGED_SCOPED_FILES[@]}"

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push origin "${CURRENT_BRANCH}"
else
  PUSH_HELPER="${SCRIPT_DIR}/git-push-branch-safe.sh"

  if [[ ! -x "${PUSH_HELPER}" ]]; then
    echo "Abort: missing executable push helper ${PUSH_HELPER}"
    exit 1
  fi

  "${PUSH_HELPER}" "${CURRENT_BRANCH}"
fi

echo "Updated land artifacts for task '${TASK_NAME}' (manifest_changed=${manifest_changed}, hhmmss=${CURRENT_HHMMSS}, commit=${SOURCE_COMMIT_HASH})."
echo "Manifest/compaction commit created and pushed on branch '${CURRENT_BRANCH}'."
