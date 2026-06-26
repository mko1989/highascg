#!/usr/bin/env bash
# Bootstrap host .private/ and optional USB/bridge .private/ roots (WO-54 / machine secrets).
set -euo pipefail

USER_CASPAR="${1:-casparcg}"
REPO="${2:-/home/${USER_CASPAR}/highascg}"
USB_MOUNT="${3:-/home/casparcg/exfat}"
BRIDGE_MOUNT="${4:-/home/casparcg/bridge}"

if [[ "$(id -un)" != root ]]; then
	echo "Run: sudo bash $0 [user] [repo] [usb_mount] [bridge_mount]" >&2
	exit 1
fi

PRIVATE_HOST="${REPO}/.private"
install -d -m 0700 -o "$USER_CASPAR" -g "$USER_CASPAR" "$PRIVATE_HOST"

for vol in "$USB_MOUNT" "$BRIDGE_MOUNT"; do
	if [[ -d "$vol" ]]; then
		install -d -m 0700 -o "$USER_CASPAR" -g "$USER_CASPAR" "${vol}/.private"
	fi
done

README="${PRIVATE_HOST}/README.txt"
if [[ ! -f "$README" ]]; then
	cat >"$README" <<'EOF'
Per-machine private data (Tailscale hints, Syncthing device ID, replication pairing).
Synced to USB/bridge at .private/<machine-id>/ — not via configs/ or Syncthing repo folder.
exFAT is not encrypted; treat the stick as physical secret storage.
EOF
	chown "$USER_CASPAR:$USER_CASPAR" "$README"
	chmod 0600 "$README"
fi

cat <<EOF

Private volume roots ready:
  Host:    ${PRIVATE_HOST}
  USB:     ${USB_MOUNT}/.private/   (if mounted)
  Bridge:  ${BRIDGE_MOUNT}/.private/ (if mounted)

Boot sync: highascg-exfat-sync.service runs private sync after exfat pairs.
API: GET /api/system/private-sync

EOF
