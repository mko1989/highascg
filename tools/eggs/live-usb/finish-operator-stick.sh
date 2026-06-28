#!/usr/bin/env bash
# Finish a HighAsCG USB after dd: exFAT only (HIGHASCGEXF fills tail) + seed layout.
# No union persistence partition (WO_remove-persistence-partition-workflow_exfat-only).
#
# Usage:
#   sudo bash tools/eggs/live-usb/finish-operator-stick.sh [/dev/sdX] [--iso /path/to.iso]
#   sudo bash tools/eggs/live-usb/finish-operator-stick.sh --prune-stale [/dev/sdX] [--iso …]
#
# Layout on a 32 GiB stick (typical): ~5 GiB hybrid ISO · ~24 GiB exFAT (slot 3).
#
# Env: EXFAT_AFTER_ISO_MARGIN_MIB (default 1536), HIGHASCG_LEGACY_UNION_PERSIST=1 for old layout
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=usb-env.sh
source "${HERE}/usb-env.sh"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"
PRUNE=false
DEV=""
ISO=""

export HIGHASCG_EXFAT_ONLY="${HIGHASCG_EXFAT_ONLY:-1}"
export EXFAT_FILL_DISK="${EXFAT_FILL_DISK:-1}"

usage() {
	echo "Usage: sudo $0 [--prune-stale] [/dev/sdX] [--iso PATH]" >&2
	echo "  --prune-stale  Also run hybrid prune before operator prune (re-dd sticks)" >&2
	echo "  --iso PATH     EXFAT_ISO_PATH for placement after hybrid ISO" >&2
	echo "  Legacy union persistence: HIGHASCG_LEGACY_UNION_PERSIST=1 PERSIST_SIZE_MIB=4096" >&2
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
	CONF_PATH="${FLASH_ISO_CONF:-$HERE/legacy-persistence/flash-iso.conf}"
	if [[ -f "$CONF_PATH" ]]; then
		# shellcheck source=legacy-persistence/flash-iso-conf-lib.sh
		source "${HERE}/legacy-persistence/flash-iso-conf-lib.sh"
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
PRUNE_HYBRID_SH="${HERE}/legacy-persistence/prune-hybrid-data-partitions.sh"
INSTALL_MAP="${HERE}/install-exfat-sync-map.sh"
UNMASK_SH="${HERE}/unmask-exfat-systemd.sh"
PERSIST_SH="${HERE}/legacy-persistence/add-union-persistence-partition.sh"
PRUNE_EXFAT_SH="${HERE}/prune-exfat-partition-only.sh"

trap 'bash "$UNMASK_SH" 2>/dev/null || true' EXIT

bash "$INSTALL_MAP"
bash "$UNMOUNT_SH" "$DEV"

if "$PRUNE"; then
	PRUNE_ISO=()
	[[ -n "$ISO" ]] && PRUNE_ISO=(--iso "$ISO")
	bash "$PRUNE_HYBRID_SH" "$DEV" "${PRUNE_ISO[@]}"
	bash "$UNMOUNT_SH" "$DEV"
fi

if [[ -n "$ISO" ]]; then
	[[ -f "$ISO" ]] || {
		echo "ISO not found: $ISO" >&2
		exit 1
	}
	export EXFAT_ISO_PATH="$ISO"
	echo "==> ISO path for partition placement: $ISO"
fi

if [[ "${HIGHASCG_LEGACY_UNION_PERSIST:-0}" == "1" ]]; then
	export PERSIST_SIZE_MIB="${PERSIST_SIZE_MIB:-4096}"
	export PERSIST_ISO_PATH="${ISO:-}"
	has_persistence=0
	while read -r _ lab; do
		[[ "$lab" == "persistence" ]] && has_persistence=1
	done < <(timeout 8 lsblk -nrpo NAME,LABEL "$DEV" 2>/dev/null || true)
	if [[ "$has_persistence" -eq 0 ]]; then
		echo "==> LEGACY: union persistence (${PERSIST_SIZE_MIB} MiB) — before exFAT"
		export HIGHASCG_EXFAT_ONLY=0
		bash "$PERSIST_SH" "$DEV"
	else
		echo "==> persistence partition already present — skipping mkpart"
	fi
else
	echo "==> exFAT-only stick (no union persistence partition)"
	export HIGHASCG_EXFAT_ONLY=1
fi

echo "==> Remove stale operator slices (persistence + exFAT) before recreating HIGHASCGEXF"
bash "$UNMOUNT_SH" "$DEV"
bash "$PRUNE_SH" "$DEV"
bash "$UNMOUNT_SH" "$DEV"
bash "$PRUNE_EXFAT_SH" "$DEV" 2>/dev/null || true
bash "$UNMOUNT_SH" "$DEV"

read -r _PERSIST_NUM EXFAT_NUM < <(python3 "${HERE}/usb-partition-slots.py" "$DEV")
echo "==> exFAT data partition (HIGHASCGEXF) — MBR slot ${EXFAT_NUM}, fills disk after ISO"
bash "${HERE}/add-exfat-data-partition.sh" "$DEV"

MP=$(mktemp -d /tmp/highascg-exfat-seed.XXXXXX)
usb_mount_label_safe HIGHASCGEXF "$MP"
df -h "$MP"
bash "${HERE}/strip-legacy-exfat-sim.sh" "$MP"
bash "${HERE}/seed-exfat-operator-layout.sh" "$MP"
sync
umount "$MP"
rmdir "$MP"

echo
echo "Done. Verify:"
echo "  lsblk -f $DEV   (or re-run flash script — lsblk may hang on USB; use blkid ${DEV}*)"
echo "  exFAT (HIGHASCGEXF) on MBR slot ${EXFAT_NUM} — no LABEL=persistence"
echo "Boot GRUB → Live (plain RAM overlay; durable config on exFAT only)"
bash "$UNMASK_SH"
echo "Installed exfat-sync map (configs/, drop-config, state files)."
