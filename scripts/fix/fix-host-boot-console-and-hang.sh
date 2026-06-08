#!/usr/bin/env bash
# Fix slow/hung boot on the eggs build / playout host:
#   - ~2 min stall: systemd-networkd-wait-online (partial online on unused NICs)
#   - hidden boot log: GRUB quiet splash
#   - systemd ordering cycle: highascg-exfat-boot ↔ highascg-bridge-boot
#
# Run once before more eggs work:
#   cd ~/highascg && sudo bash scripts/fix-host-boot-console-and-hang.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USER_CASPAR="${1:-casparcg}"
GRUB=/etc/default/grub
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { echo "==> $*"; }

backup_grub() {
	[[ -f "$GRUB" ]] || return 0
	cp -a "$GRUB" "${GRUB}.bak.${STAMP}"
}

set_grub_console_boot() {
	[[ -f "$GRUB" ]] || {
		echo "Missing $GRUB" >&2
		exit 1
	}
	backup_grub
	# Visible Ubuntu boot log on tty0; no Plymouth on this host.
	if grep -q '^GRUB_CMDLINE_LINUX_DEFAULT=' "$GRUB"; then
		sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT=.*/GRUB_CMDLINE_LINUX_DEFAULT="console=tty0 loglevel=7 nosplash noresume systemd.show_status=auto"/' \
			"$GRUB"
	else
		echo 'GRUB_CMDLINE_LINUX_DEFAULT="console=tty0 loglevel=7 nosplash noresume systemd.show_status=auto"' >>"$GRUB"
	fi
	# Brief menu so you can edit kernel line if needed (was hidden timeout 0).
	sed -i 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=menu/' "$GRUB" 2>/dev/null || true
	if grep -q '^GRUB_TIMEOUT=' "$GRUB"; then
		sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=3/' "$GRUB"
	else
		echo 'GRUB_TIMEOUT=3' >>"$GRUB"
	fi
	grep -q '^GRUB_TIMEOUT_STYLE=' "$GRUB" || echo 'GRUB_TIMEOUT_STYLE=menu' >>"$GRUB"
	log "GRUB: console boot (nosplash, loglevel=7), 3s menu"
	update-grub
}

mask_networkd_wait_online() {
	# NM already provides NetworkManager-wait-online; networkd wait blocks ~120s when
	# unused interfaces stay "partial" (eno1 down, wlp0s20f3 no carrier).
	log "Disable systemd-networkd-wait-online (2 min boot stall on this host)"
	systemctl disable systemd-networkd-wait-online.service 2>/dev/null || true
	systemctl mask systemd-networkd-wait-online.service
}

fix_console_issue_unit() {
	local unit=/etc/systemd/system/highascg-console-issue.service
	[[ -f "$unit" ]] || return 0
	if grep -q 'Wants=network-online.target' "$unit"; then
		cp -a "$unit" "${unit}.bak.${STAMP}"
		sed -i 's/Wants=network-online.target/Wants=network.target/' "$unit"
		sed -i 's/After=network-online.target/After=network.target NetworkManager.service/' "$unit"
		log "highascg-console-issue: no longer waits for network-online (2 min)"
	fi
}

log "Refresh WO-47/WO-52 units (fix bridge/exfat ordering cycle)"
bash "${REPO_ROOT}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"
bash "${REPO_ROOT}/scripts/fix-boot-emergency-recovery.sh" "$USER_CASPAR"

fix_console_issue_unit
mask_networkd_wait_online
if [[ -f /usr/lib/systemd/system/nvidia-persistenced.service ]]; then
	bash "${REPO_ROOT}/scripts/boot/install-nvidia-persistenced-boot-order.sh"
fi
set_grub_console_boot

systemctl daemon-reload
systemctl reset-failed systemd-networkd-wait-online.service highascg-bridge-boot.service 2>/dev/null || true

log "Done. Reboot to verify:"
echo "  - GRUB 3s menu, then scrolling kernel/systemd log (no Plymouth splash)"
echo "  - Boot should reach graphical.target in ~30–60s, not ~2+ min"
echo ""
echo "After reboot, check:"
echo "  systemd-analyze"
echo "  systemd-analyze blame | head -15"
echo "  journalctl -b -p err..alert --no-pager | head -40"
