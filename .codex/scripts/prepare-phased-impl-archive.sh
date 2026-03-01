#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
PHASE_PLAN_FILE="${TASK_DIR}/phase-plan.md"
SCOPE_LOCK_FILE="${TASK_DIR}/.scope-lock.md"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

usage() {
  echo "Usage (canonical): ./.codex/scripts/prepare-phased-impl-archive.sh <task-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/prepare-phased-impl-archive.sh <task-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/prepare-phased-impl-archive.sh <task-name>"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

if [[ ! -d "${TASK_DIR}" ]]; then
  echo "Abort: missing task directory ${TASK_DIR}"
  exit 1
fi

if ! CODEX_ROOT_RESOLVED="$(resolve_codex_root tasks/_templates/phase.template.md)"; then
  echo "Abort: unable to resolve codex root for phase template."
  exit 1
fi

PHASE_TEMPLATE_FILE="${CODEX_ROOT_RESOLVED}/tasks/_templates/phase.template.md"
if [[ ! -f "${PHASE_TEMPLATE_FILE}" ]]; then
  echo "Abort: missing template ${PHASE_TEMPLATE_FILE}"
  exit 1
fi

phase_file_matches_template() {
  local phase_file="$1"
  local filename phase_num expected_file

  filename="$(basename "${phase_file}")"
  if [[ ! "${filename}" =~ ^phase-([0-9]+)\.md$ ]]; then
    return 1
  fi

  phase_num="${BASH_REMATCH[1]}"
  expected_file="$(mktemp)"
  sed "s/{{PHASE_N}}/${phase_num}/g" "${PHASE_TEMPLATE_FILE}" > "${expected_file}"

  if cmp -s "${phase_file}" "${expected_file}"; then
    rm -f "${expected_file}"
    return 0
  fi

  rm -f "${expected_file}"
  return 1
}

shopt -s nullglob
phase_files=( "${TASK_DIR}"/phase-[0-9]*.md )
shopt -u nullglob

if [[ ! -f "${PHASE_PLAN_FILE}" && "${#phase_files[@]}" -eq 0 ]]; then
  echo "No Stage 3 artifacts found for archive in ${TASK_DIR}"
  exit 0
fi

all_phase_files_template_equivalent=0
if [[ "${#phase_files[@]}" -gt 0 ]]; then
  all_phase_files_template_equivalent=1
  for phase_file in "${phase_files[@]}"; do
    if ! phase_file_matches_template "${phase_file}"; then
      all_phase_files_template_equivalent=0
      break
    fi
  done
fi

if [[ ! -f "${PHASE_PLAN_FILE}" && "${all_phase_files_template_equivalent}" -eq 1 ]]; then
  echo "No Stage 3 artifacts found for archive in ${TASK_DIR} (phase files still match templates)"
  exit 0
fi

short_hash="$(git rev-parse --short HEAD)"
archive_base="${TASK_DIR}/archive/prepare-phased-impl-${short_hash}"
archive_dir="${archive_base}"
suffix=1
while [[ -e "${archive_dir}" ]]; do
  archive_dir="${archive_base}-${suffix}"
  suffix=$((suffix + 1))
done

mkdir -p "${archive_dir}"

if [[ -f "${PHASE_PLAN_FILE}" ]]; then
  mv "${PHASE_PLAN_FILE}" "${archive_dir}/phase-plan.md"
fi

if [[ -f "${SCOPE_LOCK_FILE}" ]]; then
  # Keep the active scope lock in place and archive a snapshot for traceability.
  cp "${SCOPE_LOCK_FILE}" "${archive_dir}/.scope-lock.md"
fi

for phase_file in "${phase_files[@]}"; do
  mv "${phase_file}" "${archive_dir}/$(basename "${phase_file}")"
done

{
  echo "# Stage 3 Archive Metadata"
  echo "- Task name: ${TASK_NAME}"
  echo "- Archive GUID: ${short_hash}"
  echo "- Archive directory: ${archive_dir}"
  echo "- Archived by: prepare-phased-impl-archive.sh"
} > "${archive_dir}/archive-metadata.md"

echo "Archived prior Stage 3 artifacts to ${archive_dir}"
