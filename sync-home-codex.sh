#!/usr/bin/env bash
set -euo pipefail

source_root="${HOME}/.codex"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_root="${repo_root}/.codex"
directories=(goals tasks scripts rules prompts)

if [[ ! -d "${source_root}" ]]; then
  echo "Missing source directory: ${source_root}" >&2
  exit 1
fi

mkdir -p "${target_root}"

for dir in "${directories[@]}"; do
  source_dir="${source_root}/${dir}"
  target_dir="${target_root}/${dir}"

  if [[ ! -d "${source_dir}" ]]; then
    echo "Missing source directory: ${source_dir}" >&2
    exit 1
  fi

  mkdir -p "${target_dir}"
  cp -a "${source_dir}/." "${target_dir}/"
done

echo "Synced ${directories[*]} from ${source_root} to ${target_root}"
