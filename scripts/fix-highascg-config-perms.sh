#!/usr/bin/env bash
# HighAsCG writes config with an atomic temp file next to highascg.config.json (same directory must be writable).
# Run on the playout host if you see: EACCES: permission denied, open '.../highascg.config.json.tmp'
#
# Usage: sudo env HACG_USER=casparcg bash scripts/fix-highascg-config-perms.sh
#   or:  sudo bash scripts/fix-highascg-config-perms.sh /opt/highascg casparcg

set -euo pipefail
DIR="${1:-/opt/highascg}"
USER_NAME="${2:-${HACG_USER:-casparcg}}"

if [ ! -d "$DIR" ]; then
	echo "Error: not a directory: $DIR" >&2
	exit 1
fi
if [ "${EUID:-0}" -ne 0 ]; then
	echo "Run with sudo (need to chown $DIR)." >&2
	exit 1
fi

chown -R "$USER_NAME:$USER_NAME" "$DIR"
find "$DIR" -type d -exec chmod 775 {} \;
# group-writable is enough if service User= matches; tighten json if present
[ -f "$DIR/highascg.config.json" ] && chmod 664 "$DIR/highascg.config.json" 2>/dev/null || true

echo "OK: $DIR is owned by $USER_NAME. Ensure the HighAsCG process runs as that user (systemd User=, or same account you use for Caspar)."
