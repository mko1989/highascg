#!/usr/bin/env bash
# Optional: short power press = network reset; hold 3s = shutdown.
#
#   sudo bash scripts/setup/14-power-button-network-reset.sh
#
# Installs evtest, logind drop-in (ignore default power key), listener service.
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LISTEN_SRC="${REPO}/tools/runtime/highascg-power-button-listen.sh"
LISTEN_DST=/usr/local/lib/highascg/highascg-power-button-listen.sh
RESET_DST=/usr/local/lib/highascg/highascg-network-reset.sh
RESET_SRC="${REPO}/tools/runtime/highascg-network-reset.sh"
UNIT=/etc/systemd/system/highascg-power-button.service
LOGIND_DROP=/etc/systemd/logind.conf.d/99-highascg-power.conf

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends evtest

mkdir -p /usr/local/lib/highascg /etc/systemd/logind.conf.d
install -m 755 "$RESET_SRC" "$RESET_DST"
install -m 755 "$LISTEN_SRC" "$LISTEN_DST"

cat >"$LOGIND_DROP" <<'EOF'
# HighAsCG: custom power button (short=network reset, long=shutdown)
[Login]
HandlePowerKey=ignore
HandleSuspendKey=ignore
HandleHibernateKey=ignore
EOF

cat >"$UNIT" <<EOF
[Unit]
Description=HighAsCG power button (short=network reset, 3s=shutdown)
After=systemd-logind.service systemd-networkd.service NetworkManager.service
Wants=systemd-logind.service

[Service]
Type=simple
Environment=HIGHASCG_NETWORK_RESET_SCRIPT=${RESET_DST}
Environment=HIGHASCG_POWER_HOLD_SEC=3
ExecStart=${LISTEN_DST}
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable highascg-power-button.service
systemctl restart systemd-logind.service 2>/dev/null || true
systemctl restart highascg-power-button.service

echo "OK: power button handler enabled"
echo "     short press → ${RESET_DST}"
echo "     hold 3s     → systemctl poweroff"
echo "     status: systemctl status highascg-power-button.service"
