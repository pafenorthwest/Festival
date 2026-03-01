#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_START="# PREPARE-TAKEOFF BOOTSTRAP START"
BOOTSTRAP_END="# PREPARE-TAKEOFF BOOTSTRAP END"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

extract_bootstrap_value() {
  local key="$1"
  local block="$2"
  printf '%s\n' "${block}" | sed -nE "s/^[[:space:]]+${key}:[[:space:]]*\"?([^\"]+)\"?[[:space:]]*$/\\1/p" | head -n 1
}

read_codex_paths() {
  local block=""
  local config_path=""
  local parsed_root=""
  local parsed_scripts=""
  local parsed_root_abs=""
  local parsed_scripts_abs=""
  local fallback_root=""
  local expected_root=""
  local expected_scripts=""
  local env_root=""
  local env_scripts=""

  if ! fallback_root="$(resolve_codex_root scripts codex-config.yaml project-structure.md)"; then
    echo "Abort: unable to resolve codex root from config. Ensure codex-config.yaml and project-structure.md exist."
    return 1
  fi

  config_path="${fallback_root}/codex-config.yaml"
  if [[ ! -f "${config_path}" ]]; then
    echo "Abort: missing codex config: ${config_path}"
    return 1
  fi

  if [[ ! -f "${fallback_root}/project-structure.md" ]]; then
    echo "BLOCKED: missing required project structure file: ${fallback_root}/project-structure.md"
    return 1
  fi

  if [[ -f "${config_path}" ]]; then
    block="$(awk -v s="${BOOTSTRAP_START}" -v e="${BOOTSTRAP_END}" '
      index($0, s) {in_block=1; next}
      index($0, e) {in_block=0}
      in_block {print}
    ' "${config_path}")"

    parsed_root="$(extract_bootstrap_value "codex_root" "${block}")"
    parsed_scripts="$(extract_bootstrap_value "codex_scripts_dir" "${block}")"
  fi

  expected_root="${fallback_root}"
  expected_scripts="${fallback_root}/scripts"
  if [[ -n "${parsed_root}" && -n "${parsed_scripts}" && -d "${parsed_root}" && -d "${parsed_scripts}" ]]; then
    parsed_root_abs="$(cd "${parsed_root}" && pwd)"
    parsed_scripts_abs="$(cd "${parsed_scripts}" && pwd)"
    if [[ -f "${parsed_root_abs}/project-structure.md" ]]; then
      expected_root="${parsed_root_abs}"
      expected_scripts="${parsed_scripts_abs}"
    fi
  fi

  # Fast path: environment values are reusable only when they match the
  # expected root/scripts resolved for the current repository/bootstrap context.
  if [[ -n "${CODEX_ROOT:-}" && -n "${CODEX_SCRIPTS_DIR:-}" && -d "${CODEX_ROOT}" && -d "${CODEX_SCRIPTS_DIR}" ]]; then
    env_root="$(cd "${CODEX_ROOT}" && pwd)"
    env_scripts="$(cd "${CODEX_SCRIPTS_DIR}" && pwd)"
    if [[ "${env_root}" == "${expected_root}" && "${env_scripts}" == "${expected_scripts}" && -f "${env_scripts}/resolve-codex-root.sh" ]]; then
      export CODEX_ROOT="${env_root}"
      export CODEX_SCRIPTS_DIR="${env_scripts}"
      return 0
    fi
  fi

  export CODEX_ROOT="${expected_root}"
  export CODEX_SCRIPTS_DIR="${expected_scripts}"
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if read_codex_paths; then
    echo "Resolved CODEX_ROOT: ${CODEX_ROOT}"
    echo "Resolved CODEX_SCRIPTS_DIR: ${CODEX_SCRIPTS_DIR}"
    exit 0
  fi
  exit 1
fi

if ! read_codex_paths; then
  return 1 2>/dev/null || exit 1
fi
