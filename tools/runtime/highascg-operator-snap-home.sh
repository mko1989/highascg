#!/usr/bin/env bash
# Fix root-owned ~/snap blocking snap Firefox for the playout operator user.
#
#   sudo /usr/local/lib/highascg/highascg-operator-snap-home.sh [/home/casparcg]
set -euo pipefail

USER_HOME="${1:-/home/casparcg}"
SNAP_DIR="${USER_HOME}/snap"

if [[ ! -d "$USER_HOME" ]]; then
	echo "home missing: $USER_HOME" >&2
	exit 1
fi

OWNER="$(stat -c '%U' "$USER_HOME")"
GROUP="$(stat -c '%G' "$USER_HOME")"

if [[ -d "$SNAP_DIR" ]]; then
	if [[ "$(stat -c '%U' "$SNAP_DIR")" != "$OWNER" ]]; then
		chown -R "${OWNER}:${GROUP}" "$SNAP_DIR"
	fi
else
	mkdir -p "$SNAP_DIR"
	chown "${OWNER}:${GROUP}" "$SNAP_DIR"
fi
