#!/usr/bin/env bash
# Write /etc/systemd/system/highascg.service with correct After=/Wants= for WO-47
# (home-casparcg-exfat.mount + optional media bind + exfat-sync) when those units exist.
#
# Usage:
#   sudo bash scripts/write-highascg-systemd-unit.sh [casparcg]
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

if [[ ! -f "${HIGHASCG_HOME}/package.json" ]]; then
	echo "Skipping: ${HIGHASCG_HOME}/package.json not found." >&2
	exit 1
fi

if [[ -f /etc/systemd/system/home-casparcg-exfat.mount ]] &&
	[[ -f /etc/systemd/system/highascg-exfat-sync.service ]]; then
	AF_LIST="network.target home-casparcg-exfat.mount highascg-exfat-sync.service"
	WA_LIST="home-casparcg-exfat.mount highascg-exfat-sync.service"
	if [[ -f /etc/systemd/system/home-casparcg-highascg-media-exfat.mount ]]; then
		AF_LIST="$AF_LIST home-casparcg-highascg-media-exfat.mount"
		WA_LIST="$WA_LIST home-casparcg-highascg-media-exfat.mount"
	fi
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
systemctl daemon-reload
systemctl enable highascg.service 2>/dev/null || true
echo "Wrote /etc/systemd/system/highascg.service (WO-47 deps if units present)."
