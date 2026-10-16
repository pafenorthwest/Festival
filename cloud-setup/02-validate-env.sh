#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
env_file="$script_dir/.env"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is required to validate cloud-setup/.env." >&2
  exit 1
fi

python3 - "$env_file" <<'PY'
import base64
import json
import os
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit

path = Path(sys.argv[1])
errors = []

if not path.is_file():
    sys.exit("Missing cloud-setup/.env. Copy .env.example and fill in real values.")

mode = stat.S_IMODE(path.stat().st_mode)
if mode & 0o077:
    errors.append("cloud-setup/.env is readable by group or others; run chmod 600 cloud-setup/.env")

values = {}
allowed = {
    "DB_PASSWORD", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY", "FRONT_FIREBASE_API_KEY",
    "FRONT_FIREBASE_AUTH_DOMAIN", "FRONT_FIREBASE_PROJECT_ID",
    "FRONT_FIREBASE_APP_ID", "FESTIVAL_SECRET_KEYS_JSON",
    "FESTIVAL_ACTIVE_SECRET_KEY_ID", "FESTIVAL_PUBLIC_ORIGIN",
    "API_ALLOWED_ORIGINS", "TRUST_PROXY_HEADERS",
    "FESTIVAL_RECONCILIATION_TOKEN", "ENABLE_DROP_TRANSFER",
}
for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
    if not match:
        errors.append(f"line {line_number}: expected KEY=value on one line")
        continue
    name, value = match.groups()
    if name not in allowed:
        errors.append(f"line {line_number}: unsupported variable {name}")
    if name in values:
        errors.append(f"line {line_number}: duplicate {name}")
    # Docker Compose accepts an outer quote pair. No shell evaluation occurs here.
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    values[name] = value

for name, value in values.items():
    if "REPLACE_WITH" in value:
        errors.append(f"{name} still contains an example value")
    if name in {"FESTIVAL_PUBLIC_ORIGIN", "API_ALLOWED_ORIGINS"} and "festival.example.com" in value:
        errors.append(f"{name} still contains the example domain")

required = (
    "DB_PASSWORD", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY", "FRONT_FIREBASE_API_KEY",
    "FRONT_FIREBASE_AUTH_DOMAIN", "FRONT_FIREBASE_PROJECT_ID",
    "FRONT_FIREBASE_APP_ID",
)
for name in required:
    value = values.get(name, "").strip()
    if not value:
        errors.append(f"{name} is required")
    elif value.startswith("<") or "demo-" in value:
        errors.append(f"{name} still contains an example value")

password = values.get("DB_PASSWORD", "")
if password and (len(password) < 20 or re.search(r"[\s$#'\"\\]", password)):
    errors.append("DB_PASSWORD must have at least 20 characters and avoid whitespace, $, #, quotes, and backslashes")

if values.get("FIREBASE_PROJECT_ID") != values.get("FRONT_FIREBASE_PROJECT_ID"):
    errors.append("FIREBASE_PROJECT_ID and FRONT_FIREBASE_PROJECT_ID must match")

private_key = values.get("FIREBASE_PRIVATE_KEY", "")
if private_key and not (
    private_key.startswith("-----BEGIN PRIVATE KEY-----\\n")
    and "\\n-----END PRIVATE KEY-----" in private_key
):
    errors.append("FIREBASE_PRIVATE_KEY must be a one-line PEM value with literal \\n separators")

keys_json = values.get("FESTIVAL_SECRET_KEYS_JSON", "").strip()
active_id = values.get("FESTIVAL_ACTIVE_SECRET_KEY_ID", "").strip()
if bool(keys_json) != bool(active_id):
    errors.append("FESTIVAL_SECRET_KEYS_JSON and FESTIVAL_ACTIVE_SECRET_KEY_ID must be set together")
if keys_json and active_id:
    try:
        keys = json.loads(keys_json)
        valid_id = lambda key: isinstance(key, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", key)
        if not isinstance(keys, dict) or not keys or active_id not in keys:
            raise ValueError()
        for key_id, encoded in keys.items():
            if not valid_id(key_id) or not isinstance(encoded, str):
                raise ValueError()
            decoded = base64.b64decode(encoded, validate=True)
            if len(decoded) != 32 or base64.b64encode(decoded).decode() != encoded:
                raise ValueError()
    except (ValueError, TypeError, base64.binascii.Error):
        errors.append("FESTIVAL_SECRET_KEYS_JSON must map key IDs to canonical base64 32-byte keys and include the active ID")

origin = values.get("FESTIVAL_PUBLIC_ORIGIN", "").strip()
if origin:
    try:
        parsed = urlsplit(origin)
        valid_origin = (
            parsed.scheme == "https" and bool(parsed.hostname)
            and parsed.port is None and not parsed.username and not parsed.password
            and not parsed.path and not parsed.query and not parsed.fragment
        )
    except ValueError:
        valid_origin = False
    if not valid_origin:
        errors.append("FESTIVAL_PUBLIC_ORIGIN must be an HTTPS origin without port, path, query, or credentials")

if errors:
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    sys.exit(1)

print("cloud-setup/.env validation passed.")
PY
