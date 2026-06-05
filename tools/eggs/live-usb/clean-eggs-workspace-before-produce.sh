#!/usr/bin/env bash
# Reset eggs staging so produce does not inherit broken liveroot / bloated squashfs.
#
# liveroot is eggs' temporary CLONE staging (/home/eggs/liveroot), NOT your live $HOME.
#
# CRITICAL: eggs bind-mounts live /usr, /opt, … into liveroot during produce.
# This script NEVER umounts or rm -rf liveroot while those mounts exist.
#
# Usage: sudo bash tools/eggs/live-usb/clean-eggs-workspace-before-produce.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=eggs-liveroot-safety.sh
source "${HERE}/eggs-liveroot-safety.sh"

LIVEROOT="$(eggs_liveroot_default)"
ISO_WORK="${EGGS_ISO_WORK:-/home/eggs/mnt/iso}"
SQ="${ISO_WORK}/live/filesystem.squashfs"

for mp in /home/casparcg/bridge /home/casparcg/exfat /home/casparcg/highascg/media; do
	if findmnt -T "$mp" >/dev/null 2>&1; then
		echo "WARN: ${mp} is mounted — umount before produce (avoid baking disk content into squashfs)" >&2
	fi
done

discard_liveroot() {
	local root="$1"

	echo "==> Discard stale eggs liveroot: ${root}"
	echo "    (ISO build staging only — NOT your live home or ~/.gemini)"

	eggs_liveroot_assert_safe_for_mutation "$root" "delete"

	if rm -rf "$root" 2>/dev/null; then
		return 0
	fi

	local stale="${root}.stale.$(date +%s)"
	echo "WARN: could not rm ${root} — moving aside to ${stale}" >&2
	mv "$root" "$stale"
	echo "    (delete ${stale} later when idle: rm -rf ${stale})"
}

if [[ -d "$LIVEROOT" ]]; then
	discard_liveroot "$LIVEROOT"
fi

if [[ -f "$SQ" ]]; then
	old="$(du -h "$SQ" | awk '{print $1}')"
	echo "==> Remove stale squashfs (${old}): ${SQ}"
	rm -f "$SQ"
fi

echo "OK: eggs workspace clean — next: eggs produce --clone"
