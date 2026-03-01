#!/usr/bin/env bash
set -euo pipefail

# Resolve CODEX_ROOT with stable precedence:
# 1) explicit CODEX_ROOT (if valid)
# 2) repo-local ./.codex
# 3) repo-local ./codex
# 4) user-level $HOME/.codex
#
# Optional positional args are required relative paths that must exist under
# the selected root, for example:
#   resolve_codex_root scripts/task-scaffold.sh codex-config.yaml project-structure.md

resolve_codex_root() {
  local candidate
  local candidate_abs
  local allowed_candidate
  local is_allowed_explicit
  local rel
  local ok
  local repo_root
  local required_paths=("$@")
  local candidates=()

  repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

  # Fast path: if CODEX_ROOT is already exported and satisfies all required paths,
  # return immediately without invoking git/path discovery again.
  if [[ -n "${CODEX_ROOT:-}" && -d "${CODEX_ROOT}" ]]; then
    candidate_abs="$(cd "${CODEX_ROOT}" && pwd)"

    # Explicit CODEX_ROOT is accepted only when it matches one of the
    # supported roots for the current repository context.
    is_allowed_explicit=0
    for allowed_candidate in "${repo_root}/.codex" "${repo_root}/codex" "${HOME}/.codex"; do
      [[ -d "${allowed_candidate}" ]] || continue
      if [[ "${candidate_abs}" == "$(cd "${allowed_candidate}" && pwd)" ]]; then
        is_allowed_explicit=1
        break
      fi
    done

    if [[ "${is_allowed_explicit}" -eq 1 ]]; then
      ok=1
      for rel in "${required_paths[@]}"; do
        if [[ ! -e "${candidate_abs}/${rel}" ]]; then
          ok=0
          break
        fi
      done
      if [[ "${ok}" -eq 1 ]]; then
        printf '%s\n' "${candidate_abs}"
        return 0
      fi
    fi
  fi

  candidates+=("${repo_root}/.codex" "${repo_root}/codex" "${HOME}/.codex")

  for candidate in "${candidates[@]}"; do
    [[ -d "${candidate}" ]] || continue
    candidate_abs="$(cd "${candidate}" && pwd)"

    ok=1
    for rel in "${required_paths[@]}"; do
      if [[ ! -e "${candidate_abs}/${rel}" ]]; then
        ok=0
        break
      fi
    done

    if [[ "${ok}" -eq 1 ]]; then
      printf '%s\n' "${candidate_abs}"
      return 0
    fi
  done

  return 1
}

resolve_codex_scripts_dir() {
  local root
  root="$(resolve_codex_root scripts)"
  printf '%s/scripts\n' "${root}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  if resolve_codex_root "$@"; then
    exit 0
  fi
  exit 1
fi
