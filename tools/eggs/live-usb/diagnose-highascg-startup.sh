#!/usr/bin/env bash
# Print what is delaying highascg.service (WO-47 exFAT chain, boot blame, unit deps).
#
# Usage:
#   bash tools/eggs/live-usb/diagnose-highascg-startup.sh
#   sudo bash tools/eggs/live-usb/diagnose-highascg-startup.sh   # full journal + fix hints
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
HIGHASCG_ROOT="${HIGHASCG_ROOT:-/home/casparcg/highascg}"
SUDO=""
[[ "$(id -u)" -eq 0 ]] && SUDO="" || SUDO="sudo"

section() { echo; echo "=== $* ==="; }

section "highascg.service"
systemctl show highascg.service -p ActiveState,SubState,ActiveEnterTimestamp,ConditionResult 2>/dev/null || true
systemctl status highascg.service --no-pager 2>/dev/null | head -15 || true

section "HighAsCG runtime tree (${HIGHASCG_ROOT})"
for rel in index.js package.json node_modules/.package-lock.json dist-web/index.html; do
	if [[ -e "${HIGHASCG_ROOT}/${rel}" ]]; then
		echo "OK: ${rel}"
	else
		echo "MISSING: ${rel}"
	fi
done
if [[ ! -d "${HIGHASCG_ROOT}/node_modules" ]]; then
	echo "FAIL: node_modules/ missing — embed-server ISO should include production deps."
	echo "      WO-47 stick: copy highascg-server_*.tar.gz from exFAT drop-update/ first."
	echo "      Quick fix on dev checkout: cd ${HIGHASCG_ROOT} && npm ci --omit=dev --omit=optional"
fi
if [[ ! -f "${HIGHASCG_ROOT}/dist-web/index.html" ]]; then
	echo "FAIL: dist-web/ missing — operator UI will not load on :4200."
	echo "      Rebuild ISO with HIGHASCG_ISO_BUILD_WEB=1 or deploy dist-web via exFAT drop-update/."
fi

section "highascg journal (last boot errors)"
$SUDO journalctl -u highascg.service -b --no-pager -n 30 2>/dev/null || true

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
	if ! bash -n /usr/local/lib/highascg/highascg-exfat-boot.sh 2>/dev/null; then
		echo "FAIL: /usr/local/lib/highascg/highascg-exfat-boot.sh bash syntax error"
		echo "      Fix: sudo bash ${REPO_ROOT}/tools/runtime/patch-wo47-exfat-boot-scripts.sh"
	elif grep -q 'systemctl start --no-block' /usr/local/lib/highascg/highascg-exfat-boot.sh 2>/dev/null; then
		echo "OK: installed exfat-boot uses --no-block (no 180s deadlock)"
	else
		echo "WARN: /usr/local/lib/highascg/highascg-exfat-boot.sh still uses blocking systemctl start"
		echo "      Fix: sudo bash ${REPO_ROOT}/scripts/install-exfat-systemd-units.sh"
		echo "           sudo bash ${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh"
	fi
else
	echo "WARN: missing /usr/local/lib/highascg/highascg-exfat-boot.sh"
fi

section "Apply fix (root)"
echo "  sudo bash ${REPO_ROOT}/scripts/install-exfat-systemd-units.sh"
echo "  sudo bash ${REPO_ROOT}/scripts/write-highascg-systemd-unit.sh"
echo "  sudo systemctl reset-failed highascg-exfat-boot.service highascg-exfat-arrive.service"
echo "  sudo systemctl daemon-reload"
