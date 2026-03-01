#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"

usage() {
  echo "Usage (canonical): ./.codex/scripts/task-scaffold.sh <task-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/task-scaffold.sh <task-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/task-scaffold.sh <task-name>"
  echo "Example: ./.codex/scripts/task-scaffold.sh add-performer-search"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

# Enforce kebab-case and prevent path traversal / weird names
if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using only lowercase letters, digits, and hyphens."
  echo "Example: add-performer-search"
  exit 2
fi

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TASKS_DIR="${ROOT_DIR}/tasks"
TASK_DIR="${TASKS_DIR}/${TASK_NAME}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

# Load persisted CODEX_ROOT/CODEX_SCRIPTS_DIR if available.
if [[ -f "${SCRIPT_DIR}/read-codex-paths.sh" ]]; then
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/read-codex-paths.sh" >/dev/null 2>&1 || true
fi

resolve_templates_dir() {
  local root
  root="$(resolve_codex_root \
    tasks/_templates/spec.template.md \
    tasks/_templates/phase.template.md \
    tasks/_templates/final-phase.template.md)" || return 1

  echo "${root}/tasks/_templates"
}

if ! TEMPLATES_DIR="$(resolve_templates_dir)"; then
  echo "Abort: unable to resolve codex templates directory."
  echo "Checked (in order):"
  [[ -n "${CODEX_ROOT:-}" ]] && echo "  ${CODEX_ROOT}/tasks/_templates"
  echo "  ${ROOT_DIR}/.codex/tasks/_templates"
  echo "  ${ROOT_DIR}/codex/tasks/_templates"
  echo "  ${HOME}/.codex/tasks/_templates"
  exit 1
fi

SPEC_TPL="${TEMPLATES_DIR}/spec.template.md"
PHASE_TPL="${TEMPLATES_DIR}/phase.template.md"
FINAL_TPL="${TEMPLATES_DIR}/final-phase.template.md"

mkdir -p "${TASK_DIR}"

if [[ ! -f "${SPEC_TPL}" || ! -f "${PHASE_TPL}" || ! -f "${FINAL_TPL}" ]]; then
  echo "Abort: missing required templates under ${TEMPLATES_DIR}"
  echo "Expected:"
  echo "  ${SPEC_TPL}"
  echo "  ${PHASE_TPL}"
  echo "  ${FINAL_TPL}"
  exit 1
fi

created_files=()

# spec.template.md -> spec.md
if [[ ! -f "${TASK_DIR}/spec.md" ]]; then
  cp "${SPEC_TPL}" "${TASK_DIR}/spec.md"
  created_files+=("${TASK_DIR}/spec.md")
fi

# phase.template.md -> phase-1..3.md (with {{PHASE_N}} substitution)
for n in 1 2 3; do
  if [[ ! -f "${TASK_DIR}/phase-${n}.md" ]]; then
    sed "s/{{PHASE_N}}/${n}/g" "${PHASE_TPL}" > "${TASK_DIR}/phase-${n}.md"
    created_files+=("${TASK_DIR}/phase-${n}.md")
  fi
done

# final-phase.template.md -> final-phase.md
if [[ ! -f "${TASK_DIR}/final-phase.md" ]]; then
  cp "${FINAL_TPL}" "${TASK_DIR}/final-phase.md"
  created_files+=("${TASK_DIR}/final-phase.md")
fi

# Materialize any additional *.template.md files (beyond known ones)
shopt -s nullglob
for tpl in "${TEMPLATES_DIR}"/*.template.md; do
  base="$(basename "${tpl}")"
  case "${base}" in
    "spec.template.md"|"phase.template.md"|"final-phase.template.md")
      continue
      ;;
  esac

  dest_base="${base/.template.md/.md}"
  dest_path="${TASK_DIR}/${dest_base}"

  [[ -f "${dest_path}" ]] && continue

  cp "${tpl}" "${dest_path}"
  created_files+=("${dest_path}")
done
shopt -u nullglob

required=(
  "${TASK_DIR}/spec.md"
  "${TASK_DIR}/phase-1.md"
  "${TASK_DIR}/phase-2.md"
  "${TASK_DIR}/phase-3.md"
  "${TASK_DIR}/final-phase.md"
)

missing=0
for f in "${required[@]}"; do
  if [[ ! -f "${f}" ]]; then
    echo "Missing: ${f}"
    missing=1
  fi
done

if [[ "${missing}" -ne 0 ]]; then
  echo "Abort: required task files missing."
  exit 1
fi

echo "Task scaffold ready: ${TASK_DIR}"
echo "Templates source: ${TEMPLATES_DIR}"

if [[ "${#created_files[@]}" -gt 0 ]]; then
  echo "Files created:"
  for f in "${created_files[@]}"; do
    echo "  - ${f}"
  done
else
  echo "No files created (everything already existed)."
fi

echo "Required files verified:"
for f in "${required[@]}"; do
  echo "  - ${f}"
done
