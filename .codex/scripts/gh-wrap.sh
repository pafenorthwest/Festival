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
        gsub(/"/, "", value)
        sub(/[[:space:]]*$/, "", value)
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

  GH_WRAP_REPO_SLUG="${slug}"
  GH_WRAP_OWNER="${owner}"
  GH_WRAP_SELECTED_TOKEN_ENV=""

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
  GH_WRAP_SELECTED_TOKEN_ENV="${token_env}"
  return 0
}

print_gh_wrap_debug() {
  local -a args=("$@")
  local token_label="GH_TOKEN (ambient)"

  if [[ -n "${GH_WRAP_SELECTED_TOKEN_ENV:-}" ]]; then
    token_label="${GH_WRAP_SELECTED_TOKEN_ENV}"
  fi

  echo "GH_WRAP_DEBUG"
  echo "repo=${GH_WRAP_REPO_SLUG}"
  echo "owner=${GH_WRAP_OWNER}"
  echo "token_env=${token_label}"
  printf 'command='
  printf '%q ' gh "${args[@]}"
  printf '\n'
}

usage() {
  cat <<'EOF'
Usage:
  ./codex/scripts/gh-wrap.sh pr <create|view|edit|list|comment|status|close|reopen> [gh args...]
  ./codex/scripts/gh-wrap.sh issue <create|delete|edit|list|close|reopen> [gh args...]
  ./codex/scripts/gh-wrap.sh label create [gh args...]
  ./codex/scripts/gh-wrap.sh edit [gh args...]   # alias for "pr edit"
EOF
}

normalize_command() {
  local -a args=("$@")
  if (( ${#args[@]} == 0 )); then
    usage >&2
    return 2
  fi

  case "${args[0]}" in
    pr)
      if (( ${#args[@]} < 2 )); then
        echo "ERROR: missing pr subcommand" >&2
        return 2
      fi
      case "${args[1]}" in
        create|view|edit|list|comment|status|close|reopen)
          printf '%s\0' "${args[@]}"
          return 0
          ;;
      esac
      ;;
    issue)
      if (( ${#args[@]} < 2 )); then
        echo "ERROR: missing issue subcommand" >&2
        return 2
      fi
      case "${args[1]}" in
        create|delete|edit|list|close|reopen)
          printf '%s\0' "${args[@]}"
          return 0
          ;;
      esac
      ;;
    label)
      if (( ${#args[@]} >= 2 )) && [[ "${args[1]}" == "create" ]]; then
        printf '%s\0' "${args[@]}"
        return 0
      fi
      ;;
    edit)
      printf '%s\0' pr edit "${args[@]:1}"
      return 0
      ;;
  esac

  echo "ERROR: unsupported gh-wrap command shape" >&2
  usage >&2
  return 2
}

main() {
  local -a original_args=("$@")
  local -a normalized_args=()
  local slug=""

  if (( ${#original_args[@]} > 0 )); then
    case "${original_args[0]}" in
      --help|-h)
        usage
        return 0
        ;;
    esac
  fi

  while IFS= read -r -d '' item; do
    normalized_args+=("${item}")
  done < <(normalize_command "${original_args[@]}")

  slug="$(resolve_repo_slug "${normalized_args[@]}")"
  prepare_github_cli_env "${slug}"

  if [[ "${GH_WRAP_DEBUG:-0}" == "1" ]]; then
    print_gh_wrap_debug "${normalized_args[@]}"
    return 0
  fi

  exec gh "${normalized_args[@]}"
}

main "$@"
