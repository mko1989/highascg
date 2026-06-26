#!/usr/bin/env bash
# Write /etc/systemd/system/highascg.service with correct After=/Wants= for WO-47
# (home-casparcg-exfat.mount + optional media bind + exfat-sync) when those units exist.
#
# Usage:
#   sudo bash scripts/write-highascg-systemd-unit.sh [casparcg]
#
# WO-52: UI is served from dist-web/ on :4200 by default. Headless drop-in is opt-in:
#   HIGHASCG_INSTALL_HEADLESS=1 sudo bash scripts/write-highascg-systemd-unit.sh
#
# Does not restart the service — callers run systemctl restart if needed after daemon-reload.
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
GNAME="$(id -gn "$USER_CASPAR")"

HIGHASCG_HOME="/home/casparcg/highascg"

COND_LINE="ConditionPathExists=${HIGHASCG_HOME}/package.json"

if [[ ! -f "${HIGHASCG_HOME}/package.json" ]]; then
	echo "Note: ${HIGHASCG_HOME}/package.json not present yet — enabling highascg.service anyway (skipped at boot until synced)." >&2
fi

if [[ -f /etc/systemd/system/home-casparcg-exfat.mount ]] &&
	[[ -f /etc/systemd/system/highascg-exfat-sync.service ]]; then
	AF_LIST="network.target home-casparcg-exfat.mount"
	WA_LIST=""
	if [[ -f /etc/systemd/system/home-casparcg-highascg-media-exfat.mount ]]; then
		AF_LIST="$AF_LIST home-casparcg-highascg-media-exfat.mount"
	fi
	if [[ -f /etc/systemd/system/highascg-exfat-bootstrap.service ]]; then
		AF_LIST="$AF_LIST highascg-exfat-bootstrap.service"
		WA_LIST="$WA_LIST highascg-exfat-bootstrap.service"
	fi
	if [[ -f /etc/systemd/system/highascg-exfat-server-update.service ]]; then
		AF_LIST="$AF_LIST highascg-exfat-server-update.service"
		WA_LIST="${WA_LIST:+$WA_LIST }highascg-exfat-server-update.service"
	fi
	AF_LIST="$AF_LIST highascg-exfat-sync.service"
	WA_LIST="${WA_LIST:+$WA_LIST }highascg-exfat-sync.service"
	read -r -d '' HIGHASCG_UNIT_DEPS <<EUD || true
After=${AF_LIST}
Wants=${WA_LIST}
EUD
else
	HIGHASCG_UNIT_DEPS="After=network.target"
fi

install -d /etc/systemd/system
cat <<EOF > /etc/systemd/system/highascg.service
[Unit]
Description=HighAsCG Playout Control Server
${COND_LINE}
${HIGHASCG_UNIT_DEPS}

[Service]
Type=simple
User=${USER_CASPAR}
Group=${GNAME}
UMask=002
WorkingDirectory=${HIGHASCG_HOME}
ExecStart=/usr/bin/node ${HIGHASCG_HOME}/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 /etc/systemd/system/highascg.service

HEADLESS_DROPIN_DIR="/etc/systemd/system/highascg.service.d"
HEADLESS_DROPIN="${HEADLESS_DROPIN_DIR}/10-headless.conf"

if [[ "${HIGHASCG_INSTALL_HEADLESS:-0}" == "1" ]]; then
	install -d "$HEADLESS_DROPIN_DIR"
	cat <<'EOF' >"$HEADLESS_DROPIN"
[Service]
Environment=HIGHASCG_HEADLESS=true
EOF
	chmod 0644 "$HEADLESS_DROPIN"
	echo "Wrote ${HEADLESS_DROPIN} (API-only; HIGHASCG_INSTALL_HEADLESS=1)."
else
	rm -f "$HEADLESS_DROPIN"
	echo "Removed ${HEADLESS_DROPIN} if present (WO-52: serve dist-web/ on :4200)."
fi

systemctl daemon-reload
systemctl enable highascg.service 2>/dev/null || true
echo "Wrote /etc/systemd/system/highascg.service (WO-47 deps if units present)."
