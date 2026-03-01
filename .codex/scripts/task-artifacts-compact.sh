#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
shift || true

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"

usage() {
  echo "Usage (canonical): ./.codex/scripts/task-artifacts-compact.sh <task-name> [--status complete|incomplete] [--progress <text>] [--blocker <text>] [--dry-run]"
  echo "Usage (repo-local fallback): ./codex/scripts/task-artifacts-compact.sh <task-name> [--status complete|incomplete] [--progress <text>] [--blocker <text>] [--dry-run]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/task-artifacts-compact.sh <task-name> [--status complete|incomplete] [--progress <text>] [--blocker <text>] [--dry-run]"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

if [[ -z "${ROOT_DIR}" ]]; then
  echo "Abort: not inside a git repository."
  exit 1
fi

STATUS="complete"
PROGRESS=""
BLOCKER=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --status)
      STATUS="${2:-}"
      shift 2
      ;;
    --progress)
      PROGRESS="${2:-}"
      shift 2
      ;;
    --blocker)
      BLOCKER="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    *)
      echo "Abort: unknown argument '$1'."
      usage
      exit 2
      ;;
  esac
done

if [[ "${STATUS}" != "complete" && "${STATUS}" != "incomplete" ]]; then
  echo "Abort: --status must be complete or incomplete."
  exit 2
fi

if [[ "${STATUS}" == "incomplete" ]]; then
  if [[ -z "${PROGRESS}" || -z "${BLOCKER}" ]]; then
    echo "Abort: incomplete status requires both --progress and --blocker."
    exit 2
  fi
fi

if [[ -z "${PROGRESS}" ]]; then
  if [[ "${STATUS}" == "complete" ]]; then
    PROGRESS="100% complete; full lifecycle run finished and land-stage compaction executed."
  else
    PROGRESS="unknown"
  fi
fi

if [[ -z "${BLOCKER}" ]]; then
  if [[ "${STATUS}" == "complete" ]]; then
    BLOCKER="none"
  else
    BLOCKER="unspecified"
  fi
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Abort: jq is required by task-artifacts-compact.sh"
  exit 1
fi

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

array_to_json() {
  local entries=()
  local value=""

  for value in "$@"; do
    [[ -z "${value}" ]] && continue
    entries+=("${value}")
  done

  if [[ "${#entries[@]}" -eq 0 ]]; then
    echo "[]"
    return 0
  fi

  printf '%s\n' "${entries[@]}" | jq -R . | jq -s .
}

latest_goal_file_in_dir() {
  local search_dir="$1"
  local latest=""

  if [[ ! -d "${search_dir}" ]]; then
    echo ""
    return 0
  fi

  latest="$(ls "${search_dir}"/goals.v*.md 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -z "${latest}" ]]; then
    latest="$(ls "${search_dir}"/goals.*.md 2>/dev/null | sort -V | tail -n 1 || true)"
  fi

  echo "${latest}"
}

GOALS_DIR="${ROOT_DIR}/goals/${TASK_NAME}"
TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
SPEC_FILE="${TASK_DIR}/spec.md"
AUDIT_LOG_FILE="${TASK_DIR}/audit-log.md"
GOAL_HISTORY_DIFF_FILE="${TASK_DIR}/goal-versions.diff"
RETENTION_FILE="${TASK_DIR}/retention.min.json"

mkdir -p "${GOALS_DIR}"

if [[ ! -d "${TASK_DIR}" ]]; then
  echo "Abort: missing task directory ${TASK_DIR}"
  exit 1
fi

if [[ ! -f "${SPEC_FILE}" ]]; then
  echo "Abort: missing required spec file ${SPEC_FILE}"
  exit 1
fi

GOAL_SOURCE_FILE="$(latest_goal_file_in_dir "${GOALS_DIR}")"
if [[ -z "${GOAL_SOURCE_FILE}" ]]; then
  GOAL_SOURCE_FILE="$(latest_goal_file_in_dir "${TASK_DIR}")"
fi

if [[ -z "${GOAL_SOURCE_FILE}" || ! -f "${GOAL_SOURCE_FILE}" ]]; then
  echo "Abort: unable to resolve retained goal file from ${GOALS_DIR} or ${TASK_DIR}."
  exit 1
fi

if ! grep -q '^- State: locked$' "${GOAL_SOURCE_FILE}"; then
  echo "Abort: retained goal file must be locked: ${GOAL_SOURCE_FILE}"
  exit 1
fi

GOAL_BASENAME="$(basename "${GOAL_SOURCE_FILE}")"
RETAINED_GOAL_FILE="${GOALS_DIR}/${GOAL_BASENAME}"
MOVE_GOAL_TO_GOALS=0
if [[ "${GOAL_SOURCE_FILE}" != "${RETAINED_GOAL_FILE}" ]]; then
  MOVE_GOAL_TO_GOALS=1
fi

GOAL_SHA_BEFORE="$(sha256_file "${GOAL_SOURCE_FILE}")"
SPEC_SHA="$(sha256_file "${SPEC_FILE}")"

VERSIONS_TMP="$(mktemp)"
VERSIONS_DEDUP_TMP="$(mktemp)"
DIFF_TMP="$(mktemp)"
cleanup() {
  rm -f "${VERSIONS_TMP}" "${VERSIONS_DEDUP_TMP}" "${DIFF_TMP}"
}
trap cleanup EXIT

collect_goal_versions() {
  local search_dir="$1"
  local path=""
  local base_name=""
  local version_num=""

  if [[ ! -d "${search_dir}" ]]; then
    return 0
  fi

  for path in "${search_dir}"/goals.v*.md; do
    [[ -f "${path}" ]] || continue
    base_name="$(basename "${path}")"
    if [[ "${base_name}" =~ ^goals\.v([0-9]+)\.md$ ]]; then
      version_num="${BASH_REMATCH[1]}"
      printf '%s\t%s\n' "${version_num}" "${path}" >> "${VERSIONS_TMP}"
    fi
  done
}

collect_goal_versions "${GOALS_DIR}"
collect_goal_versions "${TASK_DIR}"

if [[ -s "${VERSIONS_TMP}" ]]; then
  sort -n -k1,1 "${VERSIONS_TMP}" | awk -F'\t' '!seen[$1]++ {print $1 "\t" $2}' > "${VERSIONS_DEDUP_TMP}"
fi

GOAL_VERSION_NUMBERS=()
GOAL_VERSION_FILES=()
while IFS=$'\t' read -r version path; do
  [[ -z "${version}" || -z "${path}" ]] && continue
  GOAL_VERSION_NUMBERS+=("${version}")
  GOAL_VERSION_FILES+=("${path}")
done < "${VERSIONS_DEDUP_TMP}"

GOAL_VERSION_COUNT="${#GOAL_VERSION_FILES[@]}"
GENERATE_GOAL_HISTORY_DIFF=0
if (( GOAL_VERSION_COUNT > 1 )); then
  GENERATE_GOAL_HISTORY_DIFF=1
fi

generate_goal_history_diff() {
  local i=0
  local prev_file=""
  local curr_file=""
  local prev_num=""
  local curr_num=""
  local diff_status=0

  : > "${DIFF_TMP}"

  for (( i=1; i<GOAL_VERSION_COUNT; i++ )); do
    prev_file="${GOAL_VERSION_FILES[$((i-1))]}"
    curr_file="${GOAL_VERSION_FILES[$i]}"
    prev_num="${GOAL_VERSION_NUMBERS[$((i-1))]}"
    curr_num="${GOAL_VERSION_NUMBERS[$i]}"

    {
      echo "# goals.v${prev_num}.md -> goals.v${curr_num}.md"
    } >> "${DIFF_TMP}"

    set +e
    diff -u "${prev_file}" "${curr_file}" >> "${DIFF_TMP}"
    diff_status=$?
    set -e

    if [[ "${diff_status}" -gt 1 ]]; then
      echo "Abort: failed to generate goal-version diff between ${prev_file} and ${curr_file}."
      exit 1
    fi

    echo >> "${DIFF_TMP}"
  done

  mv "${DIFF_TMP}" "${GOAL_HISTORY_DIFF_FILE}"
}

if [[ "${DRY_RUN}" -eq 0 ]]; then
  if (( GENERATE_GOAL_HISTORY_DIFF == 1 )); then
    generate_goal_history_diff
  else
    rm -f "${GOAL_HISTORY_DIFF_FILE}"
  fi
fi

GOAL_HISTORY_DIFF_REL=""
GOAL_HISTORY_DIFF_SHA=""
if (( GENERATE_GOAL_HISTORY_DIFF == 1 )); then
  GOAL_HISTORY_DIFF_REL="${GOAL_HISTORY_DIFF_FILE#${ROOT_DIR}/}"
  if [[ "${DRY_RUN}" -eq 0 && -f "${GOAL_HISTORY_DIFF_FILE}" ]]; then
    GOAL_HISTORY_DIFF_SHA="$(sha256_file "${GOAL_HISTORY_DIFF_FILE}")"
  fi
fi

goal_remove_paths=()
if [[ -d "${GOALS_DIR}" ]]; then
  while IFS= read -r path; do
    [[ -z "${path}" ]] && continue
    if [[ "${path}" != "${GOAL_SOURCE_FILE}" ]]; then
      goal_remove_paths+=("${path}")
    fi
  done < <(find "${GOALS_DIR}" -mindepth 1 -maxdepth 1)
fi

task_keep_names=(
  "spec.md"
  "audit-log.md"
  "retention.min.json"
)
if (( GENERATE_GOAL_HISTORY_DIFF == 1 )); then
  task_keep_names+=("goal-versions.diff")
fi

task_remove_paths=()
while IFS= read -r path; do
  [[ -z "${path}" ]] && continue
  base_name="$(basename "${path}")"
  keep=0
  for keep_name in "${task_keep_names[@]}"; do
    if [[ "${base_name}" == "${keep_name}" ]]; then
      keep=1
      break
    fi
  done
  # Preserve risk acceptance evidence files used for landing waivers.
  if [[ "${keep}" -eq 0 && "${base_name}" == risk-acceptance*.md ]]; then
    keep=1
  fi
  if [[ "${keep}" -eq 0 ]]; then
    task_remove_paths+=("${path}")
  fi
done < <(find "${TASK_DIR}" -mindepth 1 -maxdepth 1)

goal_remove_count=0
for _ in "${goal_remove_paths[@]-}"; do
  [[ -z "${_}" ]] && continue
  goal_remove_count=$((goal_remove_count + 1))
done

task_remove_count=0
for _ in "${task_remove_paths[@]-}"; do
  [[ -z "${_}" ]] && continue
  task_remove_count=$((task_remove_count + 1))
done

if [[ "${DRY_RUN}" -eq 1 ]]; then
  echo "DRY RUN: task artifact compaction plan for ${TASK_NAME}"
  echo "Retain goal file: ${RETAINED_GOAL_FILE}"
  if [[ "${MOVE_GOAL_TO_GOALS}" -eq 1 ]]; then
    echo "Goal file move: ${GOAL_SOURCE_FILE} -> ${RETAINED_GOAL_FILE}"
  fi
  echo "Retain spec file: ${SPEC_FILE}"
  if (( GENERATE_GOAL_HISTORY_DIFF == 1 )); then
    echo "Goal versions diff: ${GOAL_HISTORY_DIFF_FILE} (sequential v0..vN)"
  else
    echo "Goal versions diff: none (single goal version)"
  fi
  echo "Will generate: ${AUDIT_LOG_FILE}, ${RETENTION_FILE}"
  echo "Goal files to remove: ${goal_remove_count}"
  for p in "${goal_remove_paths[@]-}"; do
    [[ -z "${p}" ]] && continue
    echo "  - ${p}"
  done
  echo "Task entries to remove: ${task_remove_count}"
  for p in "${task_remove_paths[@]-}"; do
    [[ -z "${p}" ]] && continue
    echo "  - ${p}"
  done
  exit 0
fi

if [[ "${MOVE_GOAL_TO_GOALS}" -eq 1 ]]; then
  if [[ -f "${RETAINED_GOAL_FILE}" ]]; then
    DEST_GOAL_SHA="$(sha256_file "${RETAINED_GOAL_FILE}")"
    if [[ "${DEST_GOAL_SHA}" != "${GOAL_SHA_BEFORE}" ]]; then
      echo "Abort: existing retained goal file differs from source: ${RETAINED_GOAL_FILE}"
      exit 1
    fi
    rm -f "${GOAL_SOURCE_FILE}"
  else
    mv "${GOAL_SOURCE_FILE}" "${RETAINED_GOAL_FILE}"
  fi
fi

if (( GENERATE_GOAL_HISTORY_DIFF == 1 )) && [[ -f "${GOAL_HISTORY_DIFF_FILE}" ]]; then
  GOAL_HISTORY_DIFF_SHA="$(sha256_file "${GOAL_HISTORY_DIFF_FILE}")"
fi

goal_state="$(sed -nE 's/^- State:[[:space:]]*(.+)$/\1/p' "${RETAINED_GOAL_FILE}" | head -n 1)"
phase_plan_verdict="$(sed -nE 's/^- Verdict:[[:space:]]*(.+)$/\1/p' "${TASK_DIR}/phase-plan.md" 2>/dev/null | head -n 1 || true)"
stage3_runs="$(sed -nE 's/^- Stage 3 runs:[[:space:]]*([0-9]+)[[:space:]]*$/\1/p' "${TASK_DIR}/lifecycle-state.md" 2>/dev/null | head -n 1 || true)"
phase_plan_verdict="${phase_plan_verdict:-unknown}"
stage3_runs="${stage3_runs:-unknown}"

if [[ ! -f "${AUDIT_LOG_FILE}" ]]; then
  cat > "${AUDIT_LOG_FILE}" <<EOF_AUDIT
# Task Audit Log
- Task name: ${TASK_NAME}
- Purpose: Preserve compact but complete evidence of lifecycle execution after land-stage compaction.

EOF_AUDIT
fi

{
  echo "## Run $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "- Status: ${STATUS}"
  echo "- Progress: ${PROGRESS}"
  echo "- Blocker: ${BLOCKER}"
  echo "- Lifecycle evidence snapshot:"
  echo "  - Goal file retained: \`${RETAINED_GOAL_FILE#${ROOT_DIR}/}\`"
  echo "  - Goal state: ${goal_state:-unknown}"
  echo "  - Spec file retained: \`${SPEC_FILE#${ROOT_DIR}/}\`"
  if (( GENERATE_GOAL_HISTORY_DIFF == 1 )); then
    echo "  - Goal versions diff: \`${GOAL_HISTORY_DIFF_REL}\`"
  else
    echo "  - Goal versions diff: none (single goal version)"
  fi
  echo "  - Phase plan verdict snapshot: ${phase_plan_verdict}"
  echo "  - Stage 3 runs snapshot: ${stage3_runs}"
  echo "- Outcome:"
  if [[ "${STATUS}" == "complete" ]]; then
    echo "  - Complete lifecycle run confirmed; compaction applied after land-stage readiness gates."
  else
    echo "  - Incomplete lifecycle run recorded; compaction preserved partial evidence and blocker context."
  fi
  echo
} >> "${AUDIT_LOG_FILE}"

goals_removed_json="$(array_to_json "${goal_remove_paths[@]-}")"
tasks_removed_json="$(array_to_json "${task_remove_paths[@]-}")"

audit_sha="$(sha256_file "${AUDIT_LOG_FILE}")"

jq -cn \
  --arg task "${TASK_NAME}" \
  --arg generated_at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg status "${STATUS}" \
  --arg progress "${PROGRESS}" \
  --arg blocker "${BLOCKER}" \
  --arg retained_goal "${RETAINED_GOAL_FILE#${ROOT_DIR}/}" \
  --arg retained_spec "${SPEC_FILE#${ROOT_DIR}/}" \
  --arg audit_log "${AUDIT_LOG_FILE#${ROOT_DIR}/}" \
  --arg goal_versions_diff "${GOAL_HISTORY_DIFF_REL}" \
  --arg goal_sha256 "${GOAL_SHA_BEFORE}" \
  --arg spec_sha256 "${SPEC_SHA}" \
  --arg audit_sha256 "${audit_sha}" \
  --arg goal_versions_diff_sha256 "${GOAL_HISTORY_DIFF_SHA}" \
  --argjson goals_removed "${goals_removed_json}" \
  --argjson tasks_removed "${tasks_removed_json}" \
  '{
    task: $task,
    generated_at: $generated_at,
    status: $status,
    progress: $progress,
    blocker: $blocker,
    retained: {
      goal_file: $retained_goal,
      spec_file: $retained_spec,
      audit_log: $audit_log,
      goal_versions_diff: (if ($goal_versions_diff | length) > 0 then $goal_versions_diff else null end)
    },
    checksums: {
      goal_sha256: $goal_sha256,
      spec_sha256: $spec_sha256,
      audit_sha256: $audit_sha256,
      goal_versions_diff_sha256: (if ($goal_versions_diff_sha256 | length) > 0 then $goal_versions_diff_sha256 else null end)
    },
    removed: {
      goals: $goals_removed,
      tasks: $tasks_removed
    }
  }' > "${RETENTION_FILE}"

safe_remove_path() {
  local path="$1"

  if [[ "${path}" != "${GOALS_DIR}"/* && "${path}" != "${TASK_DIR}"/* ]]; then
    echo "Abort: refusing to remove path outside task/goals surfaces: ${path}"
    exit 1
  fi

  rm -rf "${path}"
}

for path in "${goal_remove_paths[@]-}"; do
  [[ -z "${path}" ]] && continue
  safe_remove_path "${path}"
done

for path in "${task_remove_paths[@]-}"; do
  [[ -z "${path}" ]] && continue
  safe_remove_path "${path}"
done

if [[ ! -f "${RETAINED_GOAL_FILE}" ]]; then
  echo "Abort: retained goal file missing after compaction: ${RETAINED_GOAL_FILE}"
  exit 1
fi

if [[ ! -f "${SPEC_FILE}" ]]; then
  echo "Abort: retained spec file missing after compaction: ${SPEC_FILE}"
  exit 1
fi

GOAL_SHA_AFTER="$(sha256_file "${RETAINED_GOAL_FILE}")"
if [[ "${GOAL_SHA_BEFORE}" != "${GOAL_SHA_AFTER}" ]]; then
  echo "Abort: retained goal file was modified during compaction: ${RETAINED_GOAL_FILE}"
  exit 1
fi

echo "Compacted task artifacts for '${TASK_NAME}'."
echo "Retained goal file: ${RETAINED_GOAL_FILE}"
echo "Retained spec file: ${SPEC_FILE}"
if (( GENERATE_GOAL_HISTORY_DIFF == 1 )); then
  echo "Goal versions diff: ${GOAL_HISTORY_DIFF_FILE}"
else
  echo "Goal versions diff: none (single goal version)"
fi
echo "Audit log: ${AUDIT_LOG_FILE}"
echo "Retention metadata: ${RETENTION_FILE}"
echo "Removed goals entries: ${goal_remove_count}"
echo "Removed task entries: ${task_remove_count}"
