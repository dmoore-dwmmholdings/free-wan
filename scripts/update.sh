#!/usr/bin/env bash
# Update a running Free-WAN server to the latest GitHub release.
#
#   curl -fsSL https://raw.githubusercontent.com/dmoore-dwmmholdings/free-wan/main/scripts/update.sh | \
#     FW_HOST=https://free-wan.example.ts.net FW_PASS='...' bash
#
# Downloads the newest release package and POSTs it to /api/admin/updates, which validates it,
# backs up the current code and swaps it in. DATA_DIR and your media are never touched.
#
# Env:
#   FW_HOST  server base URL   (required, e.g. https://free-wan.tailnet.ts.net)
#   FW_USER  admin username    (default admin)
#   FW_PASS  admin password    (required)
#   FW_ZIP   apply this local zip instead of downloading

set -euo pipefail

REPO="${FW_REPO:-dmoore-dwmmholdings/free-wan}"
host="${FW_HOST:?set FW_HOST to your server URL}"
user="${FW_USER:-admin}"
pass="${FW_PASS:?set FW_PASS to the admin password}"
host="${host%/}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

if [ -n "${FW_ZIP:-}" ]; then
  zip="$FW_ZIP"
  [ -f "$zip" ] || { echo "No such file: $zip" >&2; exit 1; }
else
  echo "==> Finding the latest release of $REPO"
  # No -f here: GitHub answers 404 when a repo has no releases at all, which deserves a
  # clearer message than curl's exit code.
  api="$(curl -sSL -w '\n%{http_code}' "https://api.github.com/repos/$REPO/releases/latest")"
  status="${api##*$'\n'}"
  body="${api%$'\n'*}"
  if [ "$status" = "404" ]; then
    echo "$REPO has no releases yet — push a v* tag to publish one." >&2
    exit 1
  fi
  [ "$status" = "200" ] || { echo "GitHub API returned HTTP $status" >&2; exit 1; }
  asset="$(printf '%s' "$body" \
    | grep -o '"browser_download_url"[^,]*free-wan-[^"]*\.zip"' | cut -d'"' -f4 | head -1 || true)"
  [ -n "$asset" ] || { echo "Latest release has no free-wan-*.zip asset attached." >&2; exit 1; }
  echo "==> Downloading ${asset##*/}"
  zip="$work/package.zip"
  curl -fsSL -o "$zip" "$asset"
fi

# Escape the two characters that can break a JSON string literal, so passwords containing
# quotes or backslashes survive. Pattern and replacement are quoted so bash does not
# reprocess the backslashes. No node or jq needed on the server.
json_escape() {
  local s=$1 bs='\' q='"'
  s=${s//"$bs"/"$bs$bs"}
  s=${s//"$q"/"$bs$q"}
  printf '%s' "$s"
}

echo "==> Authenticating to $host"
payload="$(printf '{"username":"%s","password":"%s","client":"native"}' \
  "$(json_escape "$user")" "$(json_escape "$pass")")"

# client:"native" returns the token in the body, so there is no cookie jar to carry around.
login="$(curl -sS -X POST "$host/api/auth/login" \
  -H 'Content-Type: application/json' --data-binary "$payload" || true)"
token="$(printf '%s' "$login" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)"
[ -n "$token" ] || { echo "Login failed — check FW_USER/FW_PASS" >&2; exit 1; }

out="$work/response.json"
echo "==> Uploading $(du -h "$zip" | cut -f1)"
code="$(curl -sS -o "$out" -w '%{http_code}' -X POST "$host/api/admin/updates" \
  -H "Authorization: Bearer $token" \
  -F "package=@${zip};type=application/zip")"

cat "$out"; echo
[ "$code" = "202" ] || { echo "==> Update failed (HTTP $code)" >&2; exit 1; }

if grep -q '"restarting":true' "$out"; then
  echo "==> Applied; the server is restarting itself."
else
  echo "==> Applied, but the server is still running the old code until it restarts."
  echo "    Run: docker restart free-wan"
  echo "    Set FW_SUPERVISED=1 in the free-wan service to make restarts automatic."
fi
