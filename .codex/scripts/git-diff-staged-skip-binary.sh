#!/usr/bin/env bash
set -euo pipefail

# Staged files only (NUL-delimited, safe for spaces)
git diff --cached --name-only -z \
| while IFS= read -r -d '' f; do
    # Skip if Git considers it binary in the index vs HEAD
    if git diff --cached --numstat -- "$f" | awk 'NR==1{exit !($1=="-" && $2=="-")}'; then
      echo "Skipping binary: $f"
      continue
    fi

    # Show text diff for this file
    git diff --cached -- "$f"
  done
