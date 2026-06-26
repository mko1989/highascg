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
if [[ ! -f "$README" ]]; then
	cat >"$README" <<'EOF'
Drop server updates here (contents of highascg-server_*.tar.gz from GitHub releases).

Required: package.json at the top of this folder (along with index.js, src/, tools/runtime/, …).

On boot the live system will:
  - stop highascg.service
  - rsync this folder → /home/casparcg/highascg (client/ and dist-web/ are not touched)
  - run npm ci when package-lock.json is included
  - move this folder to drop-update/applied/<timestamp>/
  - start highascg.service

UI/simulation runs from the Electron launcher on Mac/Windows — not from this stick path.
EOF
fi

if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	grp="$(id -gn "$USER_CASPAR")"
	chown -R "${USER_CASPAR}:${grp}" "${ROOT}" 2>/dev/null || true
fi

echo "OK: operator layout under ${ROOT} (drop-update, drop-config, media, …)"
