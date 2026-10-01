#!/usr/bin/env bash
# Build the current source into an update package and push it to a running Free-WAN
# server over the tailnet. Nothing is cloned or copied onto the server by hand: the
# package goes to POST /api/admin/updates, which the server validates and applies.
#
#   FW_PASS='...' ./scripts/deploy-update.sh
#
# Env:
#   FW_HOST        server base URL   (default https://free-wan.tail1c8c4d.ts.net)
#   FW_USER        admin username    (default admin)
#   FW_PASS        admin password    (required)
#   FW_SKIP_BUILD  =1 to push the existing zip without rebuilding

set -euo pipefail

host="${FW_HOST:-https://free-wan.tail1c8c4d.ts.net}"
user="${FW_USER:-admin}"
pass="${FW_PASS:?set FW_PASS to the admin password}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="$(node -p "require('./package.json').version")"
zip="release/free-wan-${version}.zip"

if [ "${FW_SKIP_BUILD:-}" != "1" ]; then
  echo "==> Building ${version}"
  pnpm package
fi
[ -f "$zip" ] || { echo "No package at $zip — run without FW_SKIP_BUILD=1" >&2; exit 1; }

# Build the JSON with node so passwords containing quotes or backslashes survive, and
# pass the credentials by env so they never appear in the process list.
payload="$(FW_U="$user" FW_P="$pass" node -e \
  'process.stdout.write(JSON.stringify({username:process.env.FW_U,password:process.env.FW_P,client:"native"}))')"

echo "==> Authenticating to ${host}"
# client:"native" returns the session token in the body, so there is no cookie jar to keep.
token="$(curl -sS -X POST "$host/api/auth/login" \
  -H 'Content-Type: application/json' -d "$payload" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)"
[ -n "$token" ] || { echo "Login failed — check FW_USER/FW_PASS" >&2; exit 1; }

out="$(mktemp)"; trap 'rm -f "$out"' EXIT
echo "==> Uploading $(du -h "$zip" | cut -f1) to $host"
code="$(curl -sS -o "$out" -w '%{http_code}' -X POST "$host/api/admin/updates" \
  -H "Authorization: Bearer $token" \
  -F "package=@${zip};type=application/zip")"

cat "$out"; echo
[ "$code" = "202" ] || { echo "==> Update failed (HTTP $code)" >&2; exit 1; }

if grep -q '"restarting":true' "$out"; then
  echo "==> Applied; the server is restarting itself."
else
  echo "==> Applied, but the server did NOT restart, so it is still running the old code."
  echo "    The new files are staged on disk. Restart the container to load them:"
  echo "      docker restart free-wan"
  echo "    To make this automatic, add FW_SUPERVISED=1 to the free-wan service environment."
fi
