#!/usr/bin/env bash
# Build and test FreeWANKit on Linux (Docker), and syntax-check the SwiftUI app sources, which
# need Apple SDKs to type-check. Works from Git Bash on Windows.
set -euo pipefail

ios="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${SWIFT_IMAGE:-swift:6.2}"
# Git Bash rewrites /paths in arguments; Docker needs the Windows form of the mount source.
src="$(cd "$ios" && (pwd -W 2>/dev/null || pwd))"

export MSYS_NO_PATHCONV=1
# Build output lives in a Docker volume: building into the Windows mount fails on file renames.
docker run --rm -v "$src:/ios" -v freewan-kit-build:/build -w /ios/FreeWANKit "$image" bash -c '
  set -eo pipefail
  swift test --scratch-path /build 2>&1 | grep -v "started\.$" | tail -40
  echo "==> Parsing App/*.swift"
  find /ios/App -name "*.swift" -print0 | xargs -0 swiftc -parse
  echo "==> App sources parse"
'
