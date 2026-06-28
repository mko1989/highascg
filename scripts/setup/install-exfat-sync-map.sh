#!/usr/bin/env bash
# Install repo exfat-sync map (includes replication.json exclude) into /etc/highascg.
set -euo pipefail
[[ "$(id -u)" -eq 0 ]] || { echo "Run: sudo $0" >&2; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../.." && pwd)"
SRC="${REPO_ROOT}/config/exfat-sync.json"
DEST="/etc/highascg/exfat-sync.json"
install -d /etc/highascg
install -m 0644 "$SRC" "$DEST"
echo "OK: installed ${DEST}"
