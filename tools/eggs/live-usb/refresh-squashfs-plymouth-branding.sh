#!/usr/bin/env bash
# Bake current host Plymouth theme into filesystem.squashfs (live OS root).
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=eggs-liveroot-safety.sh
source "${HERE}/eggs-liveroot-safety.sh"
LIVEROOT="$(eggs_liveroot_default)"
SQ="${EGGS_SQUASHFS:-/home/eggs/mnt/iso/live/filesystem.squashfs}"
MKSQ="${EGGS_MKSQUASHFS:-/home/eggs/bin/mksquashfs}"
HOST_THEME=/usr/share/plymouth/themes/highascg

[[ -d "$LIVEROOT" ]] || {
	echo "Missing ${LIVEROOT} — run eggs produce first." >&2
	exit 1
}
eggs_liveroot_assert_safe_for_mutation "$LIVEROOT" "refresh squashfs from"
[[ -d "$HOST_THEME" ]] || {
	echo "Missing ${HOST_THEME} — run install-highascg-plymouth-theme.sh first." >&2
	exit 1
}
[[ -f "$MKSQ" ]] || {
	echo "Missing ${MKSQ} — eggs produce did not leave mksquashfs helper." >&2
	exit 1
}

MIN_LIVEROOT_MIB="${MIN_LIVEROOT_MIB:-1500}"
MIN_SQUASHFS_MIB="${MIN_SQUASHFS_MIB:-2500}"
liveroot_mib="$(du -sm "$LIVEROOT" | awk '{print $1}')"
if [[ "$liveroot_mib" -lt "$MIN_LIVEROOT_MIB" ]]; then
	echo "ERROR: liveroot is only ${liveroot_mib} MiB (need >= ${MIN_LIVEROOT_MIB})." >&2
	echo "       Run full: sudo HIGHASCG_NVIDIA_DRIVER=595 bash tools/eggs/live-usb/build-highascg-egg.sh" >&2
	echo "       Do NOT rebuild squashfs from a stale partial liveroot." >&2
	exit 1
fi
if [[ -f "$SQ" ]]; then
	old_sq_mib="$(du -sm "$SQ" | awk '{print $1}')"
	if [[ "$old_sq_mib" -ge "$MIN_SQUASHFS_MIB" && "$liveroot_mib" -lt $((old_sq_mib / 2)) ]]; then
		echo "ERROR: refusing to replace ${old_sq_mib} MiB squashfs with ${liveroot_mib} MiB liveroot." >&2
		echo "       Use inject with default (no squashfs refresh) or run full eggs produce." >&2
		exit 1
	fi
fi

# Prior broken mksquashfs runs left etc_1, usr_1, … under liveroot; live only mounts squashfs-root/usr/.
for dup in "${LIVEROOT}"/*_[0-9]*; do
	[[ -e "$dup" ]] || continue
	eggs_liveroot_assert_path_safe_to_write "$dup" "$LIVEROOT"
	echo "WARN: removing stale liveroot duplicate: ${dup}"
	rm -rf "$dup"
done

PLYMOUTH_DEST="${LIVEROOT}/usr/share/plymouth/themes/highascg"
eggs_liveroot_assert_path_safe_to_write "${LIVEROOT}/usr" "$LIVEROOT"
eggs_liveroot_assert_path_safe_to_write "$PLYMOUTH_DEST" "$LIVEROOT"

echo "==> Sync Plymouth theme → ${PLYMOUTH_DEST}"
mkdir -p "${LIVEROOT}/usr/share/plymouth/themes"
rsync -a --delete "${HOST_THEME}/" "${PLYMOUTH_DEST}/"
if [[ -f /etc/plymouth/plymouthd.conf ]]; then
	mkdir -p "${LIVEROOT}/etc/plymouth"
	eggs_liveroot_assert_path_safe_to_write "${LIVEROOT}/etc/plymouth" "$LIVEROOT"
	install -m 0644 /etc/plymouth/plymouthd.conf "${LIVEROOT}/etc/plymouth/plymouthd.conf"
fi

sample="${PLYMOUTH_DEST}/throbber-0001.png"
[[ -f "$sample" ]] || {
	echo "ERROR: missing ${sample} after rsync" >&2
	exit 1
}
info="$(file -b "$sample")"
echo "    liveroot throbber-0001: ${info}"
if echo "$info" | grep -q RGBA; then
	echo "ERROR: liveroot theme still RGBA — run prepare-branding-assets.sh first" >&2
	exit 1
fi

echo "==> Rebuild filesystem.squashfs (full replace, 10–25 min)"
sq_bak="${SQ}.bak.highascg"
if [[ -f "$SQ" ]]; then
	cp -a "$SQ" "$sq_bak"
	echo "    backup: ${sq_bak} ($(du -h "$sq_bak" | awk '{print $1}'))"
fi
rm -f "$SQ"
if ! bash "$MKSQ"; then
	[[ -f "$sq_bak" ]] && cp -a "$sq_bak" "$SQ" && echo "Restored squashfs from backup after mksquashfs failure." >&2
	exit 1
fi
new_sq_mib="$(du -sm "$SQ" | awk '{print $1}')"
if [[ "$new_sq_mib" -lt "$MIN_SQUASHFS_MIB" ]]; then
	echo "ERROR: new squashfs is only ${new_sq_mib} MiB (need >= ${MIN_SQUASHFS_MIB})." >&2
	if [[ -f "$sq_bak" ]]; then
		cp -a "$sq_bak" "$SQ"
		echo "Restored previous squashfs from ${sq_bak}" >&2
	fi
	exit 1
fi
rm -f "$sq_bak"

verify="$(mktemp -d)"
trap 'rm -rf "$verify"' EXIT
unsquashfs -f -d "$verify" "$SQ" usr/share/plymouth/themes/highascg/throbber-0001.png >/dev/null
vsample="${verify}/usr/share/plymouth/themes/highascg/throbber-0001.png"
vinfo="$(file -b "$vsample")"
echo "    squashfs throbber-0001: ${vinfo}"
if echo "$vinfo" | grep -q RGBA; then
	echo "ERROR: squashfs still has RGBA under usr/ — aborting ISO pack" >&2
	unsquashfs -l "$SQ" 2>/dev/null | grep -E 'usr_[0-9]/share/plymouth' | head -5 >&2 || true
	exit 1
fi
if unsquashfs -l "$SQ" 2>/dev/null | grep -qE '^squashfs-root/usr_[0-9]/'; then
	echo "ERROR: squashfs contains usr_N duplicate trees — live boot uses usr/ only" >&2
	exit 1
fi
echo "OK: ${SQ} refreshed (single usr/, RGB Plymouth)"
