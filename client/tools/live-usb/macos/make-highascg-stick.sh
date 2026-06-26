#!/usr/bin/env bash
# HighAsCG — prepare a bootable USB from an .iso on macOS, then add exFAT HIGHASCGEXF + operator folders.
#
# Usage (run in Terminal):
#   chmod +x tools/eggs/live-usb/macos/make-highascg-stick.sh
#   sudo ./tools/eggs/live-usb/macos/make-highascg-stick.sh [--tar-gz PATH] [--app-dir PATH] /path/to/live.iso
#
# You will be shown `diskutil list external physical` targets, pick the whole
# disk identifier (e.g. disk4 — never disk4s1). The script requires typing YES
# + re-typing the identifier.
#
# exFAT step: tries `diskutil addPartition <wholeDisk> Exfat HIGHASCGEXF 100%`
# to consume remaining free space after a hybrid ISO layout. If that fails,
# follow the printed Linux alternative (add-exfat-data-partition.sh) or Disk Utility.
#
set -euo pipefail

EXFAT_LABEL="HIGHASCGEXF"

usage() {
	echo "Usage: sudo $0 [--skip-exfat] [--dry-run] [--tar-gz PATH] [--app-dir PATH] /path/to/image.iso" >&2
	echo "  --tar-gz   extract release .tar.gz into sim/highascg after exFAT is ready" >&2
	echo "  --app-dir  copy an unpacked HighAsCG tree (must contain package.json) into sim/highascg" >&2
	exit 1
}

SKIP_EXFAT=false
DRY_RUN=false
TAR_GZ=""
APP_DIR=""
ISO=""
while [[ $# -gt 0 ]]; do
	case "$1" in
	--skip-exfat) SKIP_EXFAT=true; shift ;;
	--dry-run) DRY_RUN=true; shift ;;
	--tar-gz)
		TAR_GZ="${2:?}"
		shift 2
		;;
	--app-dir)
		APP_DIR="${2:?}"
		shift 2
		;;
	-*) usage ;;
	*)
		ISO=$1
		shift
		;;
	esac
done

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run with sudo for raw disk access." >&2
	exit 1
}

[[ -n "$ISO" && -f "$ISO" ]] || usage

if [[ -n "$TAR_GZ" && -n "$APP_DIR" ]]; then
	echo "Use only one of --tar-gz or --app-dir." >&2
	exit 1
fi
if [[ -n "$TAR_GZ" && ! -f "$TAR_GZ" ]]; then
	echo "Tarball not found: $TAR_GZ" >&2
	exit 1
fi
if [[ -n "$APP_DIR" ]]; then
	[[ -d "$APP_DIR" ]] || {
		echo "Not a directory: $APP_DIR" >&2
		exit 1
	}
	[[ -f "$APP_DIR/package.json" ]] || {
		echo "No package.json in $APP_DIR" >&2
		exit 1
	}
fi

if [[ "$SKIP_EXFAT" == true ]] && { [[ -n "$TAR_GZ" ]] || [[ -n "$APP_DIR" ]]; }; then
	echo "Do not combine --skip-exfat with --tar-gz / --app-dir (exFAT volume is the copy target)." >&2
	exit 1
fi

list_external_disks() {
	echo ""
	echo "=== External / physical disks (choose the USB STICK whole disk, e.g. disk4) ==="
	diskutil list external physical 2>/dev/null || diskutil list
}

list_external_disks

echo ""
read -r -p "Type the whole-disk identifier to WIPE (example: disk4): " DISK
DISK=${DISK#/dev/}
DISK=${DISK#dev/}
[[ "$DISK" == disk* ]] || {
	echo "Expected something like disk4" >&2
	exit 1
}
if [[ "$DISK" == *s[0-9]* ]]; then
	echo "Refusing a partition id ($DISK) — use whole disk (diskN)." >&2
	exit 1
fi

RAW="/dev/r${DISK}"

echo ""
echo "DESTINATION: /dev/${DISK}  (raw: $RAW)"
echo "SOURCE ISO: $ISO"
echo ""

read -r -p 'Type YES to wipe this disk completely: ' w1
[[ "$w1" == YES ]] || {
	echo Aborted >&2
	exit 1
}
read -r -p "Re-type disk id to confirm ($DISK): " w2
[[ "$w2" == "$DISK" ]] || {
	echo "Mismatch ($w2 vs $DISK)" >&2
	exit 1
}

read -r -p "LAST CHANCE — is ${DISK} your USB stick, not Macintosh HD/external backup? Type YES: " w3
[[ "$w3" == YES ]] || {
	echo Aborted >&2
	exit 1
}

if [[ "$DRY_RUN" == true ]]; then
	echo "[dry-run] No writes."
	exit 0
fi

echo ""
echo "==> Writing ISO with dd (this takes several minutes) …"
/usr/bin/dd "if=${ISO}" "of=${RAW}" bs=4m status=progress
sync

echo ""
echo "==> Waiting for I/O settle …"
sleep 3
diskutil list "/dev/$DISK" || true

if [[ "$SKIP_EXFAT" == true ]]; then
	echo "(--skip-exfat) Stopping here."
	exit 0
fi

echo ""
echo "==> Adding exFAT data partition LABEL=$EXFAT_LABEL (diskutil 'R' = remainder of free space) …"
if diskutil addPartition "/dev/$DISK" Exfat "$EXFAT_LABEL" R; then
	:
elif diskutil addPartition "/dev/$DISK" Exfat "$EXFAT_LABEL" 100%; then
	:
else
	echo ""
	echo "diskutil addPartition failed (hybrid ISO sticks use MBR — Disk Utility Partition is often greyed out)."
	echo "On this Mac: use the launcher Partitioning tab (macOS fdisk steps — brew install parted is not available)."
	echo "    bash client/tools/live-usb/macos/calc-exfat-mbr-sectors.sh ${DISK}"
	echo "On Linux:"
	echo "    sudo bash tools/eggs/live-usb/add-exfat-data-partition.sh /dev/sdX"
	exit 4
fi

sleep 2
VOL="/Volumes/${EXFAT_LABEL}"
for _ in $(seq 1 40); do
	[[ -d "$VOL" ]] && break
	sleep 0.25
done
if [[ ! -d "$VOL" ]]; then
	for try in /Volumes/*; do
		[[ -d "$try" ]] || continue
		if /usr/sbin/diskutil info "$try" 2>/dev/null | grep -F 'Volume Name:' | grep -q "$EXFAT_LABEL"; then
			VOL=$try
			break
		fi
	done
fi

if [[ -z "${VOL:-}" || ! -d "$VOL" ]]; then
	echo "exFAT created but not mounted under /Volumes — open Disk Utility to mount, then create folders manually:" >&2
	echo "  sim/highascg  drop-config  media  templates  configs  snapshots/rear-panels" >&2
	exit 0
fi

echo "==> Seeding operator layout under $VOL"
mkdir -p "$VOL/sim/highascg" "$VOL/update/server" "$VOL/drop-config" "$VOL/media" "$VOL/templates" "$VOL/configs" "$VOL/snapshots/rear-panels"
cat >"$VOL/README-HIGHASCG-EXFAT.txt" <<EOF
HighAsCG operator data (exFAT volume label: $EXFAT_LABEL)

sim/highascg — Extract release tarball or sync sources here (Linux WO-47 mtime sync → ~/highascg).
drop-config — Optional monolithic highascg.config.json.
media — Carry media; binds to ~/highascg/media/exfat on tuned Linux images.
templates — Extra templates.
configs — Config exports / site bundles.
snapshots/rear-panels — Device / rear-panel snapshots.

Linux: mounts at /home/casparcg/exfat (LABEL=$EXFAT_LABEL).
EOF

if [[ -n "${TAR_GZ}" ]]; then
	echo "==> Extracting HighAsCG tarball into $VOL/sim/highascg …"
	find "$VOL/sim/highascg" -mindepth 1 -delete 2>/dev/null || true
	tar -xzf "$TAR_GZ" -C "$VOL/sim/highascg"
fi
if [[ -n "${APP_DIR}" ]]; then
	echo "==> Copying app tree into $VOL/sim/highascg …"
	find "$VOL/sim/highascg" -mindepth 1 -delete 2>/dev/null || true
	ditto "${APP_DIR}/." "$VOL/sim/highascg"
fi

echo ""
echo "Done. Eject safely: diskutil eject /dev/$DISK"
