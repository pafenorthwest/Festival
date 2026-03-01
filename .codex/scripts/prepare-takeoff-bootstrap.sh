#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

BOOTSTRAP_START="# PREPARE-TAKEOFF BOOTSTRAP START"
BOOTSTRAP_END="# PREPARE-TAKEOFF BOOTSTRAP END"

default_config_template() {
  cat <<'EOF'
code_review:
  base_branch: main

notes:
  - "Update this manifest only when the repository's canonical commands change."
  - "Tasks must also copy the chosen commands into /tasks/<task-name>/spec.md under Verification Commands."
EOF
}

copy_config_if_missing() {
  local dest="$1"
  local source=""

  [[ -f "${dest}" ]] && return 0

  for source in \
    "${ROOT_DIR}/.codex/codex-config.yaml" \
    "${ROOT_DIR}/codex/codex-config.yaml" \
    "${HOME}/.codex/codex-config.yaml"; do
    if [[ -f "${source}" ]]; then
      cp "${source}" "${dest}"
      echo "Bootstrap: copied codex config from ${source}"
      return 0
    fi
  done

  default_config_template > "${dest}"
  echo "Bootstrap: created default codex config at ${dest}"
}

append_bootstrap_block() {
  local config_path="$1"
  local selected_root="$2"
  local selected_scripts="$3"

  cat >> "${config_path}" <<EOF

${BOOTSTRAP_START}
bootstrap:
  codex_root: "${selected_root}"
  codex_scripts_dir: "${selected_scripts}"
  canonical_scripts_path: "./.codex/scripts"
  repository_local_fallback_scripts_path: "./codex/scripts"
  home_fallback_scripts_path: "\$HOME/.codex/scripts"
${BOOTSTRAP_END}
EOF
}

replace_bootstrap_block() {
  local config_path="$1"
  local selected_root="$2"
  local selected_scripts="$3"
  local tmp_file=""

  tmp_file="$(mktemp)"
  awk -v start="${BOOTSTRAP_START}" -v end="${BOOTSTRAP_END}" '
    BEGIN {in_block=0}
    index($0, start) {in_block=1; next}
    index($0, end) {in_block=0; next}
    !in_block {print}
  ' "${config_path}" > "${tmp_file}"
  mv "${tmp_file}" "${config_path}"
  append_bootstrap_block "${config_path}" "${selected_root}" "${selected_scripts}"
}

if ! SELECTED_CODEX_ROOT="$(resolve_codex_root scripts/task-scaffold.sh scripts/prepare-takeoff-worktree.sh project-structure.md)"; then
  echo "BLOCKED: unable to resolve CODEX_ROOT with required files."
  echo "Checked: ${ROOT_DIR}/.codex, ${ROOT_DIR}/codex, ${HOME}/.codex"
  echo "Required: scripts/task-scaffold.sh, scripts/prepare-takeoff-worktree.sh (Stage 2 safety prep), project-structure.md"
  exit 1
fi

if [[ ! -f "${SELECTED_CODEX_ROOT}/project-structure.md" ]]; then
  echo "BLOCKED: missing required project structure file: ${SELECTED_CODEX_ROOT}/project-structure.md"
  exit 1
fi

DEST_CONFIG="${SELECTED_CODEX_ROOT}/codex-config.yaml"
copy_config_if_missing "${DEST_CONFIG}"

if grep -qF "${BOOTSTRAP_START}" "${DEST_CONFIG}"; then
  replace_bootstrap_block "${DEST_CONFIG}" "${SELECTED_CODEX_ROOT}" "${SELECTED_CODEX_ROOT}/scripts"
else
  append_bootstrap_block "${DEST_CONFIG}" "${SELECTED_CODEX_ROOT}" "${SELECTED_CODEX_ROOT}/scripts"
fi

echo "Selected CODEX_ROOT: ${SELECTED_CODEX_ROOT}"
echo "Selected CODEX_SCRIPTS_DIR: ${SELECTED_CODEX_ROOT}/scripts"
echo "Updated config: ${DEST_CONFIG}"
