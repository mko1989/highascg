# shellcheck shell=bash
# Read a built ISO without mounting it and without looking at the eggs staging tree (WO-870 Phase 5).
# No root, no loop device: the verifiers judge the image that will be flashed, nothing else. Source, do not execute.
#
# Tools: xorriso (list, extract, file LBA — preferred) or bsdtar (list, extract). Squashfs members are read
# straight from the image with `unsquashfs -o <byte offset> -cat ISO MEMBER`; the offset needs xorriso.
# HIGHASCG_ISO_READ_TOOL=xorriso|bsdtar forces one (tests).
#
#   iso_read_open ISO            pick the tool, list the image once (returns 1 + names the missing tool)
#   iso_has PATH / iso_find_ci PATH / iso_grep ERE   members (no leading slash)
#   iso_extract ISO PATH DEST    copy one member out; iso_cat ISO PATH prints a small one
#   iso_volume_id ISO            PVD volume id (dd only)
#   iso_file_offset / iso_file_size ISO PATH                     (return 2 when xorriso is missing)
#   iso_squashfs_cat ISO SQ MEMBER / iso_squashfs_list ISO SQ    (return 2 when xorriso is missing)
#   bzimage_release FILE         kernel release string of an x86 bzImage

ISO_READ_TOOL=""
ISO_READ_LIST=""

iso_read_open() {
	local iso="$1" want="${HIGHASCG_ISO_READ_TOOL:-}"
	if [[ "$want" != bsdtar ]] && command -v xorriso >/dev/null 2>&1; then
		ISO_READ_TOOL=xorriso
	elif [[ "$want" != xorriso ]] && command -v bsdtar >/dev/null 2>&1; then
		ISO_READ_TOOL=bsdtar
	else
		echo "missing tool: xorriso or bsdtar (sudo apt install xorriso libarchive-tools) — cannot read ${iso}" >&2
		return 1
	fi
	ISO_READ_LIST="$(mktemp)"
	if [[ "$ISO_READ_TOOL" == xorriso ]]; then
		xorriso -indev "$iso" -find / -type f 2>/dev/null | sed -e "s/^'//" -e "s/'\$//" -e 's|^/||' >"$ISO_READ_LIST"
	else
		bsdtar -tf "$iso" 2>/dev/null >"$ISO_READ_LIST"
	fi
	[[ -s "$ISO_READ_LIST" ]] || {
		echo "cannot list ${iso} with ${ISO_READ_TOOL} (not an ISO, or unreadable)" >&2
		return 1
	}
}

iso_read_close() {
	[[ -n "$ISO_READ_LIST" ]] && rm -f "$ISO_READ_LIST"
	return 0
}

iso_has() { grep -qxF -- "${1#/}" "$ISO_READ_LIST"; }

# The member whose path equals PATH ignoring case (legacy EFI/boot/bootx64.efi vs new EFI/BOOT/BOOTX64.EFI).
iso_find_ci() { grep -ixF -m1 -- "${1#/}" "$ISO_READ_LIST"; }

iso_grep() { grep -E -- "$1" "$ISO_READ_LIST"; }

iso_extract() {
	local iso="$1" p="${2#/}" dest="$3"
	rm -f "$dest"
	if [[ "$ISO_READ_TOOL" == xorriso ]]; then
		xorriso -osirrox on -indev "$iso" -extract "/${p}" "$dest" >/dev/null 2>&1
	else
		bsdtar -xOf "$iso" "$p" >"$dest" 2>/dev/null
	fi
	[[ -s "$dest" ]]
}

iso_cat() {
	local t rc
	t="$(mktemp)"
	iso_extract "$1" "$2" "$t" && cat "$t"
	rc=$?
	rm -f "$t"
	return "$rc"
}

# Primary Volume Descriptor volume id: 32 bytes at 32808 (sector 16, offset 40), space padded.
iso_volume_id() {
	dd if="$1" bs=1 skip=32808 count=32 status=none 2>/dev/null | tr -d '\0' | sed 's/[[:space:]]*$//'
}

# Byte offset of a member's data. ISO 9660 stores a file in one extent (or several back to back past 4 GiB);
# anything else is refused rather than guessed.
iso_file_offset() {
	[[ "$ISO_READ_TOOL" == xorriso ]] || return 2
	local lba
	lba="$(xorriso -indev "$1" -find "/${2#/}" -exec report_lba -- 2>/dev/null | awk -F, '
		/^File data lba:/ { s = $2 + 0; b = $3 + 0; if (n && s != next_s) bad = 1; if (!n) first = s; next_s = s + b; n++ }
		END { if (n && !bad) print first }')"
	[[ "$lba" =~ ^[0-9]+$ ]] || return 1
	echo $((lba * 2048))
}

# Size in bytes of a member (xorriso only). A member over 4 GiB has several extents, and every extent line repeats the
# WHOLE file size (column 4) — take it once (30.10: summing reported an 8.3 GB squashfs as 15906 MiB).
iso_file_size() {
	[[ "$ISO_READ_TOOL" == xorriso ]] || return 2
	xorriso -indev "$1" -find "/${2#/}" -exec report_lba -- 2>/dev/null \
		| awk -F, '/^File data lba:/ { s = $4 + 0; if (s > n) n = s } END { if (n) print n; else exit 1 }'
}

iso_squashfs_cat() {
	local off
	off="$(iso_file_offset "$1" "$2")" || return $?
	unsquashfs -o "$off" -cat "$1" "${3#/}" 2>/dev/null
}

# Every path in the squashfs, one per line, without the squashfs-root/ prefix.
iso_squashfs_list() {
	local off
	off="$(iso_file_offset "$1" "$2")" || return $?
	unsquashfs -o "$off" -lc "$1" 2>/dev/null | sed -n 's|^squashfs-root/||p'
}

# x86 boot protocol: the u16 at 0x20E is the offset of the version string minus 0x200.
bzimage_release() {
	local f="$1" off
	off="$(od -An -tu2 -j526 -N2 "$f" 2>/dev/null | tr -d '[:space:]')"
	[[ "$off" =~ ^[0-9]+$ && "$off" -gt 0 ]] || return 1
	dd if="$f" bs=1 skip=$((off + 512)) count=128 status=none 2>/dev/null | tr '\0' '\n' | head -1 | awk '{print $1}'
}
