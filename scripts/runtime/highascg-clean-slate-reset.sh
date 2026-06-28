#!/usr/bin/env bash
# Mount-aware internal media wipe for clean-slate reset (WO-69).
# Never deletes bridge/USB bind mounts (media/bridge, media/exfat, media/drive).
#
# Usage:
#   bash scripts/runtime/highascg-clean-slate-reset.sh [--dry-run] [--yes]
#   HIGHASCG_ROOT=/home/casparcg/highascg bash scripts/runtime/highascg-clean-slate-reset.sh --yes
#
set -euo pipefail

REPO_ROOT="${HIGHASCG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
MEDIA_ROOT="${HIGHASCG_MEDIA_ROOT:-${REPO_ROOT}/media}"
DRY_RUN=0
ASSUME_YES=0

for arg in "$@"; do
	case "$arg" in
		--dry-run) DRY_RUN=1 ;;
		--yes|-y) ASSUME_YES=1 ;;
		-h|--help)
			echo "Usage: $0 [--dry-run] [--yes]"
			exit 0
			;;
		*) echo "Unknown arg: $arg" >&2; exit 2 ;;
	esac
done

if [[ ! -d "$MEDIA_ROOT" ]]; then
	echo '{"ok":true,"mediaDeleted":0,"mediaSkipped":0,"note":"media root missing"}'
	exit 0
fi

if [[ "$ASSUME_YES" != "1" && "$DRY_RUN" != "1" ]]; then
	echo "Refusing to delete media without --yes or --dry-run" >&2
	exit 1
fi

if ! command -v findmnt >/dev/null 2>&1; then
	echo '{"ok":false,"error":"findmnt missing — media phase aborted for safety"}' >&2
	exit 1
fi

ROOT_DEV="$(stat -c %d "$REPO_ROOT")"
MEDIA_DEV="$(stat -c %d "$MEDIA_ROOT")"
if [[ "$ROOT_DEV" != "$MEDIA_DEV" ]]; then
	echo "{\"ok\":true,\"mediaDeleted\":0,\"mediaSkipped\":0,\"note\":\"media root on foreign device\"}"
	exit 0
fi

# Always skip known external bind targets (WO-52 / WO-47).
declare -a SKIP_PREFIXES=(
	"${MEDIA_ROOT}/bridge"
	"${MEDIA_ROOT}/exfat"
	"${MEDIA_ROOT}/drive"
	"/home/casparcg/bridge"
	"/home/casparcg/exfat"
)

is_under_skip_prefix() {
	local p="$1"
	for pref in "${SKIP_PREFIXES[@]}"; do
		[[ "$p" == "$pref" || "$p" == "$pref/"* ]] && return 0
	done
	return 1
}

# True only when path is itself a mount point (not merely "on a filesystem").
is_mount_point() {
	local p="$1"
	local target
	target="$(findmnt -T -n -o TARGET "$p" 2>/dev/null || true)"
	[[ -n "$target" && "$target" == "$p" ]]
}

is_protected() {
	local p="$1"
	if is_under_skip_prefix "$p"; then
		return 0
	fi
	if is_mount_point "$p"; then
		return 0
	fi
	local dev
	dev="$(stat -c %d "$p" 2>/dev/null || echo "")"
	if [[ -n "$dev" && "$dev" != "$ROOT_DEV" ]]; then
		return 0
	fi
	return 1
}

deleted=0
skipped=0

delete_path() {
	local p="$1"
	if is_protected "$p"; then
		skipped=$((skipped + 1))
		return
	fi
	if [[ "$DRY_RUN" == "1" ]]; then
		echo "dry-run delete: $p" >&2
		deleted=$((deleted + 1))
		return
	fi
	if [[ -d "$p" ]]; then
		rm -rf "$p"
	else
		rm -f "$p"
	fi
	deleted=$((deleted + 1))
}

# Depth-first: children before parents; skip protected top-level mounts.
while IFS= read -r -d '' entry; do
	[[ "$entry" == "$MEDIA_ROOT" ]] && continue
	delete_path "$entry"
done < <(find "$MEDIA_ROOT" -mindepth 1 -depth -print0 2>/dev/null || true)

printf '{"ok":true,"mediaDeleted":%s,"mediaSkipped":%s,"dryRun":%s}\n' \
	"$deleted" "$skipped" "$DRY_RUN"
