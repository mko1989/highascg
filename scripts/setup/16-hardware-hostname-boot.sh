#!/usr/bin/env bash
# Install boot-time hostname migration: highascg-nvidia-* → highascg#### (WO-78).
#
#   sudo bash scripts/setup/16-hardware-hostname-boot.sh [casparcg]
#
# Runs before highascg.service via highascg-hardware-hostname.service (root, one-shot).
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

USER_CASPAR="${1:-casparcg}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}

PLAYOUT="$(cd "$(dirname "$0")/../.." && pwd)"
APPLY_SH_SRC="${PLAYOUT}/tools/runtime/highascg-apply-hardware-hostname.sh"
APPLY_SH_DST=/usr/local/lib/highascg/highascg-apply-hardware-hostname.sh
SVC_SRC="${PLAYOUT}/scripts/systemd/highascg-hardware-hostname.service"
SVC_DEST=/etc/systemd/system/highascg-hardware-hostname.service

[[ -f "$APPLY_SH_SRC" ]] || {
	echo "Missing ${APPLY_SH_SRC}" >&2
	exit 1
}
[[ -f "$SVC_SRC" ]] || {
	echo "Missing ${SVC_SRC}" >&2
	exit 1
}

install -d /usr/local/lib/highascg
install -m 0755 -o root -g root "$APPLY_SH_SRC" "$APPLY_SH_DST"
install -m 0644 -o root -g root "$SVC_SRC" "$SVC_DEST"

systemctl daemon-reload
systemctl enable highascg-hardware-hostname.service

echo "OK: ${SVC_DEST} (enabled)"
echo "     ${APPLY_SH_DST}"
echo
echo "Apply now (optional): sudo systemctl start highascg-hardware-hostname.service"
echo "Log: /var/log/highascg-hardware-hostname.log"
