#!/usr/bin/env bash
# Avoid spurious "Failed to start nvidia-persistenced" during boot when /dev/nvidia0
# appears a moment after the PCI driver unit fires.
#
# Usage: sudo bash scripts/install-nvidia-persistenced-boot-order.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

DROP=/etc/systemd/system/nvidia-persistenced.service.d
CONF="${DROP}/highascg-wait-for-nvidia-dev.conf"

mkdir -p "$DROP"
cat >"$CONF" <<'EOF'
[Unit]
After=dev-nvidia0.device
Wants=dev-nvidia0.device

[Service]
# Driver creates /dev/nvidia* slightly after the PCI bind unit; wait briefly.
ExecStartPre=/bin/sh -c 'i=0; while [ $i -lt 50 ] && [ ! -c /dev/nvidia0 ]; do i=$((i+1)); sleep 0.1; done; test -c /dev/nvidia0'
EOF

systemctl daemon-reload
echo "OK: ${CONF}"
echo "    Reboot once — nvidia-persistenced should start cleanly (no first-attempt failure)."
