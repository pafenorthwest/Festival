#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"

if [[ -z "$TASK_NAME" ]]; then
  echo "ERROR: TASK_NAME_IN_KEBAB_CASE is required"
  exit 1
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "ERROR: TASK_NAME_IN_KEBAB_CASE must use lowercase letters, digits, and hyphens only"
  echo "Example: add-performer-search"
  exit 1
fi

GOALS_DIR="./goals/${TASK_NAME}"

if [[ ! -d "$GOALS_DIR" ]]; then
  echo "ERROR: No goals directory for task '${TASK_NAME}'"
  exit 1
fi

LATEST_ITERATION=$(
  ls "$GOALS_DIR" 2>/dev/null \
  | sed -n 's/^establish-goals\.v\([0-9][0-9]*\)\.md$/\1/p' \
  | sort -n \
  | tail -n 1
)

if [[ -z "$LATEST_ITERATION" ]]; then
  echo "ERROR: No existing establish-goals.vN.md found"
  exit 1
fi

NEXT_ITERATION="v$((LATEST_ITERATION + 1))"

PREV_ESTABLISH="${GOALS_DIR}/establish-goals.v${LATEST_ITERATION}.md"
NEW_ESTABLISH="${GOALS_DIR}/establish-goals.${NEXT_ITERATION}.md"
NEW_GOALS="${GOALS_DIR}/goals.${NEXT_ITERATION}.md"

cp "$PREV_ESTABLISH" "$NEW_ESTABLISH"

sed -i.bak \
  -e "s/^- Iteration: v[0-9][0-9]*/- Iteration: ${NEXT_ITERATION}/" \
  -e "s/^Iteration: v[0-9][0-9]*/Iteration: ${NEXT_ITERATION}/" \
  -e "s/^- State: .*/- State: draft/" \
  -e "s/^State: .*/State: draft/" \
  -e "s/^- Verdict: .*/- Verdict: draft/" \
  -e "s/^Verdict: .*/Verdict: draft/" \
  "$NEW_ESTABLISH"

rm -f "${NEW_ESTABLISH}.bak"

cat > "$NEW_GOALS" <<EOF
# Goals Extract
- Task name: ${TASK_NAME}
- Iteration: ${NEXT_ITERATION}
- State: draft

## Goals (1-20, verifiable)

## Non-goals

## Success criteria
EOF

echo "Created next iteration ${NEXT_ITERATION} for task '${TASK_NAME}'"
