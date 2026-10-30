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

# A newline (or a backslash-newline continuation) never belongs in an rsync command line.
case "$cmd" in
	*$'\n'*|*$'\r'*) die "forbidden metacharacters" ;;
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

# WO-830b: the ONLY options the replication code makes rsync send to the receiving side (captured from
# rsync 3.4.1 for sync-project-media-rsync.js rsyncArgs push/pull and the testReplicationSshToPeer probe):
#   push       rsync --server -vlogDtprRze.iLsfxCIvu --mkpath . <root>/media/
#   pull       rsync --server --sender -vlogDtprze.iLsfxCIvu . <root>/media/x/
#   dry probe  rsync --server --sender -vnlogDtprze.iLsfxCIvu . <root>/media/
# Short options are the -a/-v/-n/-z/-R letters plus rsync's own `e.<capability letters>` trailer; long options are
# --server, --sender, --mkpath. Anything else (--daemon, --config=, --log-file=, -T, -f, --rsh, ...) used to pass
# through and let the peer read or write any file as casparcg.
validate_option() {
	local tok="$1"
	case "$tok" in
		--server | --sender | --mkpath) return 0 ;;
	esac
	[[ "$tok" =~ ^-[vnlogDtprRz]+e\.[A-Za-z]*$ ]] && return 0
	die "disallowed rsync option: $tok"
}

validate_token() {
	local tok="$1"
	[[ -n "$tok" ]] || return 0
	[[ "$tok" == "." ]] && return 0
	# WO-830b: options never reach here — they are allow-listed by validate_option; a path may not start with '-'.
	case "$tok" in
		media|media/*|template|template/*) return 0 ;;
	esac
	if [[ "$tok" == /* ]]; then
		under_allowed_root "$tok" || die "path not under media/ or template/: $tok"
		return 0
	fi
	die "disallowed path token: $tok"
}

# Split the command line into words the way sshd's shell would for what rsync sends: rsync >= 3.2.4 backslash-escapes
# every special character of a remote path ("Tlo\ Orange\ Ball/BAZA\ 2.mp4", WO-724), so an escaped character is a
# literal part of its word and an unescaped space ends a word. Unescaped shell metacharacters and quotes are refused
# as before; nothing here is ever evaluated by a shell (rsync is exec'd with the words), so an ESCAPED one is just a
# character of a file name. Option words may not contain escapes at all (options stay exactly what they were); path
# words are checked below on their real (unescaped) text.
argv=()
escaped=()
split_words() {
	local s="$1" w="" c i n=${#1} have=0 esc=0
	for ((i = 0; i < n; i++)); do
		c="${s:i:1}"
		case "$c" in
			\\)
				((i + 1 < n)) || die "trailing backslash"
				i=$((i + 1))
				w+="${s:i:1}"
				have=1
				esc=1
				;;
			' ')
				if ((have)); then
					argv+=("$w")
					escaped+=("$esc")
				fi
				w=""
				have=0
				esc=0
				;;
			\;|\||\&|\`|\$|\<|\>|\(|\)|\'|\"|$'\t') die "forbidden metacharacters" ;;
			*)
				w+="$c"
				have=1
				;;
		esac
	done
	if ((have)); then
		argv+=("$w")
		escaped+=("$esc")
	fi
}
split_words "$cmd"
[[ "${argv[0]:-}" == "rsync" && "${argv[1]:-}" == "--server" ]] || die "forbidden command (rsync --server only)"
for ((i = 2; i < ${#argv[@]}; i++)); do
	if [[ "${argv[i]}" == -* && "${escaped[i]}" == 1 ]]; then
		die "escaped characters in an option: ${argv[i]}"
	fi
	# again on the real text: "\.\." is no ".." on the command line, but it is one in the word
	[[ "${argv[i]}" == *..* ]] && die "path traversal not allowed"
	if [[ "${argv[i]}" == -* ]]; then
		validate_option "${argv[i]}"
	else
		validate_token "${argv[i]}"
	fi
done

RSYNC_BIN="$(command -v rsync || echo /usr/bin/rsync)"
exec "$RSYNC_BIN" "${argv[@]:1}"
