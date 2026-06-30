#!/usr/bin/env bash
# Install CasparCG scanner + server systemd units (WO-73 — headless playout lifecycle).
#
#   sudo bash scripts/setup/13-caspar-systemd-units.sh [casparcg]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

USER_CASPAR="${1:-casparcg}"
getent passwd "$USER_CASPAR" >/dev/null 2>&1 || {
	echo "Unknown user: $USER_CASPAR" >&2
	exit 1
}

REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"
SYSTEMD_SRC="${REPO_ROOT}/scripts/systemd"
RUNTIME_SRC="${REPO_ROOT}/tools/runtime"

log "CasparCG systemd units (scanner + server via run.sh)"

for unit in casparcg-scanner.service casparcg-server.service; do
	[[ -f "${SYSTEMD_SRC}/${unit}" ]] || {
		echo "Missing ${SYSTEMD_SRC}/${unit}" >&2
		exit 1
	}
done

# WO-47 ordering: Caspar after exFAT boot chain + X session (nodm) + scanner.
AF_LIST="network.target nodm.service casparcg-scanner.service"
if [[ -f /etc/systemd/system/highascg-exfat-sync.service ]]; then
	if [[ -f /etc/systemd/system/highascg-bridge-boot.service ]]; then
		AF_LIST="highascg-bridge-boot.service ${AF_LIST}"
	fi
	if [[ -f /etc/systemd/system/highascg-exfat-boot.service ]]; then
		AF_LIST="highascg-exfat-boot.service ${AF_LIST}"
	else
		AF_LIST="home-casparcg-exfat.mount ${AF_LIST}"
	fi
	AF_LIST="highascg-exfat-sync.service ${AF_LIST}"
fi
if [[ -f /etc/systemd/system/highascg-decklink-install.service ]]; then
	AF_LIST="highascg-decklink-install.service ${AF_LIST}"
fi

SERVER_UNIT="${SYSTEMD_SRC}/casparcg-server.service"
TMP_SERVER="$(mktemp)"
trap 'rm -f "$TMP_SERVER"' EXIT
awk -v af="$AF_LIST" '
/^\[Unit\]/ { print; print "After=" af; next }
/^After=network\.target nodm\.service casparcg-scanner\.service$/ { next }
/^After=network\.target casparcg-scanner\.service$/ { next }
{ print }
' "$SERVER_UNIT" >"$TMP_SERVER"

install -m 0644 "${SYSTEMD_SRC}/casparcg-scanner.service" /etc/systemd/system/casparcg-scanner.service
install -m 0644 "$TMP_SERVER" /etc/systemd/system/casparcg-server.service

install -d /usr/local/bin
install -m 0755 "${RUNTIME_SRC}/launch-calamares.sh" /usr/local/bin/launch-calamares.sh
install -m 0755 "${RUNTIME_SRC}/caspar-systemd-control.sh" /usr/local/bin/caspar-systemd-control.sh

mkdir -p /run/highascg
chown "${USER_CASPAR}:${USER_CASPAR}" /run/highascg 2>/dev/null || chmod 1777 /run/highascg 2>/dev/null || true

if [[ -x "${PLAYOUT}/run.sh" ]]; then
	chown "${USER_CASPAR}:${USER_CASPAR}" "${PLAYOUT}/run.sh" 2>/dev/null || true
else
	echo "  note: ${PLAYOUT}/run.sh missing — enable units after deploy"
fi

systemctl daemon-reload
if command -v casparcg-scanner >/dev/null 2>&1; then
	systemctl enable casparcg-scanner.service
	ok "enabled casparcg-scanner.service"
else
	echo "  note: casparcg-scanner not installed — unit enabled when binary present"
	systemctl enable casparcg-scanner.service 2>/dev/null || true
fi

if [[ -x "${PLAYOUT}/run.sh" ]]; then
	systemctl enable casparcg-server.service
	ok "enabled casparcg-server.service"
fi

if [[ -f "${SCRIPT_DIR}/09-openbox-autostart.sh" ]]; then
	OPENBOX_SKIP_NODM_RESTART=1 bash "${SCRIPT_DIR}/09-openbox-autostart.sh" || {
		echo "  note: Openbox autostart refresh failed" >&2
	}
fi

echo
echo "Next: sudo bash ${SCRIPT_DIR}/12-passwordless-sudo.sh ${USER_CASPAR}"
echo "Start: sudo systemctl start casparcg-scanner.service casparcg-server.service"
