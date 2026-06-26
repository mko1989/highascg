#!/usr/bin/env bash
# USB media ingest (WO-29): udisks2 + polkit for headless mount from Web UI.
#
#   sudo bash scripts/setup/13-usb-ingest.sh [casparcg]
#
# See docs/USB_AUTO_MOUNT_UBUNTU.md
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

USER_CASPAR="${1:-${USER_CASPAR:-casparcg}}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}

log "udisks2 + policykit"
DEBIAN_FRONTEND=noninteractive apt-get install -y udisks2 policykit-1

log "plugdev group for $USER_CASPAR"
usermod -aG plugdev "$USER_CASPAR" 2>/dev/null || true

POLKIT_DIR=/etc/polkit-1/rules.d
mkdir -p "$POLKIT_DIR"
for src in 50-highascg-udisks.rules 51-highascg-udisks-casparcg-headless.rules; do
	if [[ -f "${SCRIPT_DIR}/../polkit/${src}" ]]; then
		install -m 0644 -o root -g root "${SCRIPT_DIR}/../polkit/${src}" "${POLKIT_DIR}/${src}"
		if [[ "$src" == *headless* ]]; then
			sed -i "s/casparcg/${USER_CASPAR}/g" "${POLKIT_DIR}/${src}"
		fi
		ok "polkit ${src}"
	fi
done

loginctl enable-linger "$USER_CASPAR" 2>/dev/null || true

systemctl enable udisks2 2>/dev/null || true
systemctl start udisks2 2>/dev/null || true
systemctl try-restart polkit.service 2>/dev/null || systemctl try-restart polkit 2>/dev/null || true

if [[ -r "${POLKIT_DIR}/51-highascg-udisks-casparcg-headless.rules" ]]; then
	ok "polkit rules installed"
else
	echo "WARN: polkit rules missing in ${POLKIT_DIR}" >&2
fi

echo
echo "Re-install polkit rules (required after rule updates), then verify:"
echo "  sudo bash ${SCRIPT_DIR}/13-usb-ingest.sh ${USER_CASPAR}"
echo "  sudo systemctl restart polkit highascg"
echo "  udisksctl mount -b /dev/sdX1 --no-user-interaction"
