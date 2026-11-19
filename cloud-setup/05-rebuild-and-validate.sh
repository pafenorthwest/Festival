#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"
base_url="${1:-http://127.0.0.1:8080}"
base_url="${base_url%/}"
compose=(docker compose --env-file cloud-setup/.env -f cloud-setup/compose.yml)

"${compose[@]}" config --quiet
echo "Building backend and frontend from the current checkout"
"${compose[@]}" build --pull backend
"${compose[@]}" build --pull frontend
echo "Ensuring postgres is healthy and running database migrations"
"${compose[@]}" up -d postgres --wait
docker run --rm --network festival-cloud_default --env-file cloud-setup/.env \
  -e DB_HOST=postgres -e DB_PORT=5432 -e DATABASE=festival_octv3_db \
  -e DB_USER=festivaladmin -e DB_SSL=false -e DB_SCHEMA=orgs \
  -v "${PWD}:/app:ro" -w /app oven/bun:1.4.2 bun run scripts/migrate.ts
"${compose[@]}" up -d --no-deps --force-recreate --no-build --pull never backend frontend
"${compose[@]}" ps
"${compose[@]}" logs --tail=100 backend frontend

echo "Checking nginx and the backend at $base_url"
for path in healthz api/bootstrap; do
  curl --fail --silent --show-error --location --retry 12 --retry-connrefused \
    --retry-all-errors --retry-delay 5 --connect-timeout 5 --max-time 15 \
    "$base_url/$path" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
if sys.argv[1] == "healthz":
    valid = isinstance(payload, dict) and payload.get("status") == "ok"
else:
    session = payload.get("session") if isinstance(payload, dict) else None
    valid = isinstance(session, dict) and session.get("authenticated") is False
if not valid:
    raise SystemExit(f"Unexpected JSON response from {sys.argv[1]}")
print(f"{sys.argv[1]} passed")
' "$path"
done

database="$("${compose[@]}" exec -T backend printenv DATABASE)"
db_user="$("${compose[@]}" exec -T backend printenv DB_USER)"
schema="$("${compose[@]}" exec -T backend printenv DB_SCHEMA)"
echo "Checking organization count in $database"
"${compose[@]}" exec -T postgres psql -X -v ON_ERROR_STOP=1 \
  -U "$db_user" -d "$database" -v schema="$schema" -f - <<'SQL'
BEGIN READ ONLY;
SELECT count(*) AS organizations FROM :"schema".organizations;
COMMIT;
SQL

echo "Running source checks with Bun 1.4.2"
git ls-files -z --cached --others --exclude-standard |
  COPYFILE_DISABLE=1 tar --null -T - -cf - |
  docker run --rm -i -w /tmp/festival oven/bun:1.4.2 sh -ec '
    tar -xf -
    bun install --frozen-lockfile
    bun run format:check
    bun run build
    bun run test
    bun run check:sql
  '

echo "Rebuild and validation passed"
