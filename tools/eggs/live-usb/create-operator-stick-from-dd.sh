#!/usr/bin/env bash
# Full production USB stick: dd ISO → exFAT (HIGHASCGEXF, slot 3) → seed layout.
# No union persistence partition (exFAT-only).
#
# Usage:
#   sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX
#   sudo bash tools/eggs/live-usb/create-operator-stick-from-dd.sh /dev/sdX --iso /path/to.iso
#
# Destructive: overwrites the whole disk. Double-check DEVICE.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"
DEV=""
ISO=""
ASSUME_YES=false

usage() {
	echo "Usage: sudo $0 /dev/sdX [--iso /path/to.iso] [-y]" >&2
	echo "  Layout (32 GiB typical): hybrid ISO ~5 GiB · exFAT remainder on MBR slot 3." >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0 /dev/sdX" >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage ;;
		-y | --yes) ASSUME_YES=true ;;
		--iso)
			ISO="${2:?}"
			shift
			;;
		/dev/*) DEV="$1" ;;
		*) echo "Unknown: $1" >&2; usage ;;
	esac
	shift
done

[[ -n "$DEV" ]] || usage
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}
typ=$(lsblk -ndo TYPE "$DEV" 2>/dev/null || true)
[[ "$typ" == disk ]] || {
	echo "Refusing $DEV (TYPE=$typ) — use whole disk e.g. /dev/sda" >&2
	exit 1
}

if [[ -z "$ISO" ]]; then
	# shellcheck source=flash-stick-common.sh
	source "${HERE}/flash-stick-common.sh"
	ISO="$(find_latest_iso)" || {
		echo "No ISO under /home/eggs/ — pass --iso" >&2
		exit 1
	}
fi
[[ -f "$ISO" ]] || {
	echo "ISO not found: $ISO" >&2
	exit 1
}
iso_mib="$(du -m "$ISO" | awk '{print $1}')"
if [[ "$iso_mib" -lt 1500 ]]; then
	echo "ERROR: ISO is only ${iso_mib} MiB — expected ~2400–3500 MiB (lean excludes, no nvidia-pool)." >&2
	echo "       A truncated squashfs cannot boot. Run full build:" >&2
	echo "       sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh" >&2
	exit 1
fi

USER_CASPAR="${HIGHASCG_SERVICE_USER:-casparcg}"
if getent passwd "$USER_CASPAR" >/dev/null 2>&1; then
	grp="$(id -gn "$USER_CASPAR")"
	mkdir -p /home/casparcg/exfat "/home/casparcg/highascg/media/exfat"
	chown "${USER_CASPAR}:${grp}" /home/casparcg/exfat /home/casparcg/highascg/media/exfat
fi

ISO_BYTES="$(stat -c%s "$ISO")"
ISO_HUMAN="$(numfmt --to=iec-i --suffix=B "$ISO_BYTES" 2>/dev/null || echo "${ISO_BYTES} bytes")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DEVICE: $DEV  ($(lsblk -dno SIZE,MODEL "$DEV" 2>/dev/null || true))"
echo "ISO:    $ISO  ($ISO_HUMAN)"
echo "This ERASES all data on $DEV."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$ASSUME_YES" != true ]]; then
	read -r -p "Type YES to continue: " ok
	[[ "$ok" == "YES" ]] || {
		echo "Aborted."
		exit 1
	}
else
	echo "(-y) Skipping interactive confirmation."
fi

echo "==> 1/3 Unmount and flash ISO (dd)"
bash "${HERE}/unmount-usb-for-partitioning.sh" "$DEV" 2>/dev/null || true
umount "${DEV}"?* 2>/dev/null || true
# Build host often mounts stick exFAT at ~/exfat — blocks partition/format.
for mp in /home/casparcg/exfat /home/casparcg/highascg/media/exfat; do
	if findmnt -n -o SOURCE "$mp" 2>/dev/null | grep -q "^${DEV}"; then
		echo "Unmounting ${mp} (was on ${DEV})"
		umount "$mp" 2>/dev/null || true
	fi
done

if command -v fuser >/dev/null 2>&1 && fuser -s "$DEV" 2>/dev/null; then
	echo "ERROR: ${DEV} is already in use (another dd or mount?):" >&2
	fuser -v "$DEV" >&2 || true
	echo "Wait for the other write to finish, or reboot if a prior dd is stuck." >&2
	exit 1
fi

echo "Syncing filesystem buffers before write (can take a minute)…" >&2
sync
echo "Writing ISO to ${DEV} (~5–15 min)…" >&2
# conv=fsync syncs every 4M block — often hangs for minutes on USB; one sync after dd is enough.
if command -v pv >/dev/null 2>&1; then
	pv -ptebar -s "$ISO_BYTES" "$ISO" | dd of="$DEV" bs=4M status=progress
else
	dd if="$ISO" of="$DEV" bs=4M iflag=fullblock status=progress
fi
echo "Flushing to stick…" >&2
sync
echo "ISO write complete."
partprobe "$DEV"
sleep 2
lsblk -f "$DEV"

echo "==> 2/4 exFAT + operator layout (finish-operator-stick, no persistence)"
export HIGHASCG_EXFAT_ONLY=1
export EXFAT_FILL_DISK=1
bash "${HERE}/install-exfat-sync-map.sh"
bash "${HERE}/finish-operator-stick.sh" "$DEV" --iso "$ISO" --prune-stale

echo "==> 3/4 Push running config → fresh HIGHASCGEXF (configs/, state JSON)"
bash "${HERE}/seed-stick-config-from-host.sh" "$DEV"

echo "==> 4/4 Verify boot layout"
bash "${HERE}/usb-restore-esp-flags.sh" "$DEV"
bash "${HERE}/verify-operator-stick-branding.sh" "$DEV" "$ISO"
if ! "$PARTED" -s "$DEV" unit MiB print 2>/dev/null | grep -qi esp; then
	echo "WARNING: no ESP flag in partition table — stick may not boot. Re-dd and rerun." >&2
fi
lsblk -f "$DEV"
echo "Expected: ESP on slot 2, exFAT HIGHASCGEXF on slot 3 (sda3) — no persistence partition."
echo "Boot GRUB → Live (config/state on exFAT only)"
echo "Operator data on LABEL=HIGHASCGEXF (drop-update/, configs/, media/, …)"
