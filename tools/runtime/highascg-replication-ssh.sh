#!/usr/bin/env bash
# Forced SSH command for HighAsCG replication — rsync --server only, media/ + template/.
set -euo pipefail

REPO_ROOT="${HIGHASCG_REPO_ROOT:-/home/casparcg/highascg}"
MEDIA_ROOT="${REPO_ROOT}/media"
TEMPLATE_ROOT="${REPO_ROOT}/template"

die() {
	echo "highascg-replication-ssh: $*" >&2
	exit 1
}

cmd="${SSH_ORIGINAL_COMMAND:-}"
[[ -n "$cmd" ]] || die "empty command"

case "$cmd" in
	rsync\ --server\ *) ;;
	*) die "forbidden command (rsync --server only)" ;;
esac

case "$cmd" in
	*\;*|*\|*|*\&*|*\`*|*\$*\(*|*\<*|*$'\n'*) die "forbidden metacharacters" ;;
esac

case "$cmd" in
	*..*) die "path traversal not allowed" ;;
esac

canon_path() {
	local p="$1"
	if command -v readlink >/dev/null 2>&1; then
		readlink -f "$p" 2>/dev/null || echo "$p"
	else
		echo "$p"
	fi
}

under_allowed_root() {
	local p="$1"
	local canon root
	canon="$(canon_path "$p")"
	for root in "$MEDIA_ROOT" "$TEMPLATE_ROOT"; do
		local rcanon
		rcanon="$(canon_path "$root")"
		if [[ "$canon" == "$rcanon" || "$canon" == "$rcanon/"* ]]; then
			return 0
		fi
	done
	return 1
}

validate_token() {
	local tok="$1"
	[[ -n "$tok" ]] || return 0
	[[ "$tok" == "." ]] && return 0
	[[ "$tok" == -* ]] && return 0
	case "$tok" in
		media|media/*|template|template/*) return 0 ;;
	esac
	if [[ "$tok" == /* ]]; then
		under_allowed_root "$tok" || die "path not under media/ or template/: $tok"
		return 0
	fi
	die "disallowed path token: $tok"
}

IFS=' ' read -r -a argv <<<"$cmd"
for ((i = 2; i < ${#argv[@]}; i++)); do
	validate_token "${argv[i]}"
done

RSYNC_BIN="$(command -v rsync || echo /usr/bin/rsync)"
exec "$RSYNC_BIN" "${argv[@]:1}"
