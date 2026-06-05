#!/usr/bin/env bash
# Restore video after a host Plymouth preview blanked the screen (Xorg on tty7 / nodm).
#
# Usage: sudo bash tools/eggs/live-usb/recover-display-after-plymouth.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

echo "==> Stop Plymouth"
plymouth quit 2>/dev/null || true
plymouth --quit 2>/dev/null || true
killall plymouthd 2>/dev/null || true
sleep 0.5

echo "==> Switch to graphical VT (tty7)"
chvt 7 2>/dev/null || chvt 1 2>/dev/null || true

if systemctl is-active --quiet nodm; then
	echo "==> Restart nodm (automatic X session)"
	systemctl restart nodm
elif systemctl is-active --quiet gdm3; then
	systemctl restart gdm3
elif systemctl is-active --quiet sddm; then
	systemctl restart sddm
elif systemctl is-active --quiet lightdm; then
	systemctl restart lightdm
else
	echo "WARN: no nodm/gdm/sddm/lightdm — if still black, reboot or restart Xorg manually" >&2
fi

echo "OK: display recovery attempted (check monitor on tty7)"
