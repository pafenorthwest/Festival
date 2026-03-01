#!/usr/bin/env bash
set -euo pipefail

BOOTSTRAP_START="# PREPARE-TAKEOFF BOOTSTRAP START"
BOOTSTRAP_END="# PREPARE-TAKEOFF BOOTSTRAP END"
MODE="apply"
DRY_RUN=0

usage() {
  echo "Usage (canonical): ./.codex/scripts/codex-config-bootstrap-sync.sh [apply|revert] [--dry-run]"
  echo "Usage (repo-local fallback): ./codex/scripts/codex-config-bootstrap-sync.sh [apply|revert] [--dry-run]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/codex-config-bootstrap-sync.sh [apply|revert] [--dry-run]"
}

for arg in "$@"; do
  case "${arg}" in
    apply|revert)
      MODE="${arg}"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Abort: unknown argument '${arg}'."
      usage
      exit 2
      ;;
  esac
done

resolve_codex_root_from_cwd() {
  local candidate
  for candidate in "${PWD}/.codex" "${PWD}/codex" "${HOME}/.codex"; do
    if [[ -d "${candidate}" && -f "${candidate}/codex-config.yaml" ]]; then
      (cd "${candidate}" && pwd)
      return 0
    fi
  done

  echo "Abort: unable to resolve codex root from CWD (${PWD}). Checked: ./.codex, ./codex, \$HOME/.codex"
  return 1
}

extract_bootstrap_block() {
  local config_path="$1"
  awk -v s="${BOOTSTRAP_START}" -v e="${BOOTSTRAP_END}" '
    index($0, s) {in_block=1; next}
    index($0, e) {in_block=0}
    in_block {print}
  ' "${config_path}"
}

extract_bootstrap_value() {
  local key="$1"
  local block="$2"
  printf '%s\n' "${block}" | sed -nE "s/^[[:space:]]+${key}:[[:space:]]*\"?([^\"]+)\"?[[:space:]]*$/\\1/p" | head -n 1
}

write_bootstrap_block() {
  local config_path="$1"
  local codex_root="$2"
  local scripts_dir="$3"
  local canonical_path="$4"
  local repo_fallback_path="$5"
  local home_fallback_path="$6"
  local include_override="$7"
  local original_root="$8"
  local original_scripts="$9"
  local tmp_file

  tmp_file="$(mktemp)"
  awk -v s="${BOOTSTRAP_START}" -v e="${BOOTSTRAP_END}" '
    BEGIN {in_block=0}
    index($0, s) {in_block=1; next}
    index($0, e) {in_block=0; next}
    !in_block {print}
  ' "${config_path}" > "${tmp_file}"

  {
    cat "${tmp_file}"
    echo "${BOOTSTRAP_START}"
    echo "bootstrap:"
    echo "  codex_root: \"${codex_root}\""
    echo "  codex_scripts_dir: \"${scripts_dir}\""
    echo "  canonical_scripts_path: \"${canonical_path}\""
    echo "  repository_local_fallback_scripts_path: \"${repo_fallback_path}\""
    echo "  home_fallback_scripts_path: \"${home_fallback_path}\""
    if [[ "${include_override}" == "true" ]]; then
      echo "  worktree_override_active: true"
      echo "  original_codex_root: \"${original_root}\""
      echo "  original_codex_scripts_dir: \"${original_scripts}\""
    fi
    echo "${BOOTSTRAP_END}"
  } > "${config_path}"

  rm -f "${tmp_file}"
}

is_detached_head() {
  local branch
  branch="$(git branch --show-current 2>/dev/null || true)"
  [[ -z "${branch}" ]]
}

main() {
  local selected_root
  local selected_scripts
  local config_path
  local block
  local current_root=""
  local current_scripts=""
  local canonical_path=""
  local repo_fallback_path=""
  local home_fallback_path=""
  local override_active=""
  local original_root=""
  local original_scripts=""
  local preserve_root=""
  local preserve_scripts=""

  selected_root="$(resolve_codex_root_from_cwd)"
  selected_scripts="${selected_root}/scripts"
  config_path="${selected_root}/codex-config.yaml"

  if [[ ! -f "${config_path}" ]]; then
    echo "Abort: missing codex config at ${config_path}"
    exit 1
  fi

  block="$(extract_bootstrap_block "${config_path}")"
  current_root="$(extract_bootstrap_value "codex_root" "${block}")"
  current_scripts="$(extract_bootstrap_value "codex_scripts_dir" "${block}")"
  canonical_path="$(extract_bootstrap_value "canonical_scripts_path" "${block}")"
  repo_fallback_path="$(extract_bootstrap_value "repository_local_fallback_scripts_path" "${block}")"
  home_fallback_path="$(extract_bootstrap_value "home_fallback_scripts_path" "${block}")"
  override_active="$(extract_bootstrap_value "worktree_override_active" "${block}")"
  original_root="$(extract_bootstrap_value "original_codex_root" "${block}")"
  original_scripts="$(extract_bootstrap_value "original_codex_scripts_dir" "${block}")"

  [[ -n "${canonical_path}" ]] || canonical_path="./.codex/scripts"
  [[ -n "${repo_fallback_path}" ]] || repo_fallback_path="./codex/scripts"
  [[ -n "${home_fallback_path}" ]] || home_fallback_path="\$HOME/.codex/scripts"

  case "${MODE}" in
    apply)
      if ! is_detached_head; then
        echo "No-op: HEAD is attached; bootstrap sync runs only in detached HEAD mode."
        exit 0
      fi

      if [[ "${override_active}" == "true" && -n "${original_root}" && -n "${original_scripts}" ]]; then
        preserve_root="${original_root}"
        preserve_scripts="${original_scripts}"
      else
        preserve_root="${current_root}"
        preserve_scripts="${current_scripts}"
      fi

      [[ -n "${preserve_root}" ]] || preserve_root="${selected_root}"
      [[ -n "${preserve_scripts}" ]] || preserve_scripts="${preserve_root}/scripts"

      if [[ "${current_root}" == "${selected_root}" && "${current_scripts}" == "${selected_scripts}" && "${override_active}" == "true" ]]; then
        echo "No-op: worktree bootstrap override is already active for ${selected_root}."
        exit 0
      fi

      if [[ "${DRY_RUN}" -eq 1 ]]; then
        echo "Dry run: would set bootstrap codex_root to ${selected_root}"
        echo "Dry run: would preserve original codex_root as ${preserve_root}"
        exit 0
      fi

      write_bootstrap_block "${config_path}" "${selected_root}" "${selected_scripts}" "${canonical_path}" "${repo_fallback_path}" "${home_fallback_path}" "true" "${preserve_root}" "${preserve_scripts}"
      echo "Applied worktree bootstrap override in ${config_path}"
      ;;

    revert)
      if [[ "${override_active}" != "true" ]]; then
        echo "No-op: no active worktree bootstrap override to revert."
        exit 0
      fi

      if [[ -z "${original_root}" || -z "${original_scripts}" ]]; then
        echo "Abort: override is active but original bootstrap values are missing in ${config_path}"
        exit 1
      fi

      if [[ "${DRY_RUN}" -eq 1 ]]; then
        echo "Dry run: would restore bootstrap codex_root to ${original_root}"
        exit 0
      fi

      write_bootstrap_block "${config_path}" "${original_root}" "${original_scripts}" "${canonical_path}" "${repo_fallback_path}" "${home_fallback_path}" "false" "" ""
      echo "Reverted worktree bootstrap override in ${config_path}"
      ;;
  esac
}

main
