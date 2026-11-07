#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="$script_dir/.env"
compose_file="$script_dir/compose.yml"

bash "$script_dir/02-validate-env.sh"

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin is required. Run the prerequisite setup script first." >&2
  exit 1
fi

# Confirm the user-supplied environment resolves before downloading images.
docker compose --env-file "$env_file" -f "$compose_file" config --quiet

# Keep builds serial on small cloud hosts. These commands never create containers.
export COMPOSE_PARALLEL_LIMIT=1
docker compose --env-file "$env_file" -f "$compose_file" pull postgres
docker compose --env-file "$env_file" -f "$compose_file" build --pull backend
docker compose --env-file "$env_file" -f "$compose_file" build --pull frontend

echo "Images are ready. No services were started."
