#!/usr/bin/env bash
# Create operator folders on an exFAT volume or build-host stub ~/exfat.
# Usage:
#   sudo bash tools/eggs/live-usb/seed-exfat-operator-layout.sh [/home/casparcg/exfat]
set -euo pipefail

ROOT="${1:-/home/casparcg/exfat}"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"

mkdir -p \
	"${ROOT}/drop-update" \
	"${ROOT}/drop-update/applied" \
	"${ROOT}/drop-config" \
	"${ROOT}/media" \
	"${ROOT}/templates" \
	"${ROOT}/configs" \
	"${ROOT}/projects" \
	"${ROOT}/projects/_autosave" \
	"${ROOT}/projects/_autosave" \
	"${ROOT}/snapshots/rear-panels" \
	"${ROOT}/.private"

README_PRIVATE="${ROOT}/.private/README.txt"
if [[ ! -f "$README_PRIVATE" ]]; then
	mkdir -p "${ROOT}/.private"
	cat >"$README_PRIVATE" <<'EOF'
HighAsCG private volume root — per-machine subfolders are created at sync time.

  .private/<machine-id>/syncthing/   device ID, media folder manifest
  .private/<machine-id>/tailscale/   status snapshot (not tailscaled.state)
  .private/<machine-id>/replication/ pairing manifest (no peer token)

Not synced via configs/ or projects/. exFAT is not encrypted.
EOF
fi

README="${ROOT}/drop-update/README.txt"
cat >"$README" <<'EOF'
Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json, index.js, src/, dist-web/, tools/runtime/ at the top of this folder.

Live USB stick (retain mode):
  - On every boot, files are rsync'd into /home/casparcg/highascg/
  - LEAVE the drop here — do not move to applied/ manually
  - The stick is the durable copy; RAM/overlay does not keep ~/highascg across reboots
  - Optional history copies may appear under drop-update/applied/ (audit only)

Persistent install (consume mode):
  - After a successful apply the drop may move to drop-update/applied/<UTC>/
  - ~/highascg/ survives reboot on internal disk

Operator UI: http://<playout-ip>:4200/
EOF

if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	grp="$(id -gn "$USER_CASPAR")"
	chown -R "${USER_CASPAR}:${grp}" "${ROOT}" 2>/dev/null || true
fi

echo "OK: operator layout under ${ROOT} (drop-update, drop-config, media, …)"
