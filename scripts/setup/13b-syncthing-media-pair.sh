#!/usr/bin/env bash
# WO-54: Syncthing folder for playout media only (separate from dev repo sync in 12b-syncthing-highascg.sh).
set -euo pipefail

USER_CASPAR="${1:-casparcg}"
MEDIA_PATH="${2:-/home/${USER_CASPAR}/highascg/media}"
FOLDER_ID="${3:-highascg-media}"

if [[ "$(id -un)" != root ]]; then
	echo "Run: sudo bash $0 [user] [media_path] [folder_id]" >&2
	exit 1
fi

if ! command -v syncthing >/dev/null 2>&1; then
	echo "Syncthing not installed — run scripts/setup/12b-syncthing-highascg.sh first" >&2
	exit 1
fi

mkdir -p "$MEDIA_PATH"
chown -R "${USER_CASPAR}:${USER_CASPAR}" "$MEDIA_PATH"

PRIMARY_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
DEVICE_ID="$(sudo -u "$USER_CASPAR" syncthing --device-id 2>/dev/null | tail -1 || true)"

cat <<EOF

HighAsCG media Syncthing folder (pair manually or via launcher):

  Folder ID:   ${FOLDER_ID}
  Path:        ${MEDIA_PATH}
  GUI:         http://${PRIMARY_IP:-127.0.0.1}:8384/
  Device ID:   ${DEVICE_ID:-run: sudo -u ${USER_CASPAR} syncthing --device-id}

On each playout box:
  1. Add the other box as a remote device (Actions → Show ID on peer).
  2. Add folder "${FOLDER_ID}" → path above → Send & Receive (or Send Only from leader).
  3. Bridge reports sync via GET /api/replication/media-status

Firewall: TCP 22000 (sync), UDP 21027 (discovery), 8384 (GUI, LAN only).

EOF
