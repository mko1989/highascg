#!/usr/bin/env bash
# Shorter boot: avoid multi-minute waits on network-online and unused NICs.
#
#   sudo bash scripts/boot/install-fast-boot-network.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

NM_CONF=/etc/NetworkManager/conf.d/99-highascg-fast-boot.conf

log() { echo "==> $*"; }

log "Mask systemd-networkd-wait-online (often ~120s on laptops with down NICs)"
systemctl disable systemd-networkd-wait-online.service 2>/dev/null || true
systemctl mask systemd-networkd-wait-online.service 2>/dev/null || true

log "Cap NetworkManager wait-online at 15s (HighAsCG uses network.target, not network-online)"
install -d /etc/NetworkManager/conf.d
cat >"$NM_CONF" <<'EOF'
# HighAsCG playout — do not block boot minutes for DHCP on unused interfaces.
[connection]
wait-online-timeout=15
EOF
chmod 0644 "$NM_CONF"

if systemctl is-enabled NetworkManager-wait-online.service &>/dev/null; then
	log "NetworkManager-wait-online stays enabled (15s cap via ${NM_CONF})"
else
	log "NetworkManager-wait-online not enabled — OK"
fi

CONSOLE_UNIT=/etc/systemd/system/highascg-console-issue.service
if [[ -f "$CONSOLE_UNIT" ]] && grep -q 'network-online.target' "$CONSOLE_UNIT"; then
	sed -i 's/Wants=network-online.target/Wants=network.target/' "$CONSOLE_UNIT"
	sed -i 's/After=network-online.target/After=network.target NetworkManager.service/' "$CONSOLE_UNIT"
	log "Patched ${CONSOLE_UNIT} — no network-online wait"
fi

systemctl daemon-reload 2>/dev/null || true
systemctl reset-failed systemd-networkd-wait-online.service 2>/dev/null || true

echo "OK: fast-boot network (reboot and run: systemd-analyze blame | head -15)"
