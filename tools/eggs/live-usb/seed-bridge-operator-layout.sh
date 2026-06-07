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
	"${ROOT}/drop-config"

README="${ROOT}/README.txt"
if [[ ! -f "$README" ]]; then
	cat >"$README" <<'EOF'
HighAsCG bridge partition (LABEL=HIGHASCGDAT)

  media/     Bridge media library (bind-mounted to ~/highascg/media/bridge on Linux)
  configs/   Modular settings + .highascg-state.json (synced with ~/highascg/config)
  drop-config/  Optional monolithic highascg.config.json overlay

Format: mkfs.exfat -L HIGHASCGDAT /dev/sdXN
EOF
fi

if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	grp="$(id -gn "$USER_CASPAR")"
	chown -R "${USER_CASPAR}:${grp}" "${ROOT}" 2>/dev/null || true
fi

echo "OK: bridge layout under ${ROOT} (media/, configs/, drop-config/)"
