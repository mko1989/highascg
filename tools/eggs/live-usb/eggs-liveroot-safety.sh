#!/usr/bin/env bash
# Guards for penguins-eggs liveroot — NEVER delete/unmount/write through host bind mounts.
#
# During `eggs produce --clone`, eggs bind-mounts live /usr, /opt, /home, … into
# /home/eggs/liveroot/*.  rm -rf liveroot or umount those targets destroys the REAL system.
#
# Source this from eggs maintenance scripts:
#   source "$(dirname "$0")/eggs-liveroot-safety.sh"
set -euo pipefail

eggs_liveroot_default() {
	printf '%s\n' "${EGGS_LIVEROOT:-/home/eggs/liveroot}"
}

# Print lines: TARGET|SOURCE|FSTYPE (host bind mounts only)
eggs_liveroot_list_host_bind_mounts() {
	local root="$1"
	local target source fstype

	[[ -d "$root" ]] || return 0

	while read -r target source fstype _; do
		[[ -n "$target" && -n "$source" ]] || continue
		[[ "$target" == "$root"* ]] || continue
		[[ "$source" == "$root"* ]] && continue
		printf '%s|%s|%s\n' "$target" "$source" "$fstype"
	done < <(findmnt -R -n -o TARGET,SOURCE,FSTYPE "$root" 2>/dev/null || true)
}

eggs_liveroot_has_host_bind_mounts() {
	local root="$1"
	eggs_liveroot_list_host_bind_mounts "$root" | grep -q .
}

eggs_liveroot_print_host_bind_mounts() {
	local root="$1"
	eggs_liveroot_list_host_bind_mounts "$root" | while IFS='|' read -r target source fstype; do
		echo "    ${target} ← ${source} (${fstype})" >&2
	done
}

# Refuse destructive ops while eggs has the live system mounted under liveroot.
eggs_liveroot_assert_safe_for_mutation() {
	local root="$1"
	local op="${2:-modify}"

	if ! eggs_liveroot_has_host_bind_mounts "$root"; then
		return 0
	fi

	echo "ERROR: refusing to ${op} ${root} — eggs bind-mounts your LIVE system there." >&2
	echo "  rm/umount/rsync through these paths can erase /usr, /opt, /bin, …" >&2
	echo "  Safe fix: reboot (clears eggs staging), then rerun the build script." >&2
	echo "  Do NOT run: umount -R ${root}  or  rm -rf ${root}" >&2
	eggs_liveroot_print_host_bind_mounts "$root"
	return 1
}

# Refuse writing to a liveroot subpath that is a bind mount to a live system path.
eggs_liveroot_assert_path_safe_to_write() {
	local path="$1"
	local root="${2:-$(eggs_liveroot_default)}"

	[[ "$path" == "$root"* ]] || return 0
	findmnt -T "$path" >/dev/null 2>&1 || return 0

	local source
	source="$(findmnt -n -o SOURCE -T "$path" 2>/dev/null || true)"
	[[ -n "$source" ]] || return 0
	[[ "$source" == "$root"* ]] && return 0

	echo "ERROR: refusing write to ${path} — bind mount to live ${source}" >&2
	return 1
}
