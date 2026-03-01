#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} <signals-json-file> [--format shell|json|markdown]

Input JSON schema (required keys):
{
  "scope": 0|2|4,
  "behavior": 0|2|4,
  "dependency": 0|2|4,
  "uncertainty": 0|2|4,
  "verification": 0|2|4,
  "evidence": {
    "scope": "<trimmed non-empty string with files= and surface=>",
    "behavior": "<trimmed non-empty string>",
    "dependency": "<trimmed non-empty string with interfaces=>",
    "uncertainty": "<trimmed non-empty string>",
    "verification": "<trimmed non-empty string with checks=>",
    "guardrails": "<trimmed non-empty string>"
  },
  "guardrails": {
    "no_schema_or_api_contract_change": true|false,
    "no_new_external_dependencies": true|false,
    "localized_surface": true|false,
    "reversible_with_straightforward_verification": true|false
  },
  "overrides": {
    "goals": <optional int in 1..20>,
    "phases": <optional int in 1..12>,
    "reason": "<required non-empty string when goals/phases override is used>"
  }
}
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

INPUT_FILE="${1:-}"
FORMAT_FLAG="${2:---format}"
FORMAT_VALUE_INPUT="${3:-shell}"

if [[ -z "${INPUT_FILE}" ]]; then
  usage
  exit 2
fi

if [[ ! -f "${INPUT_FILE}" ]]; then
  echo "ERROR: Missing signals file: ${INPUT_FILE}"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required by ${SCRIPT_NAME}"
  exit 1
fi

if ! jq -e . "${INPUT_FILE}" >/dev/null 2>&1; then
  echo "ERROR: invalid JSON in ${INPUT_FILE}"
  exit 1
fi

if [[ "${FORMAT_FLAG}" != "--format" ]]; then
  echo "ERROR: second argument must be --format"
  exit 2
fi

FORMAT_VALUE="${FORMAT_VALUE_INPUT}"
if [[ "${FORMAT_VALUE}" != "shell" && "${FORMAT_VALUE}" != "json" && "${FORMAT_VALUE}" != "markdown" ]]; then
  echo "ERROR: format must be --format shell, --format json, or --format markdown"
  exit 2
fi

trim_whitespace() {
  sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

validate_score() {
  local key="$1"
  local value
  if ! jq -e ".${key} | (type == \"number\") and (. == 0 or . == 2 or . == 4)" "${INPUT_FILE}" >/dev/null 2>&1; then
    value="$(jq -r ".${key} // \"<missing>\"" "${INPUT_FILE}" 2>/dev/null || echo "<invalid>")"
    echo "ERROR: '${key}' must be one of 0, 2, 4 (found '${value}')"
    exit 1
  fi
}

validate_evidence() {
  local key="$1"
  local value
  if ! jq -e ".evidence.${key} | type == \"string\"" "${INPUT_FILE}" >/dev/null 2>&1; then
    echo "ERROR: Missing required evidence line '.evidence.${key}'"
    exit 1
  fi
  value="$(jq -r ".evidence.${key}" "${INPUT_FILE}" | trim_whitespace)"
  if [[ -z "${value}" ]]; then
    echo "ERROR: Missing required evidence line '.evidence.${key}'"
    exit 1
  fi
  echo "${value}"
}

require_evidence_token() {
  local key="$1"
  local value="$2"
  local token="$3"
  if ! grep -Eq "${token}" <<<"${value}"; then
    echo "ERROR: evidence.${key} must contain '${token}'"
    exit 1
  fi
}

validate_guardrail_bool() {
  local key="$1"
  local value
  if ! jq -e ".guardrails.${key} | type == \"boolean\"" "${INPUT_FILE}" >/dev/null 2>&1; then
    echo "ERROR: '.guardrails.${key}' must be true or false"
    exit 1
  fi
  value="$(jq -r ".guardrails.${key}" "${INPUT_FILE}")"
  if [[ "${value}" != "true" && "${value}" != "false" ]]; then
    echo "ERROR: '.guardrails.${key}' must be true or false"
    exit 1
  fi
}

validate_score "scope"
validate_score "behavior"
validate_score "dependency"
validate_score "uncertainty"
validate_score "verification"

scope_evidence="$(validate_evidence "scope")"
behavior_evidence="$(validate_evidence "behavior")"
dependency_evidence="$(validate_evidence "dependency")"
uncertainty_evidence="$(validate_evidence "uncertainty")"
verification_evidence="$(validate_evidence "verification")"
guardrails_evidence="$(validate_evidence "guardrails")"

require_evidence_token "scope" "${scope_evidence}" 'files='
require_evidence_token "scope" "${scope_evidence}" 'surface='
require_evidence_token "dependency" "${dependency_evidence}" 'interfaces='
require_evidence_token "verification" "${verification_evidence}" 'checks='

validate_guardrail_bool "no_schema_or_api_contract_change"
validate_guardrail_bool "no_new_external_dependencies"
validate_guardrail_bool "localized_surface"
validate_guardrail_bool "reversible_with_straightforward_verification"

scope="$(jq -er '.scope' "${INPUT_FILE}")"
behavior="$(jq -er '.behavior' "${INPUT_FILE}")"
dependency="$(jq -er '.dependency' "${INPUT_FILE}")"
uncertainty="$(jq -er '.uncertainty' "${INPUT_FILE}")"
verification="$(jq -er '.verification' "${INPUT_FILE}")"

no_schema_or_api_contract_change="$(jq -r '.guardrails.no_schema_or_api_contract_change' "${INPUT_FILE}")"
no_new_external_dependencies="$(jq -r '.guardrails.no_new_external_dependencies' "${INPUT_FILE}")"
localized_surface="$(jq -r '.guardrails.localized_surface' "${INPUT_FILE}")"
reversible_with_straightforward_verification="$(jq -r '.guardrails.reversible_with_straightforward_verification' "${INPUT_FILE}")"

force_l1="false"
if [[ "${no_schema_or_api_contract_change}" == "true" \
   && "${no_new_external_dependencies}" == "true" \
   && "${localized_surface}" == "true" \
   && "${reversible_with_straightforward_verification}" == "true" ]]; then
  force_l1="true"
fi

total_score=$((scope + behavior + dependency + uncertainty + verification))

if (( total_score <= 4 )); then
  level="L1"; level_name="surgical"; goals_min=1; goals_max=3; phases_min=1; phases_max=1
elif (( total_score <= 8 )); then
  level="L2"; level_name="focused"; goals_min=3; goals_max=5; phases_min=2; phases_max=4
elif (( total_score <= 12 )); then
  level="L3"; level_name="multi-surface"; goals_min=5; goals_max=8; phases_min=4; phases_max=6
elif (( total_score <= 16 )); then
  level="L4"; level_name="cross-system"; goals_min=8; goals_max=13; phases_min=6; phases_max=9
else
  level="L5"; level_name="program"; goals_min=13; goals_max=20; phases_min=9; phases_max=12
fi

goals_midpoint=$(((goals_min + goals_max) / 2))
phases_midpoint=$(((phases_min + phases_max) / 2))

goals_adjust=0
phases_adjust=0
if (( uncertainty == 4 )); then
  goals_adjust=$((goals_adjust + 1))
  phases_adjust=$((phases_adjust + 1))
fi
if (( dependency == 4 )); then
  goals_adjust=$((goals_adjust + 1))
  phases_adjust=$((phases_adjust + 1))
fi
if (( verification == 4 )); then
  phases_adjust=$((phases_adjust + 1))
fi
if (( uncertainty == 0 && dependency == 0 && verification == 0 )); then
  goals_adjust=$((goals_adjust - 1))
  phases_adjust=$((phases_adjust - 1))
fi

base_recommended_goals=$((goals_midpoint + goals_adjust))
base_recommended_phases=$((phases_midpoint + phases_adjust))

if (( base_recommended_goals < goals_min )); then
  base_recommended_goals="${goals_min}"
elif (( base_recommended_goals > goals_max )); then
  base_recommended_goals="${goals_max}"
fi

if (( base_recommended_phases < phases_min )); then
  base_recommended_phases="${phases_min}"
elif (( base_recommended_phases > phases_max )); then
  base_recommended_phases="${phases_max}"
fi

override_goals="$(jq -er '.overrides.goals? // empty' "${INPUT_FILE}" 2>/dev/null || true)"
override_phases="$(jq -er '.overrides.phases? // empty' "${INPUT_FILE}" 2>/dev/null || true)"
override_reason="$(jq -er '.overrides.reason? // empty' "${INPUT_FILE}" 2>/dev/null || true)"
override_reason="$(echo "${override_reason}" | trim_whitespace)"

recommended_goals="${base_recommended_goals}"
recommended_phases="${base_recommended_phases}"
goals_override_applied="false"
phases_override_applied="false"

if [[ -n "${override_goals}" ]]; then
  if [[ ! "${override_goals}" =~ ^[0-9]+$ ]] || (( 10#${override_goals} < 1 || 10#${override_goals} > 20 )); then
    echo "ERROR: overrides.goals must be an integer in 1..20"
    exit 1
  fi
  recommended_goals="${override_goals}"
  goals_override_applied="true"
fi

if [[ -n "${override_phases}" ]]; then
  if [[ ! "${override_phases}" =~ ^[0-9]+$ ]] || (( 10#${override_phases} < 1 || 10#${override_phases} > 12 )); then
    echo "ERROR: overrides.phases must be an integer in 1..12"
    exit 1
  fi
  recommended_phases="${override_phases}"
  phases_override_applied="true"
fi

if [[ "${goals_override_applied}" == "true" || "${phases_override_applied}" == "true" ]]; then
  if ! jq -e '.overrides.reason? | type == "string"' "${INPUT_FILE}" >/dev/null 2>&1; then
    echo "ERROR: overrides.reason must be a string when overrides.goals or overrides.phases is set"
    exit 1
  fi
  if [[ -z "${override_reason}" ]]; then
    echo "ERROR: overrides.reason is required when overrides.goals or overrides.phases is set"
    exit 1
  fi
fi

if [[ "${FORMAT_VALUE}" == "shell" ]]; then
  cat <<EOF
total_score=${total_score}
level=${level}
level_name=${level_name}
force_l1=${force_l1}
guardrails_all_true=${force_l1}
goals_min=${goals_min}
goals_max=${goals_max}
phases_min=${phases_min}
phases_max=${phases_max}
goals_midpoint=${goals_midpoint}
phases_midpoint=${phases_midpoint}
adjustment=${phases_adjust}
goals_adjust=${goals_adjust}
phases_adjust=${phases_adjust}
base_recommended_goals=${base_recommended_goals}
base_recommended_phases=${base_recommended_phases}
recommended_goals=${recommended_goals}
recommended_phases=${recommended_phases}
goals_override_applied=${goals_override_applied}
phases_override_applied=${phases_override_applied}
EOF
  exit 0
fi

if [[ "${FORMAT_VALUE}" == "json" ]]; then
  jq -n \
    --argjson total_score "${total_score}" \
    --arg level "${level}" \
    --arg level_name "${level_name}" \
    --arg force_l1 "${force_l1}" \
    --argjson goals_min "${goals_min}" \
    --argjson goals_max "${goals_max}" \
    --argjson phases_min "${phases_min}" \
    --argjson phases_max "${phases_max}" \
    --argjson goals_midpoint "${goals_midpoint}" \
    --argjson phases_midpoint "${phases_midpoint}" \
    --argjson goals_adjust "${goals_adjust}" \
    --argjson phases_adjust "${phases_adjust}" \
    --argjson base_recommended_goals "${base_recommended_goals}" \
    --argjson base_recommended_phases "${base_recommended_phases}" \
    --argjson recommended_goals "${recommended_goals}" \
    --argjson recommended_phases "${recommended_phases}" \
    --arg goals_override_applied "${goals_override_applied}" \
    --arg phases_override_applied "${phases_override_applied}" \
    --arg override_reason "${override_reason}" \
    '{
      total_score: $total_score,
      level: $level,
      level_name: $level_name,
      force_l1: ($force_l1 == "true"),
      guardrails_all_true: ($force_l1 == "true"),
      ranges: {
        goals: { min: $goals_min, max: $goals_max },
        phases: { min: $phases_min, max: $phases_max }
      },
      midpoint: {
        goals: $goals_midpoint,
        phases: $phases_midpoint
      },
      adjustment: $phases_adjust,
      adjustments: {
        goals: $goals_adjust,
        phases: $phases_adjust
      },
      base_recommended: {
        goals: $base_recommended_goals,
        phases: $base_recommended_phases
      },
      recommended: {
        goals: $recommended_goals,
        phases: $recommended_phases
      },
      override_applied: {
        goals: ($goals_override_applied == "true"),
        phases: ($phases_override_applied == "true")
      },
      override_reason: (
        if ($goals_override_applied == "true" or $phases_override_applied == "true")
        then $override_reason
        else null
        end
      )
    }'
  exit 0
fi

cat <<EOF
## Complexity Score
- Total score: ${total_score}
- Level: ${level} (${level_name})
- Guardrails-all-true (informational): ${force_l1}

## Ranges
- Goals: ${goals_min}-${goals_max}
- Phases: ${phases_min}-${phases_max}

## Deterministic Recommendation
- Midpoints: goals=${goals_midpoint}, phases=${phases_midpoint}
- Adjustments: goals=${goals_adjust}, phases=${phases_adjust}
- Base recommendation: goals=${base_recommended_goals}, phases=${base_recommended_phases}
- Final recommendation: goals=${recommended_goals}, phases=${recommended_phases}
EOF

if [[ "${goals_override_applied}" == "true" || "${phases_override_applied}" == "true" ]]; then
  cat <<EOF

## Override
- Applied: true
- Reason: ${override_reason}
EOF
fi
