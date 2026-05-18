#!/usr/bin/env bash
# One automated path: Eggs clone image (WO-47 + excludes + NVIDIA debs cache) → confirm USB stick →
# dd ISO → optional exFAT operator data slice (HIGHASCGEXF) with safe clearance from ISO file size →
# optional Debian Live / union persistence.
#
# Prerequisites on the BUILD host before first run:
#   - Eggs installed; HIGHASCG at /home/casparcg/highascg with package.json
#   - Optional: DeckLink Desktop Video .deb tarball (HIGHASCG_DECKLINK_TAR or /tmp/decklink.tar.gz) then run
#     scripts/install.sh phase 2 ONCE — eggs --clone snapshots whatever is installed
#
# Usage:
#   cd /home/casparcg/highascg
#   sudo bash tools/live-usb/build-operator-stick.sh
#
# Options:
#   --skip-build         Use newest ISO under /home/eggs/ (already built).
#   --iso PATH           Use this ISO instead of scanning /home/eggs/.
#   --usb /dev/sdX       Non-interactive target device (confirmation still applies unless -y).
#   --yes, -y            Skip uppercase YES / path re-type prompts (destructive — use cautiously).
#   --skip-exfat         Do not add the exFAT data partition after dd (not recommended).
#   --skip-persistence   Skip add-union-persistence-partition.sh (not recommended on production rigs).
#   --dry-run-partitions Dry-run both exfat + persistence scripts only after dd (best with --skip-build).
#   --decklink-required  Exit if Blackmagic Desktop Video packages are not installed (image would lack DeckLink).
#   --no-decklink-check  Silence DeckLink notices.
#
# Environment (often set instead of repeating flags):
#   BASENAME, NVIDIA_BRANCHES  — forwarded to tools/live-usb/build-highascg-egg.sh
#   EXFAT_AFTER_ISO_MARGIN_MIB — added on top of ceil(ISO file size MiB); default ~1.12 GiB (1152 MiB) so ~4.9 GiB
#                                ISO leaves data near ~6+ GiB. Increase if hybrids grow.
#   EXFAT_ISO_PATH           — forwarded to add-exfat-data-partition.sh (default: ISO used for dd).
#   EXFAT_FILL_DISK, EXFAT_SIZE_MIB, EXFAT_LABEL — forwarded to add-exfat-data-partition.sh (stay on HIGHASCGEXF for WO-47).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=flash-stick-common.sh
source "${HERE}/flash-stick-common.sh"

REPO="$(cd "${HERE}/../.." && pwd)"
BUILD_SCRIPT="${HERE}/build-highascg-egg.sh"
EXFAT_SCRIPT="${HERE}/add-exfat-data-partition.sh"
PERSIST_SCRIPT="${HERE}/add-union-persistence-partition.sh"

DO_BUILD=true
ISO=""
USB=""
ASSUME_YES=false
DO_EXFAT=true
DO_PERSIST=true
DRY_PARTITIONS=false
DECKLINK_MODE=warn
ASK_STICK_YES=true

usage() {
	sed -n '1,40p' "$0" | tail -n +2
	exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	-h | --help) usage 0 ;;
	--skip-build) DO_BUILD=false ;;
	--iso)
		ISO="${2:?}"
		shift
		;;
	--usb)
		USB="${2:?}"
		shift
		;;
	-y | --yes) ASSUME_YES=true ;;
	--skip-exfat) DO_EXFAT=false ;;
	--skip-persistence) DO_PERSIST=false ;;
	--dry-run-partitions) DRY_PARTITIONS=true ;;
	--decklink-required) DECKLINK_MODE=require ;;
	--no-decklink-check) DECKLINK_MODE=skip ;;
	--no-stick-prompt | --fast-usb-select) ASK_STICK_YES=false ;;
	*)
		echo "Unknown option: $1" >&2
		usage 1
		;;
	esac
	shift
done

die() {
	echo "Error: $*" >&2
	exit 1
}

need_root() {
	[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo $0"
}

decklink_installed() {
	if LANG=C dpkg-query -l 'desktopvideo*' 2>/dev/null | grep -q '^ii'; then
		return 0
	fi
	if LANG=C dpkg-query -l 'blackmagic-desktopvideo*' 2>/dev/null | grep -q '^ii'; then
		return 0
	fi
	[[ -d /usr/include/DeckLink ]] && return 0
	[[ -d /etc/blackmagic ]] && return 0
	return 1
}

decklink_report() {
	[[ "$DECKLINK_MODE" == skip ]] && return 0
	if decklink_installed; then
		echo "==> DeckLink Desktop Video packages detected on host — they'll be cloned into ISO/squashfs."
		command -v modprobe >/dev/null 2>&1 && { modprobe -n blackmagic 2>/dev/null || true; }
		return 0
	fi

	local msg=""
	msg+="DeckLink Desktop Video is NOT installed on this build host ($(hostname -s)).

Eggs '--clone' only ships what exists on /. Install once with BLACKMAGIC tarball + installer:
    export HIGHASCG_DECKLINK_TAR=/path/to/Blackmagic_Desktop_Video_Linux_*.tar.gz   # optional
    sudo bash ${REPO}/scripts/install.sh
Or copy tarball to /tmp/decklink.tar.gz and rerun phase 2 (see scripts/install-phase2.sh).

Caspar references are present in the repo installer; DeckLink kernels still need BLACKMAGIC DKMS/driver on the LIVE session after flash if omitted here."

	if [[ "$DECKLINK_MODE" == require ]]; then
		echo "==> FAILURE: ${msg}" >&2
		exit 20
	fi
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
	echo "$msg"
	echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

need_root

[[ -f "${REPO}/package.json" ]] || die "Expected HighAsCG repo at ${REPO} (missing package.json)."

decklink_report

if "$DO_BUILD"; then
	echo "==> Full Eggs build (${BUILD_SCRIPT}: WO-47 prep, excludes, NVIDIA pool, network tweaks, eggs produce --clone --max)"
	bash "${BUILD_SCRIPT}"
fi

if [[ -z "${ISO:-}" ]]; then
	ISO="$(find_latest_iso)" || die "No ISO — build first or pass --iso PATH"
fi
[[ -f "$ISO" ]] || die "ISO not readable: $ISO"

ISOBYTES=$(stat -c '%s' "$ISO" || die "stat iso")
ISOMB=$(( (ISOBYTES + 1024 * 1024 - 1) / (1024 * 1024) ))

export EXFAT_AFTER_ISO_MARGIN_MIB="${EXFAT_AFTER_ISO_MARGIN_MIB:-1152}"
export EXFAT_ISO_PATH="${EXFAT_ISO_PATH:-$ISO}"

echo
echo "==> Selected ISO — $ISO"
echo "    File size ~${ISOMB} MiB; exFAT start ≥ hybrid tail and ≥ ceil(bytes/1MiB)+${EXFAT_AFTER_ISO_MARGIN_MIB} MiB floor (ISO file: ${EXFAT_ISO_PATH})."

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Plug the OPERATOR USB stick now (whole-disk device e.g. /dev/sdc — NOT partitions like /dev/sdc1)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ -z "$USB" ]]; then
	if "$ASK_STICK_YES"; then
		pick_usb_interactive --require-yes "confirm the stick you want to flash is removable USB (not NVMe/SATA/OS)" || exit 1
	else
		pick_usb_interactive || exit 1
	fi
fi
[[ -b "$USB" ]] || die "Not a block device: $USB"
typ=$(lsblk -ndo TYPE "$USB" 2>/dev/null || true)
[[ "$typ" == disk ]] || die "Use whole-disk path (got TYPE=$typ for $USB)"

extra_note=""
if "$DO_EXFAT"; then
	extra_note+="Then: exFAT data partition LABEL=HIGHASCGEXF (WO-47; readable name \\\"highascg-data\\\" does not fit 11‑char exFAT limit)."
	extra_note+=$'\n'"      Start ≥ max(hybrid ISO tail, ~${ISOMB}+${EXFAT_AFTER_ISO_MARGIN_MIB} MiB from ISO)."
fi
if "$DO_PERSIST"; then
	extra_note+=$'\n'"Then: union persistence (${PERSIST_SCRIPT}) on remaining space."
else
	extra_note+=$'\n'"Persistence skipped (--skip-persistence)."
fi
if "$DRY_PARTITIONS"; then
	extra_note+=$'\n'"Partition steps are --dry-run only."
fi

confirm_dd_flash "$ISO" "$USB" "$ASSUME_YES" "$extra_note" || exit 1
run_dd_flash "$ISO" "$USB"

if "$DO_EXFAT"; then
	echo "==> exFAT operator data (${EXFAT_SCRIPT}) — safe vs ISO (${EXFAT_ISO_PATH}), margin ${EXFAT_AFTER_ISO_MARGIN_MIB} MiB"
	if "$DRY_PARTITIONS"; then
		EXFAT_ISO_PATH="$EXFAT_ISO_PATH" EXFAT_AFTER_ISO_MARGIN_MIB="$EXFAT_AFTER_ISO_MARGIN_MIB" \
			bash "$EXFAT_SCRIPT" --dry-run "$USB"
	else
		EXFAT_ISO_PATH="$EXFAT_ISO_PATH" EXFAT_AFTER_ISO_MARGIN_MIB="$EXFAT_AFTER_ISO_MARGIN_MIB" \
			bash "$EXFAT_SCRIPT" "$USB"
	fi
else
	echo "==> skip-exfat (--skip-exfat)"
fi

if "$DO_PERSIST"; then
	echo "==> Persistence (${PERSIST_SCRIPT})"
	if "$DRY_PARTITIONS"; then
		bash "$PERSIST_SCRIPT" --dry-run "$USB"
	else
		bash "$PERSIST_SCRIPT" "$USB"
	fi
fi

echo
echo "✓ Operator stick workflow complete."
echo "  Boot: GRUB → **Live with persistence** (full / overlay)."
echo "  Data: exFAT **HIGHASCGEXF** → /home/casparcg/exfat (WO-47); sync + bind mount wired if image had prepare-eggs-clone."
echo "  Docs : tools/live-usb/FLASH_AND_PERSIST.md  ·  EXFAT_DATA_ZERO_TOUCH.md"
echo ""
