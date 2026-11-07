#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

printf 'From the repository root:\n  cd %q\n\n' "$repo_root"
cat <<'COMMANDS'
Validate the hand-written environment file:
  bash cloud-setup/02-validate-env.sh

Start the prepared services (only when ready to run them):
  docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml up -d --no-build --pull never

Show service status:
  docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml ps

Stop the services, retaining containers and volumes:
  docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml stop

Start those stopped containers again:
  docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml start

Remove containers and network while retaining database and audit volumes:
  docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml down
COMMANDS
