#!/usr/bin/env bash
set -euo pipefail

IDEA_NAME="${1:-}"
ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
IDEA_DIR="${ROOT_DIR}/project-ideas/${IDEA_NAME}"
BASELINE_FILE="${IDEA_DIR}/00-baseline.md"
SURFACE_FILE="${IDEA_DIR}/01-surface-map.md"

usage() {
  echo "Usage (canonical): ./.codex/scripts/product-idea-scope-fingerprint.sh <idea-name>"
  echo "Usage (repo-local fallback): ./codex/scripts/product-idea-scope-fingerprint.sh <idea-name>"
  echo "Usage (home fallback): ${HOME}/.codex/scripts/product-idea-scope-fingerprint.sh <idea-name>"
}

hash_stdin() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | awk '{print $1}'
    return
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
    return
  fi

  echo "ERROR: No SHA-256 tool found (expected shasum or sha256sum)." >&2
  exit 1
}

if [[ -z "${IDEA_NAME}" ]]; then
  usage
  exit 2
fi

if [[ ! "${IDEA_NAME}" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "ERROR: idea-name must be kebab-case using lowercase letters, digits, and hyphens only." >&2
  exit 2
fi

if [[ ! -f "${BASELINE_FILE}" ]]; then
  echo "ERROR: Missing required file: ${BASELINE_FILE}" >&2
  exit 1
fi

if [[ ! -f "${SURFACE_FILE}" ]]; then
  echo "ERROR: Missing required file: ${SURFACE_FILE}" >&2
  exit 1
fi

{
  printf '## BASELINE\n'
  cat "${BASELINE_FILE}"
  printf '\n## SURFACE\n'
  cat "${SURFACE_FILE}"
} | hash_stdin
