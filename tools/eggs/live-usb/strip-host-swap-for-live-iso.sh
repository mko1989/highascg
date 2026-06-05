#!/usr/bin/env bash
# Keep swap off the HighAsCG live USB squashfs without permanently removing it from the build host.
#
#   prepare   — before eggs produce: drop /swap.img from fstab (backup), swapoff file (keep file)
#   restore   — after eggs produce: restore fstab, re-enable /swap.img if present
#   permanent — for lean imaging hosts: remove swap file + fstab line (see prepare-eggs-minimal.sh)
#
# Usage:
#   sudo bash tools/live-usb/strip-host-swap-for-live-iso.sh prepare
#   sudo bash tools/live-usb/strip-host-swap-for-live-iso.sh restore
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
	echo "Run as root: sudo bash $0 [prepare|restore|permanent]" >&2
	exit 1
fi

STATE_DIR=/var/lib/highascg/iso-swap-fstab-strip
FSTAB_BAK="${STATE_DIR}/fstab.bak"

remove_swap_fstab_lines() {
	[[ -f /etc/fstab ]] || return 0
	sed -i \
		-e '\|^[[:space:]]*/swap\.img[[:space:]]|d' \
		-e '\|^[[:space:]]*/swapfile[[:space:]]|d' \
		/etc/fstab
}

	cmd_prepare() {
	mkdir -p "$STATE_DIR"
	echo "==> Prepare host for live ISO (swap file stays on disk; omitted via exclude.list; tmpfs mounts are never cloned)"
	if [[ -f /swap.img ]]; then
		swapoff /swap.img 2>/dev/null || true
	fi
	if [[ -f /etc/fstab ]] && grep -qE '^[[:space:]]*/(swap\.img|swapfile)[[:space:]]' /etc/fstab; then
		if [[ ! -f "$FSTAB_BAK" ]]; then
			cp -a /etc/fstab "$FSTAB_BAK"
		fi
		remove_swap_fstab_lines
		echo "  fstab: removed file-swap entries until restore (backup: $FSTAB_BAK)"
	fi
}

cmd_restore() {
	echo "==> Restore build-host fstab / swap after ISO produce"
	if [[ -f "$FSTAB_BAK" ]]; then
		cp -a "$FSTAB_BAK" /etc/fstab
		rm -f "$FSTAB_BAK"
		echo "  restored /etc/fstab"
	fi
	if [[ -f /swap.img ]]; then
		swapon /swap.img 2>/dev/null && echo "  re-enabled /swap.img" || echo "  note: could not swapon /swap.img (check fstab)" >&2
	fi
	rmdir "$STATE_DIR" 2>/dev/null || true
}

cmd_permanent() {
	echo "==> Permanently remove file swap from this host (lean imaging / not for daily dev)"
	if [[ -f /swap.img ]]; then
		swapoff /swap.img 2>/dev/null || true
		rm -f /swap.img
		echo "  removed /swap.img"
	fi
	if [[ -f /etc/fstab ]] && grep -qE '^[[:space:]]*/(swap\.img|swapfile)[[:space:]]' /etc/fstab; then
		cp -a /etc/fstab /etc/fstab.bak.highascg-no-swap
		remove_swap_fstab_lines
		echo "  removed file-swap lines from /etc/fstab (backup: /etc/fstab.bak.highascg-no-swap)"
	fi
	for f in /swapfile /var/swap /var/swap.img; do
		if [[ -f "$f" ]]; then
			swapoff "$f" 2>/dev/null || true
			rm -f "$f"
			echo "  removed $f"
		fi
	done
}

case "${1:-prepare}" in
	prepare) cmd_prepare ;;
	restore) cmd_restore ;;
	permanent) cmd_permanent ;;
	-h | --help)
		echo "Usage: sudo $0 [prepare|restore|permanent]"
		exit 0
		;;
	*)
		echo "Unknown command: ${1:-}" >&2
		exit 1
		;;
esac
