#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
COMPLEXITY_INPUT="${2:-medium}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

# shellcheck source=/dev/null
if [[ -f "${SCRIPT_DIR}/read-codex-paths.sh" ]]; then
  source "${SCRIPT_DIR}/read-codex-paths.sh" >/dev/null 2>&1 || true
fi

usage() {
  echo "Usage (canonical): ./.codex/scripts/prepare-phased-impl-scaffold.sh <task-name> [simple|medium|complex|very-complex|surgical|focused|multi-surface|cross-system|program|1..12|@/path/to/complexity-signals.json]"
  echo "Usage (repo-local fallback): ./codex/scripts/prepare-phased-impl-scaffold.sh <task-name> [simple|medium|complex|very-complex|surgical|focused|multi-surface|cross-system|program|1..12|@/path/to/complexity-signals.json]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/prepare-phased-impl-scaffold.sh <task-name> [simple|medium|complex|very-complex|surgical|focused|multi-surface|cross-system|program|1..12|@/path/to/complexity-signals.json]"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

phase_count_from_complexity() {
  local input="$1"
  case "${input}" in
    simple|surgical) echo "1" ;;
    focused) echo "3" ;;
    medium) echo "4" ;;
    multi-surface) echo "5" ;;
    complex) echo "7" ;;
    cross-system) echo "8" ;;
    very-complex|program) echo "10" ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1 && 10#$1 <= 12 )); then
        echo "$1"
      else
        echo "Abort: complexity must be a supported label or a phase count in [1..12]."
        exit 2
      fi
      ;;
  esac
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
  echo "Abort: no sha256 tool available (requires shasum or sha256sum)."
  exit 1
}

TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
SPEC_FILE="${TASK_DIR}/spec.md"
FINAL_PHASE_FILE="${TASK_DIR}/final-phase.md"
PHASE_PLAN_FILE="${TASK_DIR}/phase-plan.md"
LIFECYCLE_STATE_FILE="${TASK_DIR}/lifecycle-state.md"
COMPLEXITY_SIGNALS_FILE="${TASK_DIR}/complexity-signals.json"
COMPLEXITY_LOCK_FILE="${TASK_DIR}/.complexity-lock.json"
SCORE_SCRIPT="${SCRIPT_DIR}/complexity-score.sh"

COMPLEXITY_DESCRIPTOR="${COMPLEXITY_INPUT}"
SCORING_DETAILS=""
PHASE_COUNT=""
SELECTED_SIGNALS_FILE=""
SCORE_JSON=""
SCORE_TOTAL=""
SCORE_LEVEL=""
SCORE_LEVEL_NAME=""
SCORE_FORCE_L1=""
SCORE_RECOMMENDED_GOALS=""
SCORE_RECOMMENDED_PHASES=""
SCORE_GOALS_MIN=""
SCORE_GOALS_MAX=""
SCORE_PHASES_MIN=""
SCORE_PHASES_MAX=""

if [[ ! -d "${TASK_DIR}" ]]; then
  echo "Abort: missing task directory ${TASK_DIR}"
  exit 1
fi

if [[ ! -f "${SPEC_FILE}" ]]; then
  echo "Abort: missing ${SPEC_FILE}"
  exit 1
fi

if ! grep -q 'READY FOR PLANNING' "${SPEC_FILE}"; then
  echo "Abort: hard precondition failed; ${SPEC_FILE} must contain READY FOR PLANNING."
  exit 1
fi

if [[ ! -f "${FINAL_PHASE_FILE}" ]]; then
  echo "Abort: missing ${FINAL_PHASE_FILE}"
  exit 1
fi

if [[ ! -x "${SCORE_SCRIPT}" ]]; then
  echo "Abort: missing executable complexity scorer: ${SCORE_SCRIPT}"
  exit 1
fi

if [[ "${COMPLEXITY_INPUT}" == @* ]]; then
  scores_file="${COMPLEXITY_INPUT#@}"
  if [[ -z "${scores_file}" ]]; then
    echo "Abort: complexity signals file path must be provided after '@'."
    exit 2
  fi

  if [[ "${scores_file}" == /* ]]; then
    SELECTED_SIGNALS_FILE="${scores_file}"
  else
    SELECTED_SIGNALS_FILE="${ROOT_DIR}/${scores_file}"
  fi
else
  SELECTED_SIGNALS_FILE="${COMPLEXITY_SIGNALS_FILE}"
fi

if [[ ! -f "${COMPLEXITY_SIGNALS_FILE}" ]]; then
  echo "Abort: missing task complexity signals file ${COMPLEXITY_SIGNALS_FILE}."
  echo "Remediation: create ${COMPLEXITY_SIGNALS_FILE} and re-run prepare-phased-impl-scaffold.sh."
  exit 1
fi

if [[ ! -f "${SELECTED_SIGNALS_FILE}" ]]; then
  echo "Abort: complexity signals file not found: ${SELECTED_SIGNALS_FILE}"
  exit 1
fi

SCORE_JSON="$("${SCORE_SCRIPT}" "${SELECTED_SIGNALS_FILE}" --format json)"
SCORE_RECOMMENDED_PHASES="$(echo "${SCORE_JSON}" | jq -r '.recommended.phases')"
SCORE_RECOMMENDED_GOALS="$(echo "${SCORE_JSON}" | jq -r '.recommended.goals')"
SCORE_LEVEL="$(echo "${SCORE_JSON}" | jq -r '.level')"
SCORE_LEVEL_NAME="$(echo "${SCORE_JSON}" | jq -r '.level_name')"
SCORE_TOTAL="$(echo "${SCORE_JSON}" | jq -r '.total_score')"
SCORE_FORCE_L1="$(echo "${SCORE_JSON}" | jq -r '.force_l1')"
SCORE_GOALS_MIN="$(echo "${SCORE_JSON}" | jq -r '.ranges.goals.min')"
SCORE_GOALS_MAX="$(echo "${SCORE_JSON}" | jq -r '.ranges.goals.max')"
SCORE_PHASES_MIN="$(echo "${SCORE_JSON}" | jq -r '.ranges.phases.min')"
SCORE_PHASES_MAX="$(echo "${SCORE_JSON}" | jq -r '.ranges.phases.max')"

if [[ ! "${SCORE_RECOMMENDED_PHASES}" =~ ^[0-9]+$ ]] || (( 10#${SCORE_RECOMMENDED_PHASES} < 1 || 10#${SCORE_RECOMMENDED_PHASES} > 12 )); then
  echo "Abort: invalid recommended phase count from complexity scorer."
  exit 1
fi

if [[ "${COMPLEXITY_INPUT}" == @* ]]; then
  PHASE_COUNT="${SCORE_RECOMMENDED_PHASES}"
  COMPLEXITY_DESCRIPTOR="scored:${SCORE_LEVEL} (${SCORE_LEVEL_NAME})"
else
  PHASE_COUNT="$(phase_count_from_complexity "${COMPLEXITY_INPUT}")"
fi

SCORING_DETAILS="score=${SCORE_TOTAL}; recommended-goals=${SCORE_RECOMMENDED_GOALS}; guardrails-all-true=${SCORE_FORCE_L1}; signals=${SELECTED_SIGNALS_FILE}"

ensure_lifecycle_state_file() {
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

  current_cycle=$((current_cycle + 1))

  cat > "${LIFECYCLE_STATE_FILE}" <<EOF
# Lifecycle State
- Stage 3 runs: ${stage3_runs}
- Stage 3 current cycle: ${current_cycle}
- Stage 3 last validated cycle: ${last_validated_cycle}
EOF
}

ensure_lifecycle_state_file

# Enforce Stage 3 archival on restart/rerun when prior Stage 3 records exist.
archived_prior_stage3=0
shopt -s nullglob
existing_phase_files=( "${TASK_DIR}"/phase-[0-9]*.md )
shopt -u nullglob

# A standalone scope lock can exist on first run (Step 2 before scaffold) and
# must not trigger archival. Archive only when actual prior Stage 3 planning
# artifacts exist.
if [[ -f "${PHASE_PLAN_FILE}" || "${#existing_phase_files[@]}" -gt 0 ]]; then
  "${SCRIPT_DIR}/prepare-phased-impl-archive.sh" "${TASK_NAME}"
  archived_prior_stage3=1
fi

# Regenerate active scope lock after archival so validate never observes a moved lock.
if [[ "${archived_prior_stage3}" -eq 1 ]]; then
  "${SCRIPT_DIR}/prepare-phased-impl-scope-lock.sh" "${TASK_NAME}" >/dev/null
fi

if ! CODEX_ROOT_RESOLVED="$(resolve_codex_root tasks/_templates/phase.template.md)"; then
  echo "Abort: unable to resolve codex root for phase template."
  exit 1
fi

PHASE_TEMPLATE="${CODEX_ROOT_RESOLVED}/tasks/_templates/phase.template.md"
if [[ ! -f "${PHASE_TEMPLATE}" ]]; then
  echo "Abort: missing template ${PHASE_TEMPLATE}"
  exit 1
fi

created_files=()
for n in $(seq 1 "${PHASE_COUNT}"); do
  phase_file="${TASK_DIR}/phase-${n}.md"
  if [[ ! -f "${phase_file}" ]]; then
    sed "s/{{PHASE_N}}/${n}/g" "${PHASE_TEMPLATE}" > "${phase_file}"
    created_files+=("${phase_file}")
  fi
done

if ! grep -q '^## Implementation phase strategy$' "${SPEC_FILE}"; then
  {
    echo
    echo "## Implementation phase strategy"
    echo "- Complexity: ${COMPLEXITY_DESCRIPTOR}"
    if [[ -n "${SCORING_DETAILS}" ]]; then
      echo "- Complexity scoring details: ${SCORING_DETAILS}"
    fi
    echo "- Active phases: 1..${PHASE_COUNT}"
    echo "- No new scope introduced: required"
  } >> "${SPEC_FILE}"
fi

cat > "${PHASE_PLAN_FILE}" <<EOF
# Phase Plan
- Task name: ${TASK_NAME}
- Complexity: ${COMPLEXITY_DESCRIPTOR}
- Phase count: ${PHASE_COUNT}
- Active phases: 1..${PHASE_COUNT}
- Verdict: PENDING

## Constraints
- no code/config changes are allowed except phase-plan document updates under ./tasks/*
- no new scope is allowed; scope drift is BLOCKED
EOF

if [[ -n "${SCORING_DETAILS}" ]]; then
  {
    echo
    echo "## Complexity scoring details"
    echo "- ${SCORING_DETAILS}"
    echo "- Ranges: goals=${SCORE_GOALS_MIN}-${SCORE_GOALS_MAX}; phases=${SCORE_PHASES_MIN}-${SCORE_PHASES_MAX}"
  } >> "${PHASE_PLAN_FILE}"
fi

signals_sha256="$(sha256_file "${SELECTED_SIGNALS_FILE}")"
score_script_sha256="$(sha256_file "${SCORE_SCRIPT}")"
jq -n \
  --arg selected_signals_path "${SELECTED_SIGNALS_FILE}" \
  --arg selected_signals_sha256 "${signals_sha256}" \
  --arg score_script_path "${SCORE_SCRIPT}" \
  --arg score_script_sha256 "${score_script_sha256}" \
  --argjson goals_min "${SCORE_GOALS_MIN}" \
  --argjson goals_max "${SCORE_GOALS_MAX}" \
  --argjson phases_min "${SCORE_PHASES_MIN}" \
  --argjson phases_max "${SCORE_PHASES_MAX}" \
  --argjson recommended_goals "${SCORE_RECOMMENDED_GOALS}" \
  --argjson recommended_phases "${SCORE_RECOMMENDED_PHASES}" \
  --arg complexity_input "${COMPLEXITY_INPUT}" \
  --arg complexity_descriptor "${COMPLEXITY_DESCRIPTOR}" \
  --arg captured_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{
    selected_signals_path: $selected_signals_path,
    selected_signals_sha256: $selected_signals_sha256,
    score_script_path: $score_script_path,
    score_script_sha256: $score_script_sha256,
    ranges: {
      goals: { min: $goals_min, max: $goals_max },
      phases: { min: $phases_min, max: $phases_max }
    },
    recommended: {
      goals: $recommended_goals,
      phases: $recommended_phases
    },
    complexity_input: $complexity_input,
    complexity_descriptor: $complexity_descriptor,
    captured_at: $captured_at
  }' > "${COMPLEXITY_LOCK_FILE}"

echo "Prepared phased implementation plan scaffold for ${TASK_NAME}"
echo "Phase count: ${PHASE_COUNT}"
echo "Phase plan: ${PHASE_PLAN_FILE}"
echo "Complexity lock: ${COMPLEXITY_LOCK_FILE}"
echo "Lifecycle state: ${LIFECYCLE_STATE_FILE}"
if [[ "${#created_files[@]}" -gt 0 ]]; then
  echo "Created phase files:"
  for f in "${created_files[@]}"; do
    echo "  - ${f}"
  done
else
  echo "No new phase files created (required files already existed)."
fi
