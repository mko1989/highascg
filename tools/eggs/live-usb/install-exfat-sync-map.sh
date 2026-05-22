#!/usr/bin/env bash
# Install repo config/exfat-sync.json → /etc/highascg/exfat-sync.json (drop-config only; no sim/).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"
SRC="${REPO_ROOT}/config/exfat-sync.json"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}
[[ -f "$SRC" ]] || {
	echo "Missing $SRC" >&2
	exit 1
}

install -d /etc/highascg
if [[ -f /etc/highascg/exfat-sync.json ]]; then
	if cmp -s "$SRC" /etc/highascg/exfat-sync.json; then
		echo "OK: /etc/highascg/exfat-sync.json already matches repo (no sim-highascg)."
		exit 0
	fi
	cp -a /etc/highascg/exfat-sync.json "/etc/highascg/exfat-sync.json.bak.$(date -u +%Y%m%dT%H%M%SZ)"
	echo "Backed up previous map → /etc/highascg/exfat-sync.json.bak.*"
fi
install -m 0644 -o root -g root "$SRC" /etc/highascg/exfat-sync.json
echo "Installed $SRC → /etc/highascg/exfat-sync.json (drop-config only; sim/highascg not synced)"
