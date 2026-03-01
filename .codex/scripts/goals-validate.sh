#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
ITERATION="${2:-}"
SIGNALS_FILE_ARG="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "$TASK_NAME" || -z "$ITERATION" ]]; then
  echo "ERROR: TASK_NAME_IN_KEBAB_CASE and iteration (vN) are required"
  exit 1
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "ERROR: TASK_NAME_IN_KEBAB_CASE must use lowercase letters, digits, and hyphens only"
  echo "Example: add-performer-search"
  exit 1
fi

GOALS_FILE="./goals/${TASK_NAME}/goals.${ITERATION}.md"

if [[ ! -f "$GOALS_FILE" ]]; then
  echo "ERROR: Missing $GOALS_FILE"
  exit 1
fi

STATE=$(sed -n 's/^- State: //p; s/^State: //p' "$GOALS_FILE" | head -n 1)

GOAL_COUNT=$(sed -n '/^## Goals/,/^## /p' "$GOALS_FILE" | awk '/^[0-9]+\./ {count++} END {print count+0}')
SUCCESS_COUNT=$(sed -n '/^## Success criteria/,/^## /p' "$GOALS_FILE" | awk '/^-/ {count++} END {print count+0}')

if [[ "$GOAL_COUNT" -gt 20 ]]; then
  echo "ERROR: Too many goals (${GOAL_COUNT}); max is 20"
  exit 1
fi

if [[ "$GOAL_COUNT" -lt 1 ]]; then
  if [[ "$STATE" == "blocked" ]]; then
    echo "BLOCKED"
    exit 0
  fi
  echo "ERROR: At least one goal is required unless State=blocked"
  exit 1
fi

if [[ -n "${SIGNALS_FILE_ARG}" ]]; then
  score_script="${SCRIPT_DIR}/complexity-score.sh"
  if [[ ! -x "${score_script}" ]]; then
    echo "ERROR: Missing executable complexity scorer: ${score_script}"
    exit 1
  fi

  signals_file="${SIGNALS_FILE_ARG}"
  if [[ "${signals_file}" != /* ]]; then
    signals_file="./${signals_file}"
  fi

  if [[ ! -f "${signals_file}" ]]; then
    echo "ERROR: Missing complexity signals file: ${signals_file}"
    exit 1
  fi

  if ! "${score_script}" "${signals_file}" --format json >/dev/null; then
    echo "ERROR: Complexity scoring failed for: ${signals_file}"
    exit 1
  fi
fi

if [[ "$GOAL_COUNT" -gt 0 && "$SUCCESS_COUNT" -eq 0 ]]; then
  if [[ "$STATE" == "locked" ]]; then
    echo "ERROR: Locked state requires success criteria"
    exit 1
  fi
  echo "ERROR: Goals present but no success criteria defined"
  exit 1
fi

if [[ "$STATE" == "locked" ]]; then
  echo "GOALS LOCKED"
  exit 0
fi

if [[ "$STATE" == "blocked" ]]; then
  echo "BLOCKED"
  exit 0
fi

echo "VALIDATION PASSED for ${TASK_NAME} ${ITERATION}"
