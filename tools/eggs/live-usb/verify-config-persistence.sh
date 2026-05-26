#!/usr/bin/env bash
# Quick checks: union persistence + exFAT config sync (operator stick / live USB).
#
# Usage:
#   bash tools/eggs/live-usb/verify-config-persistence.sh
#   sudo bash tools/eggs/live-usb/verify-config-persistence.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
EXFAT="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
CFG="${HIGHASCG_ROOT:-/home/casparcg/highascg}/config"
ok() { echo "OK: $*"; }
warn() { echo "WARN: $*" >&2; }
bad() { echo "FAIL: $*" >&2; FAIL=1; }

FAIL=0

echo "=== Kernel / overlay (union persistence) ==="
if grep -q ' persistence' /proc/cmdline 2>/dev/null; then
	ok "cmdline has persistence ($(grep -o 'persistence' /proc/cmdline | wc -l)x)"
else
	bad "cmdline missing persistence — boot default GRUB entry or add persistence partition"
fi
if findmnt -n /overlay 2>/dev/null | grep -q .; then
	ok "overlay mounted"
elif grep -q overlay /proc/mounts 2>/dev/null; then
	ok "overlay in /proc/mounts"
else
	warn "no overlay mount (normal on build host; required on live USB with union persist)"
fi
if blkid -L persistence &>/dev/null; then
	ok "block device LABEL=persistence present"
else
	warn "no LABEL=persistence (dd + finish-operator-stick.sh adds it)"
fi

echo
echo "=== exFAT operator config (HIGHASCGEXF) ==="
if mountpoint -q "$EXFAT" 2>/dev/null; then
	ok "exFAT mounted at $EXFAT"
else
	warn "exFAT not mounted at $EXFAT — config will not survive reboot on stick"
fi
if [[ -f /etc/highascg/exfat-sync.json ]]; then
	ok "/etc/highascg/exfat-sync.json installed"
else
	bad "missing /etc/highascg/exfat-sync.json — run install-exfat-sync-map.sh"
fi
if grep -q bootPrefer /etc/highascg/exfat-sync.json 2>/dev/null || grep -q bootPrefer "${ROOT}/config/exfat-sync.json"; then
	ok "exfat-sync map has bootPrefer (exFAT wins on boot)"
else
	bad "exfat-sync map missing bootPrefer — update config/exfat-sync.json"
fi
if [[ -d "${EXFAT}/configs" ]] && compgen -G "${EXFAT}/configs/*.json" >/dev/null 2>&1; then
	ok "exFAT configs/ has JSON ($(ls -1 "${EXFAT}/configs"/*.json 2>/dev/null | wc -l) files)"
else
	warn "exFAT configs/ empty — save settings once while stick is mounted, then reboot test"
fi
if [[ -f "${CFG}/general.json" ]]; then
	ok "project config present (${CFG}/general.json)"
else
	warn "no ${CFG}/general.json on project tree"
fi

echo
echo "=== systemd boot order ==="
if systemctl cat highascg-exfat-sync.service 2>/dev/null | grep -q '\-\-boot'; then
	ok "highascg-exfat-sync runs with --boot"
else
	bad "highascg-exfat-sync.service missing --boot flag — reinstall units"
fi
if systemctl show highascg.service -p After --value 2>/dev/null | grep -q highascg-exfat-sync; then
	ok "highascg.service After= includes exfat-sync"
else
	bad "highascg.service does not wait for exfat-sync — run write-highascg-systemd-unit.sh"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then
	echo "Persistence checks passed (warnings are OK on imaging host without stick)."
	exit 0
fi
echo "Fix failures, then: sudo bash ${ROOT}/scripts/install-exfat-systemd-units.sh"
echo "                  sudo bash ${ROOT}/scripts/write-highascg-systemd-unit.sh"
echo "                  sudo bash ${ROOT}/tools/eggs/live-usb/install-exfat-sync-map.sh"
exit 1
