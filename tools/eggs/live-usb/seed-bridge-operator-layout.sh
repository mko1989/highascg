#!/usr/bin/env bash
# Create bridge-disk folders on HIGHASCGDAT (media library + configs).
# Usage:
#   sudo bash tools/eggs/live-usb/seed-bridge-operator-layout.sh [/home/casparcg/bridge]
set -euo pipefail

ROOT="${1:-/home/casparcg/bridge}"
USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"

mkdir -p \
	"${ROOT}/media" \
	"${ROOT}/configs" \
	"${ROOT}/projects" \
	"${ROOT}/projects/_autosave" \
	"${ROOT}/drop-config" \
	"${ROOT}/decklink" \
	"${ROOT}/.private"

README="${ROOT}/README.txt"
if [[ ! -f "$README" ]]; then
	cat >"$README" <<'EOF'
HighAsCG bridge partition (LABEL=HIGHASCGDAT)

  media/     Bridge media library (bind-mounted to ~/highascg/media/bridge on Linux)
  configs/   Modular settings + .highascg-state.json (synced with ~/highascg/config)
  projects/  Show files (*.json) synced with ~/highascg/projects (bidirectional)
  drop-config/  Optional monolithic highascg.config.json overlay
  .private/     Per-machine Tailscale/Syncthing/replication secrets (not in configs/)

Format: mkfs.exfat -L HIGHASCGDAT /dev/sdXN
EOF
fi

README_DECKLINK="${ROOT}/decklink/README.txt"
mkdir -p "${ROOT}/decklink"
if [[ ! -f "$README_DECKLINK" ]]; then
	cat >"$README_DECKLINK" <<'EOF'
DeckLink Desktop Video — operator .deb files from Blackmagic tarball deb/x86_64/:

  desktopvideo_<version>_amd64.deb       required for Caspar decklink I/O
  desktopvideo-gui_<version>_amd64.deb    optional — Setup / Updater GUI only

Installed at boot when needed (skipped if already on system).
desktopvideo alone is enough when card firmware is current; without desktopvideo-gui
the Settings Desktop Video Setup button reports GUI not installed.
EOF
fi

if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	grp="$(id -gn "$USER_CASPAR")"
	chown -R "${USER_CASPAR}:${grp}" "${ROOT}" 2>/dev/null || true
fi

echo "OK: bridge layout under ${ROOT} (media/, configs/, drop-config/)"
