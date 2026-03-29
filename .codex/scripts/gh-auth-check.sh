#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

resolve_config_path() {
  if [[ -f "${ROOT_DIR}/.codex/codex-config.yaml" ]]; then
    printf '%s\n' "${ROOT_DIR}/.codex/codex-config.yaml"
    return 0
  fi

  if [[ -f "${ROOT_DIR}/codex/codex-config.yaml" ]]; then
    printf '%s\n' "${ROOT_DIR}/codex/codex-config.yaml"
    return 0
  fi

  if [[ -f "${HOME}/.codex/codex-config.yaml" ]]; then
    printf '%s\n' "${HOME}/.codex/codex-config.yaml"
    return 0
  fi

  return 1
}

github_cli_block() {
  local config_path="$1"
  awk '
    /^github_cli:/ { in_block=1; next }
    in_block && /^[^[:space:]]/ { exit }
    in_block { print }
  ' "${config_path}"
}

configured_token_env_for_owner() {
  local owner_lc="$1"
  local config_path="$2"

  github_cli_block "${config_path}" | awk -v owner="${owner_lc}" '
    /^  owner_token_env:[[:space:]]*$/ { in_map=1; next }
    in_map && /^  [A-Za-z0-9_.-]+:[[:space:]]*/ { exit }
    in_map {
      line=$0
      if (line ~ /^    /) {
        key=line
        value=line
        sub(/^    /, "", key)
        sub(/:.*/, "", key)
        sub(/^    [^:]+:[[:space:]]*/, "", value)
        sub(/[[:space:]]+#.*$/, "", value)
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]*$/, "", value)
        if (value ~ /^".*"$/) {
          sub(/^"/, "", value)
          sub(/"$/, "", value)
        } else if (value ~ /^\047.*\047$/) {
          sub(/^\047/, "", value)
          sub(/\047$/, "", value)
        }
        if (tolower(key) == owner) {
          print value
          exit
        }
      }
    }
  '
}

repo_slug_from_args() {
  local -a args=("$@")
  local idx=0

  while (( idx < ${#args[@]} )); do
    case "${args[idx]}" in
      --repo|-R)
        if (( idx + 1 >= ${#args[@]} )); then
          echo "ERROR: ${args[idx]} requires an owner/repo argument" >&2
          return 2
        fi
        printf '%s\n' "${args[idx + 1]}"
        return 0
        ;;
      --repo=*|-R=*)
        printf '%s\n' "${args[idx]#*=}"
        return 0
        ;;
    esac
    idx=$((idx + 1))
  done

  return 1
}

repo_slug_from_origin() {
  local remote_url=""
  remote_url="$(git config --get remote.origin.url 2>/dev/null || true)"

  if [[ -z "${remote_url}" ]]; then
    echo "ERROR: unable to infer repository owner/repo from remote.origin.url; pass --repo owner/name" >&2
    return 2
  fi

  printf '%s\n' "${remote_url}" | sed -nE 's#^.*github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(\.git)?$#\1#p' | head -n 1
}

resolve_repo_slug() {
  local slug=""

  slug="$(repo_slug_from_args "$@" 2>/dev/null || true)"
  if [[ -n "${slug}" ]]; then
    printf '%s\n' "${slug}"
    return 0
  fi

  slug="$(repo_slug_from_origin)"
  if [[ -z "${slug}" ]]; then
    echo "ERROR: unable to resolve GitHub owner/repo" >&2
    return 2
  fi

  printf '%s\n' "${slug}"
}

prepare_github_cli_env() {
  local slug="$1"
  local owner="${slug%%/*}"
  local owner_lc="${owner,,}"
  local config_path=""
  local token_env=""

  config_path="$(resolve_config_path 2>/dev/null || true)"
  if [[ -n "${config_path}" ]]; then
    token_env="$(configured_token_env_for_owner "${owner_lc}" "${config_path}")"
  else
    token_env=""
  fi

  if [[ -z "${token_env}" ]]; then
    return 0
  fi

  if [[ -z "${!token_env:-}" ]]; then
    echo "AUTH BLOCKED: owner/org '${owner}' maps to env var '${token_env}', but that env var is unset." >&2
    echo "Update the environment or adjust github_cli.owner_token_env in codex-config.yaml." >&2
    return 4
  fi

  export GH_TOKEN="${!token_env}"
  return 0
}

usage() {
  cat <<'EOF'
Usage:
  ./codex/scripts/gh-auth-check.sh [--repo owner/name]

Exit codes:
  0  login and temporary issue create/delete succeeded
  3  gh auth status failed
  4  configured mapped env var is missing
  5  temporary issue create failed
  6  temporary issue delete failed
EOF
}

main() {
  local slug=""
  local title=""
  local body=""
  local create_output=""
  local delete_output=""
  local issue_number=""

  if (( $# > 0 )); then
    case "$1" in
      --help|-h)
        usage
        return 0
        ;;
    esac
  fi

  slug="$(resolve_repo_slug "$@")"
  prepare_github_cli_env "${slug}"

  if ! gh auth status >/dev/null 2>&1; then
    echo "AUTH CHECK FAILED: gh auth status did not succeed." >&2
    return 3
  fi

  title="GH auth check $(date -u +%Y%m%dT%H%M%SZ)"
  body="Temporary diagnostic issue created by gh-auth-check.sh and expected to be deleted immediately."

  if ! create_output="$("${SCRIPT_DIR}/gh-wrap.sh" issue create --repo "${slug}" --title "${title}" --body "${body}" 2>&1)"; then
    printf '%s\n' "${create_output}" >&2
    echo "AUTH CHECK FAILED: issue create did not succeed." >&2
    return 5
  fi

  issue_number="$(printf '%s\n' "${create_output}" | sed -nE 's#.*/issues/([0-9]+)$#\1#p' | tail -n 1)"
  if [[ -z "${issue_number}" ]]; then
    printf '%s\n' "${create_output}" >&2
    echo "AUTH CHECK FAILED: issue create succeeded but issue number could not be parsed for cleanup." >&2
    return 6
  fi

  if ! delete_output="$("${SCRIPT_DIR}/gh-wrap.sh" issue delete "${issue_number}" --repo "${slug}" --yes 2>&1)"; then
    printf '%s\n' "${delete_output}" >&2
    echo "AUTH CHECK FAILED: temporary diagnostic issue #${issue_number} could not be deleted." >&2
    return 6
  fi

  echo "AUTH CHECK PASSED: login, create, and delete all succeeded for ${slug}."
}

main "$@"
