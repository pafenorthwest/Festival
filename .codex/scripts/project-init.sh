#!/usr/bin/env bash
set -euo pipefail

SETUP_BRANCH="setup"
CODEX_HOME_DIR="${HOME}/.codex"
TARGET_CODEX_DIR=".codex"
TARGET_PROJECT_STRUCTURE="${TARGET_CODEX_DIR}/project-structure.md"
TARGET_CONFIG="${TARGET_CODEX_DIR}/codex-config.yaml"

usage() {
  cat <<'EOF'
Usage:
  ./.codex/scripts/project-init.sh [project-type]
  ./codex/scripts/project-init.sh [project-type]

Arguments:
  project-type    Optional file name (with or without .md) or numeric index from prompt list.

Environment:
  PROJECT_STRUCTURE_DIR  Optional override for the project structure markdown directory.
EOF
}

log() {
  printf '%s\n' "$*"
}

abort() {
  printf 'Abort: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  local cmd="$1"
  command -v "${cmd}" >/dev/null 2>&1 || abort "required command not found: ${cmd}"
}

ensure_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || abort "run this script from inside a git repository"
}

ensure_setup_branch() {
  if git show-ref --verify --quiet "refs/heads/${SETUP_BRANCH}"; then
    git checkout "${SETUP_BRANCH}"
    return
  fi

  if git ls-remote --exit-code --heads origin "${SETUP_BRANCH}" >/dev/null 2>&1; then
    git checkout -b "${SETUP_BRANCH}" --track "origin/${SETUP_BRANCH}"
    return
  fi

  git checkout -b "${SETUP_BRANCH}"
}

verify_codex_sources() {
  local required=(
    "scripts"
    "rules"
    "codex-config.yaml"
    "AGENTS.md"
    "tasks"
    "goals"
  )
  local rel=""

  [[ -d "${CODEX_HOME_DIR}" ]] || abort "missing ${CODEX_HOME_DIR}"

  for rel in "${required[@]}"; do
    [[ -e "${CODEX_HOME_DIR}/${rel}" ]] || abort "missing ${CODEX_HOME_DIR}/${rel}"
  done
}

copy_dir_contents() {
  local src="$1"
  local dest="$2"
  mkdir -p "${dest}"
  cp -R "${src}/." "${dest}/"
}

copy_codex_assets() {
  mkdir -p "${TARGET_CODEX_DIR}"
  copy_dir_contents "${CODEX_HOME_DIR}/scripts" "${TARGET_CODEX_DIR}/scripts"
  copy_dir_contents "${CODEX_HOME_DIR}/rules" "${TARGET_CODEX_DIR}/rules"
  copy_dir_contents "${CODEX_HOME_DIR}/tasks" "${TARGET_CODEX_DIR}/tasks"
  copy_dir_contents "${CODEX_HOME_DIR}/goals" "${TARGET_CODEX_DIR}/goals"
  cp "${CODEX_HOME_DIR}/codex-config.yaml" "${TARGET_CONFIG}"
  cp "${CODEX_HOME_DIR}/AGENTS.md" "${TARGET_CODEX_DIR}/AGENTS.md"
}

resolve_structure_dir() {
  local candidates=()
  local repo_root=""
  local candidate=""

  repo_root="$(git rev-parse --show-toplevel)"

  if [[ -n "${PROJECT_STRUCTURE_DIR:-}" ]]; then
    candidates+=("${PROJECT_STRUCTURE_DIR}")
  fi
  candidates+=(
    "${HOME}/eric/side-projects/project-structure"
    "${HOME}/side-projects/project-structure"
    "${HOME}/side-projects/prompts/project-structure"
    "${repo_root}/project-structure"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -d "${candidate}" ]] && compgen -G "${candidate}/*.md" >/dev/null; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done

  abort "unable to find project structure markdowns. Set PROJECT_STRUCTURE_DIR to a folder containing *.md files."
}

choose_structure_file() {
  local structure_dir="$1"
  local requested="${2:-}"
  local idx=0
  local choice=""

  mapfile -t STRUCTURE_FILES < <(find "${structure_dir}" -maxdepth 1 -type f -name '*.md' | sort)
  [[ "${#STRUCTURE_FILES[@]}" -gt 0 ]] || abort "no markdown files found in ${structure_dir}"

  if [[ -n "${requested}" ]]; then
    if [[ "${requested}" =~ ^[0-9]+$ ]]; then
      idx=$((requested - 1))
      if (( idx >= 0 && idx < ${#STRUCTURE_FILES[@]} )); then
        printf '%s\n' "${STRUCTURE_FILES[idx]}"
        return 0
      fi
      abort "project-type index out of range: ${requested}"
    fi

    for choice in "${STRUCTURE_FILES[@]}"; do
      local base
      base="$(basename "${choice}")"
      if [[ "${requested}" == "${base}" || "${requested}" == "${base%.md}" ]]; then
        printf '%s\n' "${choice}"
        return 0
      fi
    done

    abort "project-type not found: ${requested}"
  fi

  printf 'Select project type:\n' >&2
  for idx in "${!STRUCTURE_FILES[@]}"; do
    printf '  %s) %s\n' "$((idx + 1))" "$(basename "${STRUCTURE_FILES[idx]}" .md)" >&2
  done

  while true; do
    read -r -p "Enter selection [1-${#STRUCTURE_FILES[@]}]: " choice
    if [[ "${choice}" =~ ^[0-9]+$ ]]; then
      idx=$((choice - 1))
      if (( idx >= 0 && idx < ${#STRUCTURE_FILES[@]} )); then
        printf '%s\n' "${STRUCTURE_FILES[idx]}"
        return 0
      fi
    fi
    printf 'Invalid selection: %s\n' "${choice}" >&2
  done
}

update_codex_config_paths() {
  local tmp=""
  tmp="$(mktemp)"

  awk '
    BEGIN {root_seen=0; scripts_seen=0}
    {
      if ($0 ~ /^[[:space:]]*codex_root:[[:space:]]*/) {
        sub(/codex_root:.*/, "codex_root: \"./.codex\"")
        root_seen=1
      } else if ($0 ~ /^[[:space:]]*codex_scripts_dir:[[:space:]]*/) {
        sub(/codex_scripts_dir:.*/, "codex_scripts_dir: \"./.codex/scripts\"")
        scripts_seen=1
      }
      print
    }
    END {
      if (!root_seen || !scripts_seen) {
        print ""
        print "# PREPARE-TAKEOFF BOOTSTRAP START"
        print "bootstrap:"
        if (!root_seen) {
          print "  codex_root: \"./.codex\""
        }
        if (!scripts_seen) {
          print "  codex_scripts_dir: \"./.codex/scripts\""
        }
        print "  canonical_scripts_path: \"./.codex/scripts\""
        print "  repository_local_fallback_scripts_path: \"./codex/scripts\""
        print "  home_fallback_scripts_path: \"$HOME/.codex/scripts\""
        print "# PREPARE-TAKEOFF BOOTSTRAP END"
      }
    }
  ' "${TARGET_CONFIG}" > "${tmp}"

  mv "${tmp}" "${TARGET_CONFIG}"
}

extract_layout_directories() {
  local structure_file="$1"
  awk '
    BEGIN {in_code=0}
    /^```/ {
      in_code = !in_code
      next
    }
    !in_code {
      next
    }
    {
      line=$0
      if (line ~ /^[[:space:]]*\/[[:space:]]*$/) {
        next
      }
      if (match(line, /[├└]── /)) {
        prefix=substr(line, 1, RSTART - 1)
        depth=int(length(prefix) / 4)
        name=substr(line, RSTART + 4)
        sub(/[[:space:]]+$/, "", name)

        if (name ~ /\/$/) {
          name=substr(name, 1, length(name) - 1)
          if (name == "" || name == ".") {
            next
          }

          if (depth == 0) {
            path=name
          } else {
            path=stack[depth - 1] "/" name
          }
          stack[depth]=path
          for (i=depth + 1; i<64; i++) {
            delete stack[i]
          }
          if (!(path in seen)) {
            seen[path]=1
            print path
          }
        }
      }
    }
  ' "${structure_file}"
}

array_contains() {
  local needle="$1"
  shift
  local item=""
  for item in "$@"; do
    if [[ "${item}" == "${needle}" ]]; then
      return 0
    fi
  done
  return 1
}

create_key_directories() {
  local structure_file="$1"
  local all_dirs=()
  local key_dirs=()
  local dir=""

  mapfile -t all_dirs < <(extract_layout_directories "${structure_file}")

  if [[ "${#all_dirs[@]}" -eq 0 ]]; then
    key_dirs=("src" "tests" "docs")
  else
    for dir in "${all_dirs[@]}"; do
      if [[ "${dir}" != */* ]]; then
        key_dirs+=("${dir}")
      fi
    done

    if [[ "${#key_dirs[@]}" -gt 6 ]]; then
      key_dirs=("${key_dirs[@]:0:6}")
    fi

    if [[ "${#key_dirs[@]}" -lt 3 ]]; then
      for dir in "${all_dirs[@]}"; do
        if ! array_contains "${dir}" "${key_dirs[@]}"; then
          key_dirs+=("${dir}")
        fi
        [[ "${#key_dirs[@]}" -ge 5 ]] && break
      done
    fi
  fi

  if [[ "${#key_dirs[@]}" -eq 0 ]]; then
    abort "unable to derive key directories from ${structure_file}"
  fi

  log "Creating key directories:"
  for dir in "${key_dirs[@]}"; do
    mkdir -p "${dir}"
    log "  - ${dir}/"
  done
}

require_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    abort "working tree is not clean. Commit or stash changes before initialization."
  fi
}

create_commit_and_pr() {
  local pr_title="Initialize Codex setup scaffold"
  local pr_body=""

  git remote get-url origin >/dev/null 2>&1 || abort "missing git remote 'origin'"
  git add "${TARGET_CODEX_DIR}"

  if git diff --cached --quiet; then
    abort "no staged changes were produced"
  fi

  git commit -m "chore: initialize project setup scaffold"
  git push -u origin "${SETUP_BRANCH}"

  pr_body="$(cat <<'EOF'
This PR bootstraps repository setup for Codex:
- adds `.codex` scripts/rules/tasks/goals and AGENTS/config
- sets relative Codex bootstrap paths
- selects and copies a project structure template
EOF
)"

  log ""
  log "GitHub MCP handoff required: create or update the PR using GitHub MCP."
  log "Use the following values in your MCP prompt:"
  log "  - base: main"
  log "  - head: ${SETUP_BRANCH}"
  log "  - title: ${pr_title}"
  log "  - body:"
  printf '%s\n' "${pr_body}"
  log ""
  log "Instruction: if a PR for '${SETUP_BRANCH}' already exists, update it instead of creating a duplicate."
}

main() {
  local requested_project_type="${1:-}"
  local structure_dir=""
  local selected_file=""

  if [[ "${requested_project_type}" == "-h" || "${requested_project_type}" == "--help" ]]; then
    usage
    exit 0
  fi

  require_cmd git
  require_cmd awk
  require_cmd cp
  ensure_git_repo
  require_clean_worktree
  verify_codex_sources
  ensure_setup_branch
  copy_codex_assets

  structure_dir="$(resolve_structure_dir)"
  selected_file="$(choose_structure_file "${structure_dir}" "${requested_project_type}")"
  cp "${selected_file}" "${TARGET_PROJECT_STRUCTURE}"
  log "Selected structure: ${selected_file}"

  update_codex_config_paths
  create_key_directories "${TARGET_PROJECT_STRUCTURE}"
  create_commit_and_pr
}

main "$@"
