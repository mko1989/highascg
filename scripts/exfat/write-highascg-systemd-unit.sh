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

COND_LINE="ConditionPathExists=${HIGHASCG_HOME}/package.json"

if [[ ! -f "${HIGHASCG_HOME}/package.json" ]]; then
	echo "Note: ${HIGHASCG_HOME}/package.json not present yet — enabling highascg.service anyway (skipped at boot until synced)." >&2
fi

if [[ -f /etc/systemd/system/highascg-exfat-sync.service ]]; then
	# Boot order: exfat-sync has Before=highascg.service and is WantedBy=multi-user.target.
	# Do NOT Wants/After mount or server-update units here — on `systemctl restart highascg`
	# that pulled HIGHASCGEXF device wait (~90s) when the USB stick is absent.
	HIGHASCG_UNIT_DEPS="After=network.target"
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
TimeoutStopSec=15
KillMode=mixed
KillSignal=SIGTERM
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

chmod 0644 /etc/systemd/system/highascg.service

# API-only on playout — UI hosted by Electron launcher (see docs/PLAN_SERVER_CLIENT_SPLIT.md)
HEADLESS_DROPIN_DIR="/etc/systemd/system/highascg.service.d"
HEADLESS_DROPIN="${HEADLESS_DROPIN_DIR}/10-headless.conf"
install -d "$HEADLESS_DROPIN_DIR"
cat <<'EOF' >"$HEADLESS_DROPIN"
[Service]
Environment=HIGHASCG_HEADLESS=true
# No startup HTML/CEF template on playout (avoids visible Chromium window on :0).
Environment=HIGHASCG_NO_STARTUP_LED_TEST=1
EOF
chmod 0644 "$HEADLESS_DROPIN"

# Single-driver ISO: no first-boot NVIDIA picker gate
rm -f /etc/systemd/system/highascg.service.d/10-wait-for-nvidia.conf 2>/dev/null || true

systemctl daemon-reload
systemctl enable highascg.service 2>/dev/null || true
echo "Wrote /etc/systemd/system/highascg.service (WO-47 deps if units present)."
echo "Wrote ${HEADLESS_DROPIN} (API-only; no dist-web on playout)."
