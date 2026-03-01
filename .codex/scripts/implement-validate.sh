#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TASK_DIR="${ROOT_DIR}/tasks/${TASK_NAME}"
SPEC_FILE="${TASK_DIR}/spec.md"
PHASE_PLAN_FILE="${TASK_DIR}/phase-plan.md"
LOCK_FILE="${TASK_DIR}/.scope-lock.md"
FINAL_PHASE_FILE="${TASK_DIR}/final-phase.md"

usage() {
  echo "Usage (canonical): ./.codex/scripts/implement-validate.sh <task-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/implement-validate.sh <task-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/implement-validate.sh <task-name>"
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

if [[ -f "${PHASE_PLAN_FILE}" ]]; then
  if ! grep -Eq '^- Verdict: (READY FOR IMPLEMENTATION|READY TO LAND)$' "${PHASE_PLAN_FILE}"; then
    issues+=("Precondition failed: ${PHASE_PLAN_FILE} must contain '- Verdict: READY FOR IMPLEMENTATION' or '- Verdict: READY TO LAND' before Stage 4/5 validation.")
  fi
fi

if [[ -f "${LOCK_FILE}" && -f "${SPEC_FILE}" ]]; then
  locked_in="$(extract_section_from_file "${LOCK_FILE}" '^##[[:space:]]+IN SCOPE$')"
  locked_out="$(extract_section_from_file "${LOCK_FILE}" '^##[[:space:]]+OUT OF SCOPE$')"
  current_in="$(extract_section_from_file "${SPEC_FILE}" '^##[[:space:]]+IN SCOPE$')"
  current_out="$(extract_section_from_file "${SPEC_FILE}" '^##[[:space:]]+OUT OF SCOPE$')"

  if [[ "${locked_in}" != "${current_in}" || "${locked_out}" != "${current_out}" ]]; then
    issues+=("No-new-scope hard stop: scope sections changed since lock snapshot (${LOCK_FILE}).")
  fi
fi

if [[ -f "${FINAL_PHASE_FILE}" ]]; then
  if ! grep -Eq '^[[:space:]]*[-*][[:space:]]+\[[xX]\][[:space:]]+Lint:[[:space:]]+`[^`]+`.*\bPASS\b' "${FINAL_PHASE_FILE}"; then
    issues+=("Missing Lint pass evidence in ${FINAL_PHASE_FILE}. Required format: '- [x] Lint: \`<command>\` PASS'")
  fi

  if ! grep -Eq '^[[:space:]]*[-*][[:space:]]+\[[xX]\][[:space:]]+Build:[[:space:]]+`[^`]+`.*\bPASS\b' "${FINAL_PHASE_FILE}"; then
    issues+=("Missing Build pass evidence in ${FINAL_PHASE_FILE}. Required format: '- [x] Build: \`<command>\` PASS'")
  fi

  if ! grep -Eq '^[[:space:]]*[-*][[:space:]]+\[[xX]\][[:space:]]+Tests:[[:space:]]+`[^`]+`.*\bPASS\b' "${FINAL_PHASE_FILE}"; then
    issues+=("Missing Tests pass evidence in ${FINAL_PHASE_FILE}. Required format: '- [x] Tests: \`<command>\` PASS'")
  fi

  unchecked_without_eval_count="$(
    awk '
      /^[[:space:]]*[-*][[:space:]]+\[[[:space:]]\]/ {
        if ($0 !~ /EVALUATED:[[:space:]]*/ ) {
          count++
        }
      }
      END {print count+0}
    ' "${FINAL_PHASE_FILE}"
  )"
  if [[ "${unchecked_without_eval_count}" -gt 0 ]]; then
    issues+=("Checklist evaluation incomplete in ${FINAL_PHASE_FILE}: ${unchecked_without_eval_count} unchecked item(s) missing 'EVALUATED: ...'.")
  fi

  outstanding_section="$(extract_section_from_file "${FINAL_PHASE_FILE}" '^##[[:space:]]+Outstanding issues.*$')"
  if [[ -z "${outstanding_section//[[:space:]]/}" ]]; then
    issues+=("Missing or empty Outstanding issues section in ${FINAL_PHASE_FILE}.")
  else
    if ! grep -Eq '^[[:space:]]*[-*][[:space:]]+None\.?[[:space:]]*$' <<< "${outstanding_section}"; then
      if grep -Eq '^[[:space:]]*[-*][[:space:]]+Severity:[[:space:]]*$' <<< "${outstanding_section}"; then
        issues+=("Outstanding issues in ${FINAL_PHASE_FILE} contain placeholder-only 'Severity:' entries.")
      fi
      if grep -Eq '^[[:space:]]*[-*][[:space:]]+Repro:[[:space:]]*$' <<< "${outstanding_section}"; then
        issues+=("Outstanding issues in ${FINAL_PHASE_FILE} contain placeholder-only 'Repro:' entries.")
      fi
      if grep -Eq '^[[:space:]]*[-*][[:space:]]+Suggested fix:[[:space:]]*$' <<< "${outstanding_section}"; then
        issues+=("Outstanding issues in ${FINAL_PHASE_FILE} contain placeholder-only 'Suggested fix:' entries.")
      fi
    fi
  fi
fi

if [[ "${#issues[@]}" -eq 0 ]]; then
  set_verdict "READY TO LAND"
  echo "READY TO LAND"
  exit 0
fi

set_verdict "BLOCKED"
echo "BLOCKED"
for issue in "${issues[@]}"; do
  echo "- ${issue}"
done
exit 1
