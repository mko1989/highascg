#!/usr/bin/env bash
# Guards for penguins-eggs liveroot — NEVER delete/unmount/write through host bind mounts.
#
# During `eggs produce --clone`, eggs bind-mounts live /usr, /opt, /home, … into
# /home/eggs/liveroot/*.  rm -rf liveroot or umount those targets destroys the REAL system.
#
# Source this from eggs maintenance scripts:
#   source "$(dirname "$0")/eggs-liveroot-safety.sh"
set -euo pipefail

# sudo often strips PATH — always use absolute tool paths for safety checks.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
FINDMNT=/usr/bin/findmnt
AWK=/usr/bin/awk
GREP=/usr/bin/grep
PGREP=/usr/bin/pgrep

eggs_liveroot_default() {
	printf '%s\n' "${EGGS_LIVEROOT:-/home/eggs/liveroot}"
}

eggs_liveroot_prereq_check() {
	local missing=0
	for tool in "$FINDMNT" "$AWK" "$GREP" /bin/rm /bin/mv /usr/bin/date; do
		[[ -x "$tool" ]] || {
			echo "ERROR: required tool missing: ${tool} — refusing liveroot operations." >&2
			missing=1
		}
	done
	[[ -x /usr/bin/bash ]] || {
		echo "ERROR: /usr/bin/bash missing — host may be damaged; reboot from ISO/USB." >&2
		missing=1
	}
	[[ "$missing" -eq 0 ]]
}

# Print lines: TARGET|SOURCE|FSTYPE (host bind mounts only)
eggs_liveroot_list_host_bind_mounts() {
	local root="${1%/}"
	local target source fstype

	eggs_liveroot_prereq_check || return 1

	while read -r target source fstype _; do
		[[ -n "$target" && -n "$source" ]] || continue
		[[ "$target" == "$root" || "$target" == "$root"/* ]] || continue
		[[ "$source" == "$root" || "$source" == "$root"/* ]] && continue
		printf '%s|%s|%s\n' "$target" "$source" "$fstype"
	done < <(
		"$FINDMNT" -rn -o TARGET,SOURCE,FSTYPE 2>/dev/null |
			"$AWK" -v r="$root" '$1 == r || index($1, r "/") == 1 { print }'
	)
}

eggs_liveroot_has_host_bind_mounts() {
	local root="$1"
	eggs_liveroot_list_host_bind_mounts "$root" 2>/dev/null | "$GREP" -q .
}

eggs_liveroot_print_host_bind_mounts() {
	local root="$1"
	eggs_liveroot_list_host_bind_mounts "$root" | while IFS='|' read -r target source fstype; do
		[[ -n "$target" ]] || continue
		echo "    ${target} ← ${source} (${fstype})" >&2
	done
}

# True while eggs produce / mksquashfs is still using liveroot.
eggs_liveroot_produce_in_progress() {
	[[ -x "$PGREP" ]] || return 1
	"$PGREP" -f 'eggs produce|mksquashfs.*/home/eggs/liveroot' >/dev/null 2>&1
}

# Refuse destructive ops while eggs has the live system mounted under liveroot.
eggs_liveroot_assert_safe_for_mutation() {
	local root="$1"
	local op="${2:-modify}"

	eggs_liveroot_prereq_check || return 1

	if eggs_liveroot_produce_in_progress; then
		echo "ERROR: refusing to ${op} ${root} — eggs produce / mksquashfs still running." >&2
		echo "  Wait for it to finish, or if you Ctrl-C'd: reboot before any liveroot cleanup." >&2
		return 1
	fi

	if eggs_liveroot_has_host_bind_mounts "$root"; then
		echo "ERROR: refusing to ${op} ${root} — eggs bind-mounts your LIVE system there." >&2
		echo "  rm -rf ${root} through these mounts ERASES /usr, /opt, /bin on the REAL host." >&2
		echo "  Safe fix: reboot (clears eggs staging), then rerun the build script." >&2
		echo "  Do NOT run: umount -R ${root}  or  rm -rf ${root}" >&2
		eggs_liveroot_print_host_bind_mounts "$root"
		return 1
	fi

	return 0
}

# Human-readable proof it is safe to delete eggs staging only.
eggs_liveroot_print_safe_to_discard() {
	local root="$1"
	echo "  SAFE: ${root} has no live-system bind mounts (only eggs staging may be removed)"
	echo "  NOT touched: /usr /bin /opt /home/casparcg (your running system)"
}

# Refuse writing to a liveroot subpath that is a bind mount to a live system path.
eggs_liveroot_assert_path_safe_to_write() {
	local path="$1"
	local root="${2:-$(eggs_liveroot_default)}"

	[[ "$path" == "$root"* ]] || return 0
	eggs_liveroot_prereq_check || return 1
	"$FINDMNT" -T "$path" >/dev/null 2>&1 || return 0

	local source
	source="$("$FINDMNT" -n -o SOURCE -T "$path" 2>/dev/null || true)"
	[[ -n "$source" ]] || return 0
	[[ "$source" == "$root"* ]] && return 0

	echo "ERROR: refusing write to ${path} — bind mount to live ${source}" >&2
	return 1
}
