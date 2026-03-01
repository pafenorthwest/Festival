#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
ITERATION="${2:-}"

if [[ -z "$TASK_NAME" || -z "$ITERATION" ]]; then
  echo "ERROR: TASK_NAME_IN_KEBAB_CASE and iteration (vN) are required"
  exit 1
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "ERROR: TASK_NAME_IN_KEBAB_CASE must use lowercase letters, digits, and hyphens only"
  echo "Example: add-performer-search"
  exit 1
fi

GOALS_DIR="./goals/${TASK_NAME}"
ESTABLISH_FILE="${GOALS_DIR}/establish-goals.${ITERATION}.md"
GOALS_FILE="${GOALS_DIR}/goals.${ITERATION}.md"

if [[ ! -f "$ESTABLISH_FILE" ]]; then
  echo "ERROR: Missing $ESTABLISH_FILE"
  exit 1
fi

STATE=$(sed -n 's/^- State: //p; s/^State: //p' "$ESTABLISH_FILE" | head -n 1)

{
  echo "# Goals Extract"
  echo "- Task name: ${TASK_NAME}"
  echo "- Iteration: ${ITERATION}"
  echo "- State: ${STATE}"
  echo
  sed -n '/^## Goals/,/^## /p' "$ESTABLISH_FILE" | sed '$d'
  echo
  sed -n '/^## Non-goals/,/^## /p' "$ESTABLISH_FILE" | sed '$d'
  echo
  sed -n '/^## Success criteria/,/^## /p' "$ESTABLISH_FILE" | sed '$d'
} > "$GOALS_FILE"

echo "Extracted normalized goals to ${GOALS_FILE}"
