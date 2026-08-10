#!/usr/bin/env bash
# Verify an ISO copied onto a Ventoy stick byte-for-byte against the built ISO (WO-462).
#
#   bash tools/eggs/live-usb/verify-stick-iso.sh /path/on/stick/foo.iso [/home/eggs/foo.iso]
#   bash tools/eggs/live-usb/verify-stick-iso.sh --all /media/user/HIGHASCGEXF
#
# Why this exists: a copy that is never flushed leaves exFAT metadata (the full size) committed
# while most data clusters still hold stale bytes. `ls -l` looks perfect, GRUB still renders the
# branded menu from the ISO's early blocks, and then `linux /live/vmlinuz-*` dies with
# "invalid magic number" because the kernel region is garbage. Size is not evidence — hash is.
#
# ALWAYS `sync` and unmount the stick before pulling it.
set -euo pipefail

SRC_DIR="${HIGHASCG_ISO_SRC_DIR:-/home/eggs}"
fail=0

note() { echo "  $*"; }
ok() { echo "OK  : $*"; }
bad() {
	echo "FAIL: $*" >&2
	fail=1
}

verify_one() {
	local stick_iso="$1" src_iso="${2:-}"
	[[ -f "$stick_iso" ]] || {
		bad "missing: $stick_iso"
		return
	}
	if [[ -z "$src_iso" ]]; then
		src_iso="${SRC_DIR}/$(basename "$stick_iso")"
	fi
	if [[ ! -f "$src_iso" ]]; then
		bad "$(basename "$stick_iso"): no source ISO at ${src_iso} — pass it as the 2nd argument"
		return
	fi

	# WO-462: the build writes <iso>.sha256 as its LAST action. No sidecar means the build either
	# never finished or predates that change — and an ISO copied mid-build is the exact failure
	# this script exists to catch, so say so rather than silently comparing against a moving file.
	if [[ ! -f "${src_iso}.sha256" ]]; then
		note "WARN: no ${src_iso}.sha256 — cannot confirm the build had finished when this was copied"
	fi

	local s_size k_size
	s_size="$(stat -Lc %s "$src_iso")"
	k_size="$(stat -Lc %s "$stick_iso")"
	if [[ "$s_size" != "$k_size" ]]; then
		bad "$(basename "$stick_iso"): size differs (stick ${k_size} vs source ${s_size}) — copy truncated"
		return
	fi

	note "hashing $(basename "$stick_iso") ($((s_size / 1024 / 1024)) MiB) — slow over USB, be patient"
	local s_hash k_hash
	if [[ -f "${src_iso}.sha256" ]]; then
		s_hash="$(cut -d' ' -f1 <"${src_iso}.sha256")"
	else
		s_hash="$(sha256sum "$src_iso" | cut -d' ' -f1)"
	fi
	k_hash="$(sha256sum "$stick_iso" | cut -d' ' -f1)"
	if [[ "$s_hash" == "$k_hash" ]]; then
		ok "$(basename "$stick_iso") matches source ($s_hash)"
	else
		bad "$(basename "$stick_iso"): CONTENT DIFFERS at identical size — recopy, then sync"
		note "source: $s_hash"
		note "stick : $k_hash"
		note "first differing byte: $(cmp "$src_iso" "$stick_iso" 2>&1 | sed 's/.*differ: //' || true)"
	fi
}

if [[ "${1:-}" == "--all" ]]; then
	root="${2:-}"
	[[ -d "$root" ]] || {
		echo "Usage: $0 --all <stick-mount-point>" >&2
		exit 2
	}
	mapfile -t isos < <(find "$root" -maxdepth 2 -iname '*.iso' -size +100M -print | sort)
	((${#isos[@]})) || {
		echo "No ISOs (>100M) under $root" >&2
		exit 2
	}
	for i in "${isos[@]}"; do verify_one "$i"; done
else
	[[ -n "${1:-}" ]] || {
		echo "Usage: $0 <iso-on-stick> [source-iso]   |   $0 --all <stick-mount-point>" >&2
		exit 2
	}
	verify_one "$1" "${2:-}"
fi

if ((fail)); then
	echo
	echo "Do NOT boot this stick. Recopy the ISO, run 'sync', unmount, then verify again." >&2
	exit 1
fi
echo
echo "All checked ISOs match. Remember: 'sync' before pulling the stick."
