#!/bin/bash
# HighAsCG — mount a partition onto the fixed media folder (WO-38).
# Run as root: sudo -n /usr/local/lib/highascg/media-mount.sh (no arguments).
# Request: line 1 of /run/highascg/media-mount.req — partition UUID (lowercase canonical).
set -euo pipefail

MP="/home/casparcg/highascg/media"
REQ_DIR="/run/highascg"
REQ="${REQ_DIR}/media-mount.req"
LOG_TAG="highascg-media-mount"

abort() {
	echo "$*" >&2
	exit 1
}

log_info() {
	logger -t "$LOG_TAG" -- "$*" 2>/dev/null || true
}

ensure_req_readable() {
	[[ -f "$REQ" ]] || abort "Missing request file $REQ"
	[[ -r "$REQ" ]] || abort "Cannot read $REQ"
	local oct uid
	read -r oct uid _ < <(stat -c '%a %u' "$REQ" 2>/dev/null) || oct=""
	[[ "$oct" == "600" ]] || [[ "$oct" == "640" ]] || abort "Unsafe mode on $REQ (expected 0600 or 0640): $oct"
	if [[ "$(id -u)" == "0" ]] && [[ -n "${SUDO_UID:-}" ]]; then
		[[ "$uid" == "$SUDO_UID" ]] || abort "Request file must be owned by invoking user uid=$uid (expected $SUDO_UID)"
	fi
}

validate_uuid_line() {
	local line
	line="$(head -n1 "$REQ" | tr -d '\r' | sed 's/[[:space:]]*$//')" || line=""
	[[ -n "$line" ]] || abort "Empty UUID in request file"
	line="$(echo "$line" | tr '[:upper:]' '[:lower:]')" || line=""
	if ! [[ "$line" =~ ^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$ ]]; then
		abort "Invalid UUID format"
	fi
	echo "$line"
}

prepare_mount_point() {
	mkdir -p "$MP"
	local real
	real="$(readlink -f "$MP")"
	if [[ "$real" != "$MP" ]]; then
		abort "$MP must be a real directory (not a symlink). Resolve Settings → CasparCG media symlink first. Resolved=$real"
	fi
}

refuse_live_root_uuid() {
	local uuid="$1"
	local ru rl
	if ! ru="$(findmnt -n -o UUID / 2>/dev/null | head -n1)" || [[ -z "$ru" ]]; then
		return 0
	fi
	rl="$(echo "$ru" | tr '[:upper:]' '[:lower:]')" || rl=""
	if [[ "$rl" == "$uuid" ]]; then
		abort "Refusing to mount: UUID matches the active root (/) filesystem"
	fi
}

refuse_critical_mount_sources() {
	local dev="$1"
	local dest
	while read -r dest; do
		[[ -z "$dest" ]] && continue
		case "$dest" in
		/ | /boot | /boot/efi | /usr | /var | /home)
			abort "Refusing: $dev is already mounted at $dest"
			;;
		esac
	done < <(findmnt -n -o TARGET -S "$dev" 2>/dev/null || true)
}

assert_partition_device() {
	local dev="$1"
	[[ -b "$dev" ]] || abort "Not a block device: $dev"
	local typ
	typ="$(lsblk -n -o TYPE "$dev" 2>/dev/null | head -n1 || true)"
	typ="${typ,,}"
	if [[ "$typ" == "disk" ]]; then
		abort "Refusing whole disk ($dev); select a partition"
	fi
}

do_umount_existing() {
	if findmnt "$MP" >/dev/null 2>&1; then
		log_info "unmount existing mount at $MP"
		if ! umount "$MP" 2>/dev/null; then
			umount -l "$MP" 2>/dev/null || abort "umount failed (device busy). Stop playback, stop Caspar using files here, retry."
		fi
	fi
}

clear_mount_point_contents() {
	[[ -d "$MP" ]] || return 0
	find "$MP" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
}

do_mount_dev() {
	local dev="$1"
	log_info "mount $dev -> $MP"
	mount "$dev" "$MP" || abort "mount failed for $dev on $MP (unsupported fs, hibernating Windows NTFS, or driver missing?)"
}

main_apply() {
	ensure_req_readable
	local uuid
	uuid="$(validate_uuid_line)"
	prepare_mount_point
	refuse_live_root_uuid "$uuid"

	local dev
	dev="$(readlink -f "/dev/disk/by-uuid/$uuid" 2>/dev/null || true)"
	[[ -n "$dev" ]] || abort "No /dev/disk/by-uuid/$uuid"

	assert_partition_device "$dev"
	refuse_critical_mount_sources "$dev"

	do_umount_existing
	clear_mount_point_contents
	do_mount_dev "$dev"
	rm -f "$REQ"
	log_info "ok uuid=$uuid dev=$dev"
	printf '{"ok":true,"uuid":"%s","source":"%s","mountpoint":"%s"}\n' "$uuid" "$dev" "$MP"
}

if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
	echo "Reads UUID line 1 from $REQ; mounts that partition at $MP. No CLI args." >&2
	exit 0
fi

[[ -z "${1:-}" ]] || abort "This script accepts no arguments"

mkdir -p "$REQ_DIR"
main_apply
