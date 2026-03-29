#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend_pid=""
nginx_pid=""
nginx_pid_file="/tmp/festival-nginx-$$.pid"
backend_bun_args=()

for arg in "$@"; do
  case "$arg" in
    --env-file=*)
      backend_bun_args+=("$arg")
      ;;
    *)
      echo "Unsupported argument for 'bun run prod': $arg" >&2
      echo "Supported arguments: --env-file=/path/to/.env" >&2
      exit 1
      ;;
  esac
done

cleanup() {
  trap - EXIT INT TERM

  if [[ -n "$nginx_pid" ]] && kill -0 "$nginx_pid" 2>/dev/null; then
    kill "$nginx_pid" 2>/dev/null || true
  fi

  if [[ -n "$backend_pid" ]] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" 2>/dev/null || true
  fi

  wait "$nginx_pid" 2>/dev/null || true
  wait "$backend_pid" 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT TERM

cd "$ROOT_DIR"

if ! command -v nginx >/dev/null 2>&1; then
  echo "nginx is required for 'bun run prod' but was not found on PATH." >&2
  exit 1
fi

echo "Building workspace artifacts for production"
bun run build

echo "Validating nginx configuration"
nginx -t -p "$ROOT_DIR" -c "$ROOT_DIR/nginx/festival.conf" -g "error_log stderr warn; pid $nginx_pid_file;" >/dev/null

echo "Starting backend production server on http://localhost:3000"
PORT=3000 NODE_ENV=production bun "${backend_bun_args[@]}" ./packages/backend/dist/index.js &
backend_pid=$!

echo "Starting nginx frontend server on http://localhost:8080"
nginx -p "$ROOT_DIR" -c "$ROOT_DIR/nginx/festival.conf" -g "daemon off; error_log stderr warn; pid $nginx_pid_file;" &
nginx_pid=$!

while true; do
  if ! kill -0 "$backend_pid" 2>/dev/null; then
    wait "$backend_pid"
    exit $?
  fi

  if ! kill -0 "$nginx_pid" 2>/dev/null; then
    wait "$nginx_pid"
    exit $?
  fi

  sleep 1
done
