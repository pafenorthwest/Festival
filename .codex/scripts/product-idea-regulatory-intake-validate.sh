#!/usr/bin/env bash
set -euo pipefail

IDEA_NAME="${1:-}"
EXPECTED_FINGERPRINT="${2:-}"
NOW_UTC="${3:-}"

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDEA_DIR="${ROOT_DIR}/project-ideas/${IDEA_NAME}"
REG_DIR="${IDEA_DIR}/regulatory"

MANIFEST_FILE="${REG_DIR}/regulatory-manifest.md"
SURFACE_FILE="${REG_DIR}/02-regulatory-surface.md"
EVAL_FILE="${REG_DIR}/02b-regulatory-evaluation.md"
SOURCES_FILE="${REG_DIR}/regulatory-sources.md"
IMPLICATIONS_FILE="${REG_DIR}/regulatory-capability-implications.md"
EXCEPTION_FILE="${REG_DIR}/regulatory-exception.md"
DECISION_LOG_FILE="${IDEA_DIR}/decision-log.md"

usage() {
  echo "Usage (canonical): ./.codex/scripts/product-idea-regulatory-intake-validate.sh <idea-name> [expected-input-fingerprint] [current-utc]"
  echo "Usage (repo-local fallback): ./codex/scripts/product-idea-regulatory-intake-validate.sh <idea-name> [expected-input-fingerprint] [current-utc]"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/product-idea-regulatory-intake-validate.sh <idea-name> [expected-input-fingerprint] [current-utc]"
}

now_utc_default() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

is_rfc3339_utc() {
  [[ "${1}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

extract_field() {
  local file="$1"
  local key="$2"
  awk -v key="${key}" '
    BEGIN { key_l = tolower(key) }
    {
      line = $0
      gsub(/^[[:space:]]*[-*][[:space:]]*/, "", line)
      sub(/^[[:space:]]+/, "", line)
      line_l = tolower(line)
      if (line_l ~ ("^" key_l ":[[:space:]]*")) {
        sub(/^[^:]+:[[:space:]]*/, "", line)
        print line
        exit
      }
    }
  ' "${file}"
}

get_manifest_field() {
  local value
  for key in "$@"; do
    value="$(extract_field "${MANIFEST_FILE}" "${key}")"
    if [[ -n "${value}" ]]; then
      printf '%s' "${value}"
      return
    fi
  done
}

issues=()

if [[ -z "${IDEA_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${IDEA_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "ERROR: idea-name must be kebab-case using lowercase letters, digits, and hyphens only." >&2
  exit 2
fi

if [[ -z "${NOW_UTC}" ]]; then
  NOW_UTC="$(now_utc_default)"
fi

if ! is_rfc3339_utc "${NOW_UTC}"; then
  echo "ERROR: current-utc must be RFC 3339 UTC format (YYYY-MM-DDTHH:MM:SSZ)." >&2
  exit 2
fi

if [[ ! -d "${REG_DIR}" ]]; then
  issues+=("Missing required directory: ${REG_DIR}")
fi

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  issues+=("Missing required file: ${MANIFEST_FILE}")
fi

if [[ ! -f "${SURFACE_FILE}" ]]; then
  issues+=("Missing required file: ${SURFACE_FILE}")
fi

if [[ ! -f "${SOURCES_FILE}" ]]; then
  issues+=("Missing required file: ${SOURCES_FILE}")
fi

if [[ ! -f "${IMPLICATIONS_FILE}" ]]; then
  issues+=("Missing required file: ${IMPLICATIONS_FILE}")
fi

status=""
generated_at=""
expires_at=""
input_fingerprint=""

if [[ -f "${MANIFEST_FILE}" ]]; then
  status="$(get_manifest_field "status")"
  generated_at="$(get_manifest_field "generated_at" "generated at")"
  expires_at="$(get_manifest_field "expires_at" "expires at")"
  input_fingerprint="$(get_manifest_field "input_fingerprint" "input fingerprint")"

  case "${status}" in
    SURFACE_FOUND|NO_SURFACE|EXCEPTION_APPROVED|INCONCLUSIVE) ;;
    *)
      issues+=("Invalid or missing manifest status in ${MANIFEST_FILE}. Expected SURFACE_FOUND|NO_SURFACE|EXCEPTION_APPROVED|INCONCLUSIVE.")
      ;;
  esac

  if [[ "${status}" == "INCONCLUSIVE" ]]; then
    issues+=("Manifest status is INCONCLUSIVE; regulatory intake cannot progress without EXCEPTION_APPROVED.")
  fi

  if [[ "${status}" == "SURFACE_FOUND" && ! -f "${EVAL_FILE}" ]]; then
    issues+=("Missing required file for SURFACE_FOUND status: ${EVAL_FILE}")
  fi

  if [[ -z "${generated_at}" ]]; then
    issues+=("Missing manifest field: generated_at")
  elif ! is_rfc3339_utc "${generated_at}"; then
    issues+=("Invalid generated_at format in ${MANIFEST_FILE}; expected RFC 3339 UTC.")
  fi

  if [[ -z "${expires_at}" ]]; then
    issues+=("Missing manifest field: expires_at")
  elif ! is_rfc3339_utc "${expires_at}"; then
    issues+=("Invalid expires_at format in ${MANIFEST_FILE}; expected RFC 3339 UTC.")
  elif [[ "${NOW_UTC}" > "${expires_at}" || "${NOW_UTC}" == "${expires_at}" ]]; then
    issues+=("Manifest is stale: current time (${NOW_UTC}) is at/after expires_at (${expires_at}).")
  fi

  if [[ -z "${input_fingerprint}" ]]; then
    issues+=("Missing manifest field: input_fingerprint")
  fi
fi

if [[ -z "${EXPECTED_FINGERPRINT}" ]]; then
  if [[ -x "${SCRIPT_DIR}/product-idea-scope-fingerprint.sh" ]]; then
    if ! EXPECTED_FINGERPRINT="$("${SCRIPT_DIR}/product-idea-scope-fingerprint.sh" "${IDEA_NAME}" 2>/dev/null)"; then
      issues+=("Unable to derive expected input fingerprint from project baseline/surface files.")
    fi
  else
    issues+=("Missing fingerprint helper script: ${SCRIPT_DIR}/product-idea-scope-fingerprint.sh")
  fi
fi

if [[ -n "${EXPECTED_FINGERPRINT}" && -n "${input_fingerprint}" && "${input_fingerprint}" != "${EXPECTED_FINGERPRINT}" ]]; then
  issues+=("Manifest fingerprint mismatch: manifest=${input_fingerprint}, expected=${EXPECTED_FINGERPRINT}.")
fi

if [[ "${status}" == "EXCEPTION_APPROVED" ]]; then
  if [[ ! -f "${EXCEPTION_FILE}" ]]; then
    issues+=("Missing required exception file for EXCEPTION_APPROVED status: ${EXCEPTION_FILE}")
  else
    for field in "rationale" "scope" "owner" "expiry date" "accepted risks" "mitigation plan"; do
      if [[ -z "$(extract_field "${EXCEPTION_FILE}" "${field}")" ]]; then
        issues+=("Missing required exception field '${field}' in ${EXCEPTION_FILE}.")
      fi
    done
  fi

  if [[ ! -f "${DECISION_LOG_FILE}" ]]; then
    issues+=("Missing decision log required for exception risk flag: ${DECISION_LOG_FILE}")
  elif ! grep -Eqi 'risk flag|regulatory-exception|exception approved' "${DECISION_LOG_FILE}"; then
    issues+=("Decision log must record explicit risk flag for exception usage: ${DECISION_LOG_FILE}")
  fi
fi

if [[ "${#issues[@]}" -gt 0 ]]; then
  echo "BLOCKED"
  for issue in "${issues[@]}"; do
    echo "- ${issue}"
  done
  exit 1
fi

echo "REGULATORY INTAKE PASSED"
echo "- status: ${status}"
echo "- fingerprint: ${input_fingerprint}"
echo "- expires_at: ${expires_at}"
exit 0
