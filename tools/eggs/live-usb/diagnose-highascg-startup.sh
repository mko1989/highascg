#!/usr/bin/env bash
# Print what is delaying highascg.service (WO-47 exFAT chain, boot blame, unit deps).
#
# Usage:
#   bash tools/eggs/live-usb/diagnose-highascg-startup.sh
#   sudo bash tools/eggs/live-usb/diagnose-highascg-startup.sh   # full journal + fix hints
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SUDO=""
[[ "$(id -u)" -eq 0 ]] && SUDO="" || SUDO="sudo"

section() { echo; echo "=== $* ==="; }

section "highascg.service"
systemctl show highascg.service -p ActiveState,SubState,ActiveEnterTimestamp,ConditionResult 2>/dev/null || true
systemctl status highascg.service --no-pager 2>/dev/null | head -15 || true

section "WO-47 exFAT units"
systemctl list-units 'highascg*' 'home-casparcg*' --all --no-pager 2>/dev/null || true

section "Failed / slow boot units (this boot)"
$SUDO journalctl -b -u highascg-exfat-boot.service -u highascg-exfat-sync.service \
	-u highascg-exfat-server-update.service -u highascg-pick-nvidia.service \
	--no-pager -n 25 2>/dev/null || true

if [[ -f /var/log/highascg-exfat-boot.log ]]; then
	section "highascg-exfat-boot.log (tail)"
	tail -15 /var/log/highascg-exfat-boot.log
fi

if command -v systemd-analyze >/dev/null 2>&1; then
	section "systemd-analyze blame (top 12)"
	systemd-analyze blame 2>/dev/null | head -12 || true
fi

section "highascg.service unit + drop-ins"
systemctl cat highascg.service 2>/dev/null | head -35 || true

if [[ -f /usr/local/lib/highascg/highascg-exfat-boot.sh ]]; then
	if grep -q 'systemctl start --no-block' /usr/local/lib/highascg/highascg-exfat-boot.sh 2>/dev/null; then
		echo "OK: installed exfat-boot uses --no-block (no 180s deadlock)"
	else
		echo "WARN: /usr/local/lib/highascg/highascg-exfat-boot.sh still uses blocking systemctl start"
		echo "      Fix: sudo bash ${ROOT}/scripts/install-exfat-systemd-units.sh"
		echo "           sudo bash ${ROOT}/scripts/write-highascg-systemd-unit.sh"
	fi
fi

section "Apply fix (root)"
echo "  sudo bash ${ROOT}/scripts/install-exfat-systemd-units.sh"
echo "  sudo bash ${ROOT}/scripts/write-highascg-systemd-unit.sh"
echo "  sudo systemctl reset-failed highascg-exfat-boot.service highascg-exfat-arrive.service"
echo "  sudo systemctl daemon-reload"
