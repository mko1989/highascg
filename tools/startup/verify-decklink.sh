#!/usr/bin/env bash
# DeckLink / Desktop Video status on live stick or playout host (read-only).
#
# WO-92: drivers are NOT in the ISO squashfs — install from exFAT decklink/*.deb at boot.
#
# Usage:
#   bash ~/highascg/tools/startup/verify-decklink.sh
#   bash ~/highascg/tools/startup/verify-decklink.sh --verbose
set -euo pipefail

VERBOSE=0
[[ "${1:-}" == "--verbose" || "${1:-}" == "-v" ]] && VERBOSE=1

FAIL=0
ok() { echo "OK: $*"; }
warn() { echo "WARN: $*"; }
bad() { echo "FAIL: $*"; FAIL=$((FAIL + 1)); }

EXFAT="${HIGHASCG_EXFAT_ROOT:-/home/casparcg/exfat}"
BRIDGE="${HIGHASCG_BRIDGE_ROOT:-/home/casparcg/bridge}"
INSTALL_SH=/usr/local/lib/highascg/decklink-install-from-exfat.sh
LOG=/var/log/highascg/decklink-install.log

echo "=== DeckLink / Desktop Video (WO-92) ==="
echo "  host: $(hostname)"
echo "  kernel: $(uname -r)"
echo "  time: $(date -Is)"

KREL="$(uname -r)"
if [[ -e "/lib/modules/${KREL}/build/Makefile" ]]; then
	ok "kernel headers for DKMS: /lib/modules/${KREL}/build"
elif dpkg-query -W -f='${Status}' "linux-headers-${KREL}" 2>/dev/null | grep -qE '(install|hold) ok'; then
	bad "linux-headers-${KREL} dpkg installed but /lib/modules/${KREL}/build missing — reinstall headers"
else
	bad "linux-headers-${KREL} missing — DeckLink DKMS will fail (apt install linux-headers-${KREL} build-essential dkms)"
fi

if lspci 2>/dev/null | grep -qi blackmagic; then
	ok "PCI Blackmagic/DeckLink device present"
	lspci 2>/dev/null | grep -i blackmagic | sed 's/^/    /' || true
	HW=1
else
	warn "no DeckLink PCI device — skip driver expectations unless testing install path"
	HW=0
fi

for dir in "${EXFAT}/decklink" "${BRIDGE}/decklink"; do
	if [[ -d "$dir" ]]; then
		debs="$(find "$dir" -maxdepth 1 -name 'desktopvideo_*_amd64.deb' 2>/dev/null | wc -l)"
		if [[ "$debs" -gt 0 ]]; then
			ok "vendor debs in ${dir} (${debs} desktopvideo_*.deb)"
			"$VERBOSE" && find "$dir" -maxdepth 1 -name 'desktopvideo*.deb' -printf '    %f\n' 2>/dev/null || \
				ls -1 "$dir"/desktopvideo*.deb 2>/dev/null | sed 's/^/    /' || true
		else
			warn "decklink/ exists but no desktopvideo_*_amd64.deb in ${dir}"
		fi
	else
		if [[ "$VERBOSE" -eq 1 ]]; then
			warn "no ${dir}"
		fi
	fi
done

if dpkg-query -W -f='${Status} ${Package} ${Version}\n' desktopvideo 2>/dev/null | grep -q 'install ok installed'; then
	ok "desktopvideo installed: $(dpkg-query -W -f='${Version}' desktopvideo 2>/dev/null)"
elif [[ "$HW" -eq 1 ]]; then
	bad "desktopvideo not installed but DeckLink hardware present — copy .deb to ${EXFAT}/decklink/ and reboot or run install service"
else
	warn "desktopvideo not installed (expected when no card or no vendor debs yet)"
fi

if dpkg-query -W -f='${Status}' desktopvideo-gui 2>/dev/null | grep -q 'install ok installed'; then
	ok "desktopvideo-gui installed (Setup GUI available)"
else
	warn "desktopvideo-gui not installed — Caspar decklink I/O may still work; Settings Setup button needs GUI package"
fi

if lsmod 2>/dev/null | grep -q blackmagic; then
	ok "kernel module loaded: $(lsmod | awk '/blackmagic/{print $1}' | tr '\n' ' ')"
elif [[ "$HW" -eq 1 ]] && dpkg-query -W desktopvideo &>/dev/null; then
	warn "blackmagic module not loaded — try: sudo modprobe blackmagic_io"
fi

if [[ -f /etc/systemd/system/highascg-decklink-install.service ]]; then
	if systemctl is-enabled highascg-decklink-install.service &>/dev/null; then
		ok "highascg-decklink-install.service enabled"
	else
		warn "highascg-decklink-install.service present but not enabled"
	fi
	st="$(systemctl is-active highascg-decklink-install.service 2>/dev/null || true)"
	echo "  service state: ${st:-unknown}"
else
	warn "highascg-decklink-install.service missing — re-run install-exfat-systemd-units.sh on build host"
fi

if [[ -x "$INSTALL_SH" ]]; then
	ok "install script present"
	echo "  dry-run: sudo ${INSTALL_SH} --dry-run"
else
	bad "missing ${INSTALL_SH}"
fi

if [[ -f "$LOG" ]]; then
	echo "  last log lines:"
	tail -n 5 "$LOG" 2>/dev/null | sed 's/^/    /' || true
fi

if command -v curl >/dev/null 2>&1; then
	echo "  API: curl -s http://127.0.0.1:4200/api/system/decklink | jq ."
fi

echo ""
if [[ "$FAIL" -gt 0 ]]; then
	echo "DeckLink verify FAILED (${FAIL} error(s))."
	exit 1
fi
echo "DeckLink verify complete."
exit 0
