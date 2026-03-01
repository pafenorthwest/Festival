#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
GOALS_DIR="${ROOT_DIR}/goals/${TASK_NAME}"
SPEC_FILE="${TASK_DIR}/spec.md"
PHASE_PLAN_FILE="${TASK_DIR}/phase-plan.md"
LOCK_FILE="${TASK_DIR}/.scope-lock.md"
FINAL_PHASE_FILE="${TASK_DIR}/final-phase.md"
LIFECYCLE_STATE_FILE="${TASK_DIR}/lifecycle-state.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPLEXITY_SIGNALS_FILE="${TASK_DIR}/complexity-signals.json"
COMPLEXITY_LOCK_FILE="${TASK_DIR}/.complexity-lock.json"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

usage() {
  echo "Usage (canonical): ./.codex/scripts/prepare-phased-impl-validate.sh <task-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/prepare-phased-impl-validate.sh <task-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/prepare-phased-impl-validate.sh <task-name>"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

issues=()

extract_section_from_file() {
  local file="$1"
  local heading_regex="$2"
  awk -v heading_regex="${heading_regex}" '
    $0 ~ heading_regex {in_section=1; next}
    /^## / && in_section {exit}
    in_section {print}
  ' "${file}" | sed 's/[[:space:]]\+$//'
}

latest_goals_file() {
  local latest=""

  if [[ -d "${GOALS_DIR}" ]]; then
    latest="$(ls "${GOALS_DIR}"/goals.v*.md 2>/dev/null | sort -V | tail -n 1 || true)"
  fi

  if [[ -z "${latest}" && -d "${GOALS_DIR}" ]]; then
    latest="$(ls "${GOALS_DIR}"/goals.*.md 2>/dev/null | sort -V | tail -n 1 || true)"
  fi

  echo "${latest}"
}

sha256_file() {
  local file_path="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${file_path}" | awk '{print $1}'
    return 0
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${file_path}" | awk '{print $1}'
    return 0
  fi
  return 1
}

signals_path_from_phase_plan() {
  if [[ ! -f "${PHASE_PLAN_FILE}" ]]; then
    return 0
  fi
  sed -nE 's/^- .*signals=([^;[:space:]]+).*$/\1/p' "${PHASE_PLAN_FILE}" | head -n 1
}

set_verdict() {
  local verdict="$1"
  local tmp_file

  if [[ ! -f "${PHASE_PLAN_FILE}" ]]; then
    return
  fi

  tmp_file="$(mktemp)"
  awk -v verdict="${verdict}" '
    BEGIN {updated=0}
    /^- Verdict:/ {print "- Verdict: " verdict; updated=1; next}
    {print}
    END {
      if (updated == 0) {
        print "- Verdict: " verdict
      }
    }
  ' "${PHASE_PLAN_FILE}" > "${tmp_file}"
  mv "${tmp_file}" "${PHASE_PLAN_FILE}"
}

update_lifecycle_stage3_runs() {
  local stage3_runs="0"
  local current_cycle="0"
  local last_validated_cycle="0"

  if [[ -f "${LIFECYCLE_STATE_FILE}" ]]; then
    stage3_runs="$(sed -nE 's/^- Stage 3 runs:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "${LIFECYCLE_STATE_FILE}" | head -n 1)"
    current_cycle="$(sed -nE 's/^- Stage 3 current cycle:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "${LIFECYCLE_STATE_FILE}" | head -n 1)"
    last_validated_cycle="$(sed -nE 's/^- Stage 3 last validated cycle:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "${LIFECYCLE_STATE_FILE}" | head -n 1)"
  fi

  [[ "${stage3_runs}" =~ ^[0-9]+$ ]] || stage3_runs="0"
  [[ "${current_cycle}" =~ ^[0-9]+$ ]] || current_cycle="0"
  [[ "${last_validated_cycle}" =~ ^[0-9]+$ ]] || last_validated_cycle="0"

  if [[ "${current_cycle}" -eq 0 ]]; then
    current_cycle=1
  fi

  if [[ "${last_validated_cycle}" -lt "${current_cycle}" ]]; then
    stage3_runs=$((stage3_runs + 1))
    last_validated_cycle="${current_cycle}"
  fi

  cat > "${LIFECYCLE_STATE_FILE}" <<EOF
# Lifecycle State
- Stage 3 runs: ${stage3_runs}
- Stage 3 current cycle: ${current_cycle}
- Stage 3 last validated cycle: ${last_validated_cycle}
EOF
}

if [[ ! -f "${SPEC_FILE}" ]]; then
  issues+=("Missing required file: ${SPEC_FILE}")
fi

if [[ ! -f "${PHASE_PLAN_FILE}" ]]; then
  issues+=("Missing required file: ${PHASE_PLAN_FILE}")
fi

if [[ ! -f "${LOCK_FILE}" ]]; then
  issues+=("Missing required scope lock file: ${LOCK_FILE}")
fi

if [[ ! -f "${FINAL_PHASE_FILE}" ]]; then
  issues+=("Missing required file: ${FINAL_PHASE_FILE}")
fi

if [[ -f "${SPEC_FILE}" ]]; then
  if ! grep -q 'READY FOR PLANNING' "${SPEC_FILE}"; then
    issues+=("Hard precondition failed: ${SPEC_FILE} does not contain READY FOR PLANNING")
  fi

  if [[ -n "$(extract_section_from_file "${SPEC_FILE}" '^##[[:space:]]+IN SCOPE$')" && \
        -n "$(extract_section_from_file "${SPEC_FILE}" '^##[[:space:]]+OUT OF SCOPE$')" ]]; then
    :
  else
    issues+=("Missing or empty scope sections in ${SPEC_FILE}: require ## IN SCOPE and ## OUT OF SCOPE")
  fi
fi

goals_file="$(latest_goals_file)"
goal_count=""
if [[ -z "${goals_file}" ]]; then
  issues+=("Missing goals artifact under ${GOALS_DIR} (expected goals.vN.md)")
elif [[ ! -f "${goals_file}" ]]; then
  issues+=("Goals artifact not found: ${goals_file}")
else
  goals_state="$(sed -n 's/^- State: //p; s/^State: //p' "${goals_file}" | head -n 1)"
  if [[ "${goals_state}" != "locked" ]]; then
    issues+=("Goals artifact must be locked before Stage 3 validation: ${goals_file}")
  fi

  goal_count="$(sed -n '/^## Goals/,/^## /p' "${goals_file}" | awk '/^[0-9]+\./ {count++} END {print count+0}')"
  if [[ ! "${goal_count}" =~ ^[0-9]+$ ]]; then
    issues+=("Unable to parse goal count from ${goals_file}")
  elif (( 10#${goal_count} < 1 || 10#${goal_count} > 20 )); then
    issues+=("Invalid goal count '${goal_count}' in ${goals_file}; expected 1-20")
  fi
fi

complexity_signals_file=""
complexity_ranges_ready="false"
complexity_goals_min=""
complexity_goals_max=""
complexity_phases_min=""
complexity_phases_max=""
selected_signals_file=""
lock_signals_path=""
lock_signals_sha256=""
lock_metadata_complete="true"
if [[ -f "${COMPLEXITY_LOCK_FILE}" ]]; then
  lock_signals_path="$(jq -r '.selected_signals_path // empty' "${COMPLEXITY_LOCK_FILE}" 2>/dev/null || true)"
  lock_signals_sha256="$(jq -r '.selected_signals_sha256 // empty' "${COMPLEXITY_LOCK_FILE}" 2>/dev/null || true)"

  if [[ -z "${lock_signals_path}" ]]; then
    issues+=("Complexity lock metadata incomplete: missing 'selected_signals_path' in ${COMPLEXITY_LOCK_FILE}. Remediation: rerun prepare-phased-impl-scaffold.sh, then rerun Stage 3 validation.")
    lock_metadata_complete="false"
  fi

  if [[ -z "${lock_signals_sha256}" ]]; then
    issues+=("Complexity lock metadata incomplete: missing 'selected_signals_sha256' in ${COMPLEXITY_LOCK_FILE}. Remediation: rerun prepare-phased-impl-scaffold.sh, then rerun Stage 3 validation.")
    lock_metadata_complete="false"
  fi

  if [[ "${lock_metadata_complete}" == "true" ]]; then
    selected_signals_file="${lock_signals_path}"
  fi
else
  selected_signals_file="${COMPLEXITY_SIGNALS_FILE}"
fi

if [[ ! -f "${COMPLEXITY_SIGNALS_FILE}" ]]; then
  issues+=("Missing required complexity signals file: ${COMPLEXITY_SIGNALS_FILE}. Remediation: create it, rerun prepare-phased-impl-scaffold.sh, then rerun Stage 3 validation.")
fi

if [[ ! -f "${COMPLEXITY_LOCK_FILE}" ]]; then
  issues+=("Missing required complexity lock file: ${COMPLEXITY_LOCK_FILE}. Remediation: rerun prepare-phased-impl-scaffold.sh for this task, then rerun Stage 3 validation.")
fi

if [[ -f "${COMPLEXITY_LOCK_FILE}" && -f "${PHASE_PLAN_FILE}" ]]; then
  phase_plan_signals_path="$(signals_path_from_phase_plan)"
  if [[ -n "${phase_plan_signals_path}" ]]; then
    if [[ -n "${lock_signals_path}" && "${phase_plan_signals_path}" != "${lock_signals_path}" ]]; then
      issues+=("Complexity drift detected: phase-plan signals path '${phase_plan_signals_path}' differs from locked path '${lock_signals_path}'. BLOCKED; resolve drift before continuing.")
    fi
  fi
fi

complexity_signals_file="${selected_signals_file}"
score_script="${SCRIPT_DIR}/complexity-score.sh"
if [[ ! -x "${score_script}" ]]; then
  issues+=("Missing executable complexity scorer: ${score_script}")
elif [[ -z "${complexity_signals_file}" ]]; then
  issues+=("Complexity lock metadata incomplete: selected signals path could not be resolved from ${COMPLEXITY_LOCK_FILE}. BLOCKED; resolve lock metadata before continuing.")
elif [[ ! -f "${complexity_signals_file}" ]]; then
  issues+=("Selected complexity signals file not found: ${complexity_signals_file}. BLOCKED; restore the selected signals file before continuing.")
else
  if score_json="$("${score_script}" "${complexity_signals_file}" --format json 2>&1)"; then
    complexity_goals_min="$(printf '%s' "${score_json}" | jq -r '.ranges.goals.min // empty' 2>/dev/null || true)"
    complexity_goals_max="$(printf '%s' "${score_json}" | jq -r '.ranges.goals.max // empty' 2>/dev/null || true)"
    complexity_phases_min="$(printf '%s' "${score_json}" | jq -r '.ranges.phases.min // empty' 2>/dev/null || true)"
    complexity_phases_max="$(printf '%s' "${score_json}" | jq -r '.ranges.phases.max // empty' 2>/dev/null || true)"

    if [[ "${complexity_goals_min}" =~ ^[0-9]+$ && \
          "${complexity_goals_max}" =~ ^[0-9]+$ && \
          "${complexity_phases_min}" =~ ^[0-9]+$ && \
          "${complexity_phases_max}" =~ ^[0-9]+$ ]]; then
      complexity_ranges_ready="true"
    else
      issues+=("Unable to parse complexity ranges from scorer output using ${complexity_signals_file}")
    fi
  else
    issues+=("Complexity scoring failed for ${complexity_signals_file}: ${score_json}")
  fi
fi

if [[ -f "${COMPLEXITY_LOCK_FILE}" && "${complexity_ranges_ready}" == "true" ]]; then
  lock_goals_min="$(jq -r '.ranges.goals.min // empty' "${COMPLEXITY_LOCK_FILE}" 2>/dev/null || true)"
  lock_goals_max="$(jq -r '.ranges.goals.max // empty' "${COMPLEXITY_LOCK_FILE}" 2>/dev/null || true)"
  lock_phases_min="$(jq -r '.ranges.phases.min // empty' "${COMPLEXITY_LOCK_FILE}" 2>/dev/null || true)"
  lock_phases_max="$(jq -r '.ranges.phases.max // empty' "${COMPLEXITY_LOCK_FILE}" 2>/dev/null || true)"

  if [[ -n "${lock_signals_path}" && "${complexity_signals_file}" != "${lock_signals_path}" ]]; then
    issues+=("Complexity drift detected: selected signals path changed from '${lock_signals_path}' to '${complexity_signals_file}'. BLOCKED; resolve drift before continuing.")
  fi

  if [[ -n "${lock_signals_sha256}" ]]; then
    if current_signals_sha256="$(sha256_file "${complexity_signals_file}")"; then
      if [[ "${current_signals_sha256}" != "${lock_signals_sha256}" ]]; then
        issues+=("Complexity drift detected: selected signals content changed since Stage 3 lock. BLOCKED; resolve drift before continuing.")
      fi
    else
      issues+=("Unable to compute SHA-256 for ${complexity_signals_file} to enforce complexity drift policy.")
    fi
  fi

  if [[ "${lock_goals_min}" =~ ^[0-9]+$ && "${lock_goals_max}" =~ ^[0-9]+$ && \
        "${lock_phases_min}" =~ ^[0-9]+$ && "${lock_phases_max}" =~ ^[0-9]+$ ]]; then
    if [[ "${lock_goals_min}" != "${complexity_goals_min}" || \
          "${lock_goals_max}" != "${complexity_goals_max}" || \
          "${lock_phases_min}" != "${complexity_phases_min}" || \
          "${lock_phases_max}" != "${complexity_phases_max}" ]]; then
      issues+=("Complexity drift detected: scorer-derived ranges changed since Stage 3 lock (${lock_goals_min}-${lock_goals_max}/${lock_phases_min}-${lock_phases_max} -> ${complexity_goals_min}-${complexity_goals_max}/${complexity_phases_min}-${complexity_phases_max}). BLOCKED; resolve drift before continuing.")
    fi
  else
    issues+=("Complexity lock file has invalid range metadata: ${COMPLEXITY_LOCK_FILE}")
  fi
fi

phase_count=""
if [[ -f "${PHASE_PLAN_FILE}" ]]; then
  phase_count="$(sed -nE 's/^- Phase count:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "${PHASE_PLAN_FILE}" | head -n 1)"
  if [[ -z "${phase_count}" ]]; then
    issues+=("Unable to parse '- Phase count: <1-12>' from ${PHASE_PLAN_FILE}")
  elif (( 10#${phase_count} < 1 || 10#${phase_count} > 12 )); then
    issues+=("Invalid phase count '${phase_count}' in ${PHASE_PLAN_FILE}; expected 1-12")
  fi
fi

if [[ "${complexity_ranges_ready}" == "true" ]]; then
  if [[ "${phase_count}" =~ ^[0-9]+$ ]]; then
    if (( 10#${phase_count} < 10#${complexity_phases_min} )); then
      issues+=("Phase count ${phase_count} below complexity minimum ${complexity_phases_min} (signals: ${complexity_signals_file})")
    fi
  fi
fi

if [[ -n "${phase_count}" ]]; then
  for n in $(seq 1 "${phase_count}"); do
    phase_file="${TASK_DIR}/phase-${n}.md"
    if [[ ! -f "${phase_file}" ]]; then
      issues+=("Missing active phase file: ${phase_file}")
      continue
    fi

    if ! grep -q '^## Objective$' "${phase_file}"; then
      issues+=("Missing '## Objective' in ${phase_file}")
    fi
    if ! grep -q '^## Work items$' "${phase_file}"; then
      issues+=("Missing '## Work items' in ${phase_file}")
    fi
    if ! grep -q '^## Gate (must pass before proceeding)$' "${phase_file}"; then
      issues+=("Missing gate section in ${phase_file}")
    fi
    if ! grep -q '^## Verification steps$' "${phase_file}"; then
      issues+=("Missing verification steps section in ${phase_file}")
    fi
  done
fi

if [[ -f "${LOCK_FILE}" && -f "${SPEC_FILE}" ]]; then
  locked_in="$(extract_section_from_file "${LOCK_FILE}" '^##[[:space:]]+IN SCOPE$')"
  locked_out="$(extract_section_from_file "${LOCK_FILE}" '^##[[:space:]]+OUT OF SCOPE$')"
  current_in="$(extract_section_from_file "${SPEC_FILE}" '^##[[:space:]]+IN SCOPE$')"
  current_out="$(extract_section_from_file "${SPEC_FILE}" '^##[[:space:]]+OUT OF SCOPE$')"

  if [[ "${locked_in}" != "${current_in}" || "${locked_out}" != "${current_out}" ]]; then
    issues+=("No-new-scope hard stop: scope sections changed since lock snapshot (${LOCK_FILE})")
  fi
fi

if [[ "${#issues[@]}" -eq 0 ]]; then
  update_lifecycle_stage3_runs
  set_verdict "READY FOR IMPLEMENTATION"
  echo "READY FOR IMPLEMENTATION"
  exit 0
fi

set_verdict "BLOCKED"
echo "BLOCKED"
for issue in "${issues[@]}"; do
  echo "- ${issue}"
done
exit 1
