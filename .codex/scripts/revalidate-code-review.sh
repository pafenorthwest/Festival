#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
BASE_BRANCH_OVERRIDE="${2:-}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
REVIEW_FILE="${TASK_DIR}/revalidate-code-review.md"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/resolve-codex-root.sh"

usage() {
  echo "Usage (canonical): ./.codex/scripts/revalidate-code-review.sh <task-name> [base-branch]"
  echo "Usage (repo-local fallback): ./codex/scripts/revalidate-code-review.sh <task-name> [base-branch]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/revalidate-code-review.sh <task-name> [base-branch]"
}

if [[ -z "${TASK_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${TASK_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Abort: task-name must be kebab-case using lowercase letters, digits, and hyphens only."
  exit 2
fi

if [[ ! -d "${TASK_DIR}" ]]; then
  echo "Abort: missing task directory ${TASK_DIR}"
  exit 1
fi

is_valid_branch() {
  local branch="$1"
  [[ "${branch}" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "${branch}" != *"<"* ]] && [[ "${branch}" != *">"* ]]
}

resolve_base_branch() {
  local candidate=""
  local codex_root=""
  local config_file=""

  if [[ -n "${BASE_BRANCH_OVERRIDE}" ]]; then
    if ! is_valid_branch "${BASE_BRANCH_OVERRIDE}"; then
      echo "Abort: invalid base branch override '${BASE_BRANCH_OVERRIDE}'."
      exit 1
    fi
    echo "${BASE_BRANCH_OVERRIDE}"
    return 0
  fi

  if ! codex_root="$(resolve_codex_root codex-config.yaml project-structure.md)"; then
    echo "BLOCKED: unable to resolve codex root. Missing codex-config.yaml and/or project-structure.md."
    exit 1
  fi

  config_file="${codex_root}/codex-config.yaml"
  if [[ ! -f "${config_file}" ]]; then
    echo "Abort: missing codex config file: ${config_file}"
    exit 1
  fi

  if [[ ! -f "${codex_root}/project-structure.md" ]]; then
    echo "BLOCKED: missing required project structure file: ${codex_root}/project-structure.md"
    exit 1
  fi

  candidate="$(sed -nE 's/^[[:space:]]*base_branch:[[:space:]]*"?([A-Za-z0-9._\/-]+)"?[[:space:]]*$/\1/p' "${config_file}" | head -n 1)"
  if [[ -n "${candidate}" ]] && is_valid_branch "${candidate}"; then
    echo "${candidate}"
    return 0
  fi

  candidate="$(sed -nE 's/^[[:space:]-]*([Cc]ode review[[:space:]]+)?[Bb]ase branch:[[:space:]]*`?([A-Za-z0-9._\/-]+)`?.*$/\2/p' "${config_file}" | head -n 1)"
  if [[ -n "${candidate}" ]] && is_valid_branch "${candidate}"; then
    echo "${candidate}"
    return 0
  fi

  if [[ -f "${ROOT_DIR}/codex/codex-config.yaml" ]]; then
    candidate="$(sed -nE 's/^[[:space:]]*base_branch:[[:space:]]*"?([A-Za-z0-9._\/-]+)"?[[:space:]]*$/\1/p' "${ROOT_DIR}/codex/codex-config.yaml" | head -n 1)"
    if [[ -n "${candidate}" ]] && is_valid_branch "${candidate}"; then
      echo "${candidate}"
      return 0
    fi
  fi

  echo "main"
}

BASE_BRANCH="$(resolve_base_branch)"
DIFF_MODE="base-branch"
DIFF_COMMAND="git diff ${BASE_BRANCH}...HEAD"

if DIFF_TEXT="$(git diff "${BASE_BRANCH}...HEAD" 2>/dev/null)"; then
  :
else
  DIFF_TEXT=""
fi

if [[ -z "${DIFF_TEXT}" ]]; then
  DIFF_MODE="fallback"
  DIFF_COMMAND="git diff"
  DIFF_TEXT="$(git diff 2>/dev/null || true)"
fi

if [[ "${DIFF_MODE}" == "base-branch" ]]; then
  CHANGED_FILES="$(git diff --name-only "${BASE_BRANCH}...HEAD" 2>/dev/null || true)"
  HUNKS="$(git diff -U0 "${BASE_BRANCH}...HEAD" 2>/dev/null || true)"
else
  CHANGED_FILES="$(git diff --name-only 2>/dev/null || true)"
  HUNKS="$(git diff -U0 2>/dev/null || true)"
fi

CITATIONS="$(printf '%s\n' "${HUNKS}" | awk '
  /^diff --git / {
    file=$4
    sub("^b/", "", file)
    next
  }
  /^@@ / {
    if (match($0, /\+[0-9]+(,[0-9]+)?/)) {
      token=substr($0, RSTART + 1, RLENGTH - 1)
      split(token, parts, ",")
      start=parts[1] + 0
      len=(parts[2] == "" ? 1 : parts[2] + 0)
      if (len <= 0) {
        end=start
      } else {
        end=start + len - 1
      }
      if (file != "") {
        print file ":" start "-" end
      }
    }
  }
' | sort -u)"

if [[ ! -f "${REVIEW_FILE}" ]]; then
  cat > "${REVIEW_FILE}" <<EOF
# Revalidate Code Review
- Task name: ${TASK_NAME}
- Findings status: pending

## Reviewer Prompt
You are acting as a reviewer for a proposed code change made by another engineer.
Focus on issues that impact correctness, performance, security, maintainability, or developer experience.
Flag only actionable issues introduced by the pull request.
When you flag an issue, provide a short, direct explanation and cite the affected file and line range.
Prioritize severe issues and avoid nit-level comments unless they block understanding of the diff.
After listing findings, produce an overall correctness verdict ("patch is correct" or "patch is incorrect") with a concise justification and a confidence score between 0 and 1.
Ensure that file citations and line numbers are exactly correct using the tools available; if they are incorrect your comments will be rejected.

## Output Schema
\`\`\`json
[
  {
    "file": "path/to/file",
    "line_range": "10-25",
    "severity": "high",
    "explanation": "Short explanation."
  }
]
\`\`\`

## Review Context (auto-generated)
<!-- REVIEW-CONTEXT START -->
<!-- REVIEW-CONTEXT END -->

## Findings JSON
\`\`\`json
[]
\`\`\`

## Overall Correctness Verdict
- Verdict: pending
- Confidence: pending
- Justification:
EOF
fi

CTX_TMP="$(mktemp)"
{
  echo "- Generated at: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "- Base branch: ${BASE_BRANCH}"
  echo "- Diff mode: ${DIFF_MODE}"
  echo "- Diff command: \`${DIFF_COMMAND}\`"
  echo "- Diff bytes: ${#DIFF_TEXT}"
  echo
  echo "### Changed files"
  if [[ -n "${CHANGED_FILES}" ]]; then
    while IFS= read -r f; do
      [[ -z "${f}" ]] && continue
      echo "- \`${f}\`"
    done <<< "${CHANGED_FILES}"
  else
    echo "- _none_"
  fi
  echo
  echo "### Citation candidates (verify before use)"
  if [[ -n "${CITATIONS}" ]]; then
    while IFS= read -r c; do
      [[ -z "${c}" ]] && continue
      echo "- \`${c}\`"
    done <<< "${CITATIONS}"
  else
    echo "- _none_"
  fi
} > "${CTX_TMP}"

if grep -q '^<!-- REVIEW-CONTEXT START -->$' "${REVIEW_FILE}" && grep -q '^<!-- REVIEW-CONTEXT END -->$' "${REVIEW_FILE}"; then
  TMP_OUT="$(mktemp)"
  awk -v ctx="${CTX_TMP}" '
    BEGIN {in_block=0}
    /^<!-- REVIEW-CONTEXT START -->$/ {
      print
      while ((getline line < ctx) > 0) {
        print line
      }
      close(ctx)
      in_block=1
      next
    }
    /^<!-- REVIEW-CONTEXT END -->$/ {
      in_block=0
      print
      next
    }
    !in_block {print}
  ' "${REVIEW_FILE}" > "${TMP_OUT}"
  mv "${TMP_OUT}" "${REVIEW_FILE}"
else
  {
    echo
    echo "## Review Context (auto-generated)"
    echo "<!-- REVIEW-CONTEXT START -->"
    cat "${CTX_TMP}"
    echo "<!-- REVIEW-CONTEXT END -->"
  } >> "${REVIEW_FILE}"
fi

rm -f "${CTX_TMP}"

STATUS="$(sed -nE 's/^- Findings status:[[:space:]]*(pending|complete|none)[[:space:]]*$/\1/p' "${REVIEW_FILE}" | head -n 1)"
if [[ -z "${STATUS}" ]]; then
  echo "BLOCKED"
  echo "- Missing findings status. Add one of: pending, complete, none"
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

if [[ "${STATUS}" == "pending" ]]; then
  echo "BLOCKED"
  echo "- Findings status is pending. Complete code review findings before proceeding."
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

FINDINGS_JSON="$(awk '
  /^## Findings JSON$/ {in_section=1; next}
  in_section && /^```json$/ {in_json=1; next}
  in_section && /^```$/ && in_json {exit}
  in_json {print}
' "${REVIEW_FILE}")"

if [[ -z "${FINDINGS_JSON//[[:space:]]/}" ]]; then
  echo "BLOCKED"
  echo "- Findings JSON block is missing or empty."
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

COMPACT_FINDINGS="$(printf '%s' "${FINDINGS_JSON}" | tr -d '[:space:]')"
if [[ "${STATUS}" == "none" && "${COMPACT_FINDINGS}" != "[]" ]]; then
  echo "BLOCKED"
  echo "- Findings status is 'none' but Findings JSON is not []."
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

if [[ "${STATUS}" == "complete" ]]; then
  if [[ "${COMPACT_FINDINGS}" == "[]" ]]; then
    echo "BLOCKED"
    echo "- Findings status is 'complete' but Findings JSON is empty ([])."
    echo "- File: ${REVIEW_FILE}"
    exit 1
  fi

  for key in '"file"' '"line_range"' '"severity"' '"explanation"'; do
    if ! grep -q "${key}" <<< "${FINDINGS_JSON}"; then
      echo "BLOCKED"
      echo "- Findings JSON missing required key ${key}."
      echo "- File: ${REVIEW_FILE}"
      exit 1
    fi
  done

  if ! grep -Eq '"severity"[[:space:]]*:[[:space:]]*"(low|medium|high)"' <<< "${FINDINGS_JSON}"; then
    echo "BLOCKED"
    echo "- Findings JSON must use severity values low|medium|high."
    echo "- File: ${REVIEW_FILE}"
    exit 1
  fi
fi

VERDICT="$(sed -nE 's/^- Verdict:[[:space:]]*(patch is correct|patch is incorrect)[[:space:]]*$/\1/p' "${REVIEW_FILE}" | head -n 1)"
if [[ -z "${VERDICT}" ]]; then
  echo "BLOCKED"
  echo "- Missing or invalid verdict. Use: patch is correct | patch is incorrect."
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

CONFIDENCE_RAW="$(sed -nE 's/^- Confidence:[[:space:]]*([0-9]+(\.[0-9]+)?)[[:space:]]*$/\1/p' "${REVIEW_FILE}" | head -n 1)"
if [[ -z "${CONFIDENCE_RAW}" ]]; then
  echo "BLOCKED"
  echo "- Missing or invalid confidence. Provide a numeric value between 0 and 1."
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

if ! awk -v c="${CONFIDENCE_RAW}" 'BEGIN {exit !(c >= 0 && c <= 1)}'; then
  echo "BLOCKED"
  echo "- Confidence out of range. Must be between 0 and 1."
  echo "- File: ${REVIEW_FILE}"
  exit 1
fi

echo "READY"
echo "Revalidate code review file is valid: ${REVIEW_FILE}"
echo "Base branch: ${BASE_BRANCH}"
echo "Diff mode: ${DIFF_MODE}"
