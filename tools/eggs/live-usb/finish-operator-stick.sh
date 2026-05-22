#!/usr/bin/env bash
# Finish a HighAsCG USB after dd: persistence (fixed 2 GiB) then exFAT (rest of disk), seed layout.
#
# Usage:
#   sudo bash tools/eggs/live-usb/finish-operator-stick.sh [/dev/sdX] [--iso /path/to.iso]
#   sudo bash tools/eggs/live-usb/finish-operator-stick.sh --prune-stale [/dev/sdX] [--iso …]
#
# Layout on a 32 GiB stick (typical): ~5 GiB hybrid ISO · 2 GiB persistence · ~24 GiB exFAT.
# Order: persistence first (no HIGHASCGEXF automount), then exFAT fills the tail.
#
# Env (optional): PERSIST_SIZE_MIB (default 2048), EXFAT_AFTER_ISO_MARGIN_MIB (default 1536)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"
PRUNE=false
DEV=""
ISO=""

export PERSIST_SIZE_MIB="${PERSIST_SIZE_MIB:-2048}"
export EXFAT_FILL_DISK="${EXFAT_FILL_DISK:-1}"

usage() {
	echo "Usage: sudo $0 [--prune-stale] [/dev/sdX] [--iso PATH]" >&2
	echo "  --prune-stale  Remove partitions 2..N (leftover data slices after re-dd; keeps ESP if alone)" >&2
	echo "  --iso PATH     EXFAT_ISO_PATH / PERSIST_ISO_PATH for placement after hybrid ISO" >&2
	exit 1
}

[[ "$(id -u)" -eq 0 ]] || {
	echo "Must run as root (sudo)." >&2
	exit 1
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		-h | --help) usage ;;
		--prune-stale) PRUNE=true ;;
		--iso)
			ISO="${2:?}"
			shift
			;;
		/dev/*) DEV="$1" ;;
		*) echo "Unknown argument: $1" >&2; usage ;;
	esac
	shift
done

if [[ -z "$DEV" ]]; then
	CONF_PATH="${FLASH_ISO_CONF:-$HERE/flash-iso.conf}"
	if [[ -f "$CONF_PATH" ]]; then
		# shellcheck source=flash-iso-conf-lib.sh
		source "${HERE}/flash-iso-conf-lib.sh"
		DEV="$(flash_iso_read_device "$CONF_PATH")"
		echo "Using DEVICE from ${CONF_PATH} → ${DEV}" >&2
	fi
fi

[[ -n "$DEV" ]] || usage
[[ -b "$DEV" ]] || {
	echo "Not a block device: $DEV" >&2
	exit 1
}

UNMOUNT_SH="${HERE}/unmount-usb-for-partitioning.sh"
PRUNE_SH="${HERE}/prune-operator-data-partitions.sh"
PRUNE_HYBRID_SH="${HERE}/prune-hybrid-data-partitions.sh"
INSTALL_MAP="${HERE}/install-exfat-sync-map.sh"
UNMASK_SH="${HERE}/unmask-exfat-systemd.sh"

trap 'bash "$UNMASK_SH" 2>/dev/null || true' EXIT

bash "$INSTALL_MAP"
bash "$UNMOUNT_SH" "$DEV"

if "$PRUNE"; then
	PRUNE_ISO=()
	[[ -n "$ISO" ]] && PRUNE_ISO=(--iso "$ISO")
	bash "$PRUNE_HYBRID_SH" "$DEV" "${PRUNE_ISO[@]}"
	bash "$UNMOUNT_SH" "$DEV"
	bash "$PRUNE_SH" "$DEV"
	bash "$UNMOUNT_SH" "$DEV"
fi

if [[ -n "$ISO" ]]; then
	[[ -f "$ISO" ]] || {
		echo "ISO not found: $ISO" >&2
		exit 1
	}
	export EXFAT_ISO_PATH="$ISO"
	export PERSIST_ISO_PATH="$ISO"
	echo "==> ISO path for partition placement: $ISO"
fi

PERSIST_SH="${HERE}/add-union-persistence-partition.sh"
PRUNE_EXFAT_SH="${HERE}/prune-exfat-partition-only.sh"

has_persistence=0
while read -r _ lab; do
	[[ "$lab" == "persistence" ]] && has_persistence=1
done < <(lsblk -nrpo NAME,LABEL "$DEV" 2>/dev/null || true)
if [[ "$has_persistence" -eq 0 ]]; then
	echo "==> Union persistence (${PERSIST_SIZE_MIB} MiB, / union) — before exFAT"
	bash "$PERSIST_SH" "$DEV"
else
	echo "==> persistence partition already present — skipping mkpart"
fi

echo "==> Unmount + drop stale exFAT slice before creating full-size HIGHASCGEXF"
bash "$UNMOUNT_SH" "$DEV"
bash "$PRUNE_EXFAT_SH" "$DEV"
bash "$UNMOUNT_SH" "$DEV"

echo "==> exFAT data partition (HIGHASCGEXF) — fills disk after persistence"
bash "${HERE}/add-exfat-data-partition.sh" "$DEV"

MP=$(mktemp -d /tmp/highascg-exfat-seed.XXXXXX)
mount -L HIGHASCGEXF "$MP"
df -h "$MP"
bash "${HERE}/strip-legacy-exfat-sim.sh" "$MP"
bash "${HERE}/seed-exfat-operator-layout.sh" "$MP"
sync
umount "$MP"
rmdir "$MP"

echo
echo "Done. Verify:"
echo "  lsblk -f $DEV"
echo "  persistence ~${PERSIST_SIZE_MIB} MiB; exFAT should be most of the stick (e.g. ~20+ GiB on 32 GiB)"
echo "Boot GRUB → Live with persistence"
bash "$UNMASK_SH"
echo "Removed legacy sim/ sync: /etc/highascg/exfat-sync.json matches repo (drop-config only)."
