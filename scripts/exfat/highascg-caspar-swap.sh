#!/usr/bin/env bash
# WO-1022 — install the Caspar build a server release carries (caspar/bin/casparcg, pinned by caspar/PINNED.json).
#
# Usage:
#   highascg-caspar-swap.sh plan     [--root DIR]            what apply would do; changes nothing
#   highascg-caspar-swap.sh apply    [--root DIR] [--user NAME] [--verify none|inline|detach]
#   highascg-caspar-swap.sh verify   [--root DIR] [--detach] wait for the pinned VERSION; roll back if Caspar never shows it
#   highascg-caspar-swap.sh rollback [--root DIR]            put the binary from before the last swap back
#
# apply: when <root>/caspar/bin/casparcg differs (sha256) from <root>/bin/casparcg it checks the candidate against the
# box's own lib/ (ldd, and the libcef.so sha256 the pin names); any unresolved library → no swap, the reason is logged
# and written to bin/caspar-swap.state. Otherwise: hard link bin/casparcg → bin/casparcg.pre-<stamp> (and
# bin/casparcg.prev; the old .prev becomes .prev.old), copy the candidate to bin/casparcg.new, mv -f it over
# bin/casparcg, and restart casparcg-server.service if it was running (at boot it is not started yet).
#
# Policy: the release wins. A box keeps a hand-swapped Caspar only while ~casparcg/.highascg/caspar-hold exists. A build
# that was rolled back is not tried again until bin/caspar-swap.state is deleted (a live stick would retry every boot).
#
# verify: reads Caspar's VERSION from node (GET /api/state → caspar.versionLine; node asks VERSION on every connect).
# It never opens a socket to Caspar :5250 itself (a connect+reset killed the AMCP acceptor, WO-990). The clock starts
# when a casparcg process runs (the boot screen gate can hold Caspar for minutes); if Caspar has run for
# HIGHASCG_CASPAR_VERIFY_UP_SEC (180) and node answered but never reported the pinned sha → rollback. If node never
# answered or Caspar never ran within HIGHASCG_CASPAR_VERIFY_MAX_SEC (900) → "unverified", the new binary stays.
#
# Test hooks (env): HIGHASCG_CASPAR_SYSTEMCTL (default systemctl, "sudo -n systemctl" when not root),
# HIGHASCG_CASPAR_VERSION_PROBE (command printing the running version line, exit 2 = node did not answer),
# HIGHASCG_CASPAR_RUNNING_CMD (exit 0 while a casparcg process runs), HIGHASCG_CASPAR_GATE_CMD (exit 0 once the boot
# screen gate is released; then a Caspar that never runs within UP_SEC is rolled back too), HIGHASCG_CASPAR_HOLD,
# HIGHASCG_CASPAR_VERIFY_POLL_SEC, HIGHASCG_HTTP_PORT, HIGHASCG_CASPAR_SWAP_LOG_DIR.
set -euo pipefail

SELF="$(readlink -f "${BASH_SOURCE[0]}")"
ROOT="${HIGHASCG_CASPAR_SWAP_ROOT:-/home/casparcg/highascg}"
USER_NAME="${HIGHASCG_SERVICE_USER:-casparcg}"
CASPAR_UNIT=casparcg-server.service
NODE_UNIT=highascg.service
POLL="${HIGHASCG_CASPAR_VERIFY_POLL_SEC:-5}"
UP_SEC="${HIGHASCG_CASPAR_VERIFY_UP_SEC:-180}"
MAX_SEC="${HIGHASCG_CASPAR_VERIFY_MAX_SEC:-900}"
PORT="${HIGHASCG_HTTP_PORT:-4200}"
KEEP_PRE=3

log() { echo "[highascg-caspar-swap] $*" >&2; }

if [[ -n "${HIGHASCG_CASPAR_SYSTEMCTL:-}" ]]; then
	read -r -a SYSTEMCTL <<<"$HIGHASCG_CASPAR_SYSTEMCTL"
elif [[ "$EUID" -eq 0 ]]; then
	SYSTEMCTL=(systemctl)
else
	SYSTEMCTL=(sudo -n systemctl) # casparcg may restart casparcg-server.service without a password (sudoers)
fi

user_home() { getent passwd "$USER_NAME" 2>/dev/null | cut -d: -f6 || true; }
hold_file() {
	if [[ -n "${HIGHASCG_CASPAR_HOLD:-}" ]]; then
		echo "$HIGHASCG_CASPAR_HOLD"
	else
		echo "$(user_home)/.highascg/caspar-hold"
	fi
}

# PINNED.json is written one key per line (by the WO-1022 publish script in tools/release/), so a top-level string reads with sed.
pin_get() { sed -n "s/^[[:space:]]*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$PIN" | head -n 1; }
sha256() { sha256sum "$1" | cut -d' ' -f1; }

STATE_KEYS=(result reason pinned version candidate previous backup at)
state_file() { echo "${ROOT}/bin/caspar-swap.state"; }
state_get() { [[ -f "$(state_file)" ]] && sed -n "s/^$1=//p" "$(state_file)" | head -n 1 || true; }
# state_set key=value … — rewrites the whole file, keeping keys not named here.
state_set() {
	local f tmp k v kv
	f="$(state_file)"
	tmp="${f}.tmp"
	mkdir -p "$(dirname "$f")"
	declare -A cur=()
	for k in "${STATE_KEYS[@]}"; do cur[$k]="$(state_get "$k")"; done
	for kv in "$@"; do cur[${kv%%=*}]="${kv#*=}"; done
	cur[at]="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
	: >"$tmp"
	for k in "${STATE_KEYS[@]}"; do
		v="${cur[$k]}"
		[[ -n "$v" ]] && printf '%s=%s\n' "$k" "${v//$'\n'/ }" >>"$tmp"
	done
	mv -f "$tmp" "$f"
	[[ "$EUID" -eq 0 ]] && chown "${USER_NAME}:" "$f" 2>/dev/null || true
}

setup_paths() {
	BIN="${ROOT}/bin/casparcg"
	CAND="${ROOT}/caspar/bin/casparcg"
	PIN="${ROOT}/caspar/PINNED.json"
	LIB="${ROOT}/lib"
}

unit_active() { "${SYSTEMCTL[@]}" is-active --quiet "$1" 2>/dev/null; }

# ldd as the service user (the binary is run by it, never by root); "not found" lines → stdout.
unresolved_libs() {
	local -a run=()
	[[ "$EUID" -eq 0 ]] && command -v runuser >/dev/null 2>&1 && getent passwd "$USER_NAME" >/dev/null &&
		run=(runuser -u "$USER_NAME" --)
	"${run[@]}" env LD_LIBRARY_PATH="$LIB" ldd "$CAND" 2>&1 | grep -E 'not found|not a dynamic' || true
}

# → prints "swap" or "skip <reason>" / "current <reason>"; never changes anything.
decide() {
	[[ -f "$PIN" ]] || { echo "current no caspar/PINNED.json in this tree"; return; }
	[[ -f "$CAND" ]] || { echo "current the tree carries no Caspar (caspar/bin/casparcg)"; return; }
	local want got short
	want="$(pin_get binarySha256)"
	short="$(pin_get shortSha)"
	got="$(sha256 "$CAND")"
	[[ -n "$want" && "$got" == "$want" ]] || {
		echo "skip caspar/bin/casparcg sha256 ${got:0:12} is not the pinned ${want:0:12}"
		return
	}
	if [[ -f "$BIN" && "$(sha256 "$BIN")" == "$want" ]]; then
		echo "current bin/casparcg is already the pinned ${short}"
		return
	fi
	local hold
	hold="$(hold_file)"
	[[ -e "$hold" ]] && { echo "skip held by ${hold} (a hand-tested Caspar stays; delete the file to follow releases)"; return; }
	if [[ "$(state_get result)" == "rolled-back" && "$(state_get candidate)" == "$want" ]]; then
		echo "skip ${short} was rolled back on $(state_get at) ($(state_get reason)); delete bin/caspar-swap.state to retry"
		return
	fi
	local missing
	missing="$(unresolved_libs | sed 's/^[[:space:]]*//' | tr '\n' ';')"
	[[ -z "$missing" ]] || { echo "skip unresolved libraries against ${LIB}: ${missing}"; return; }
	local cef_want cef_got
	cef_want="$(pin_get libcefSha256)"
	if [[ -n "$cef_want" ]]; then
		cef_got="$([[ -f "${LIB}/libcef.so" ]] && sha256 "${LIB}/libcef.so" || echo missing)"
		[[ "$cef_got" == "$cef_want" ]] || {
			echo "skip lib/libcef.so ${cef_got:0:12} is not the CEF the build needs ($(pin_get cefVersion), ${cef_want:0:12})"
			return
		}
	fi
	echo "swap bin/casparcg → pinned $(pin_get version)"
}

prune_pre() {
	local -a pre=() olds=()
	local f
	for f in "${ROOT}"/bin/casparcg.pre-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z; do
		[[ -f "$f" ]] && pre+=("$(basename "$f")")
	done
	((${#pre[@]} > KEEP_PRE)) || return 0
	mapfile -t olds < <(printf '%s\n' "${pre[@]}" | sort -r | tail -n +$((KEEP_PRE + 1)))
	for f in "${olds[@]}"; do rm -f "${ROOT}/bin/${f}" && log "pruned bin/${f}"; done
}

link_or_copy() { ln -f "$1" "$2" 2>/dev/null || cp -p "$1" "$2"; }

restart_caspar() {
	log "restarting ${CASPAR_UNIT}"
	"${SYSTEMCTL[@]}" restart "$CASPAR_UNIT" || log "WARN: restart ${CASPAR_UNIT} failed"
}

# OSC float endianness is latched per node process (WO-613): node must restart after Caspar changes binary.
restart_node() {
	unit_active "$NODE_UNIT" || return 0
	if [[ "$EUID" -eq 0 || -n "${HIGHASCG_CASPAR_SYSTEMCTL:-}" ]]; then
		"${SYSTEMCTL[@]}" restart "$NODE_UNIT" || true
	else
		local pid
		pid="$(systemctl show -p MainPID --value "$NODE_UNIT" 2>/dev/null || echo 0)"
		[[ "$pid" =~ ^[0-9]+$ && "$pid" -gt 1 ]] && kill -TERM "$pid" || true
	fi
	log "restarted ${NODE_UNIT} (OSC latch)"
}

cmd_plan() {
	local d
	d="$(decide)"
	echo "$d"
}

cmd_apply() {
	local verify=none
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--verify) verify="${2:?}"; shift 2 ;;
		*) log "unknown option: $1"; exit 2 ;;
		esac
	done
	local d
	d="$(decide)"
	case "$d" in
	current*) log "${d#current }"; return 0 ;;
	skip*)
		log "NOT swapping: ${d#skip }"
		# A rolled-back build keeps its "rolled-back" record (that is what blocks the retry).
		[[ "$(state_get result)" == "rolled-back" && "$d" == *"was rolled back"* ]] ||
			state_set result=skipped "reason=${d#skip }" "pinned=$(pin_get shortSha)" "candidate=$(pin_get binarySha256)"
		return 0
		;;
	esac
	local stamp backup prev_sha
	stamp="$(date -u +%Y%m%dT%H%M%SZ)"
	backup=""
	mkdir -p "${ROOT}/bin"
	if [[ -f "$BIN" ]]; then
		backup="${ROOT}/bin/casparcg.pre-${stamp}"
		prev_sha="$(sha256 "$BIN")"
		link_or_copy "$BIN" "$backup"
		[[ -f "${ROOT}/bin/casparcg.prev" ]] && mv -f "${ROOT}/bin/casparcg.prev" "${ROOT}/bin/casparcg.prev.old"
		link_or_copy "$backup" "${ROOT}/bin/casparcg.prev"
	fi
	cp -f "$CAND" "${BIN}.new"
	chmod 0755 "${BIN}.new"
	mv -f "${BIN}.new" "$BIN"
	[[ "$EUID" -eq 0 ]] && chown "${USER_NAME}:" "$BIN" ${backup:+"$backup"} "${ROOT}/bin/casparcg.prev" 2>/dev/null || true
	log "swapped bin/casparcg → $(pin_get version) (backup ${backup:-none}, rollback: $(basename "$SELF") rollback)"
	state_set result=swapped "reason=" "pinned=$(pin_get shortSha)" "version=$(pin_get version)" \
		"candidate=$(pin_get binarySha256)" "previous=${prev_sha:-}" "backup=${backup}"
	prune_pre
	if unit_active "$CASPAR_UNIT"; then
		restart_caspar
		# node started before this swap (not the update path: that stops node first) holds the old OSC latch
		restart_node
	else
		log "${CASPAR_UNIT} not running — the new binary starts with it"
	fi
	case "$verify" in
	inline) cmd_verify ;;
	detach) cmd_verify --detach ;;
	esac
}

# Prints the running Caspar version line (empty when node has no Caspar connection); exit 2 when node did not answer.
probe_version() {
	if [[ -n "${HIGHASCG_CASPAR_VERSION_PROBE:-}" ]]; then
		bash -c "$HIGHASCG_CASPAR_VERSION_PROBE"
		return
	fi
	local body
	body="$(curl -s -m 5 "http://127.0.0.1:${PORT}/api/state" 2>/dev/null)" || return 2
	[[ -n "$body" ]] || return 2
	printf '%s' "$body" | node -e '
		let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
			try { const c = JSON.parse(s).caspar || {}; process.stdout.write(c.connected && c.versionLine ? String(c.versionLine) : "") }
			catch { process.exit(2) }
		})' 2>/dev/null || return 2
}

caspar_running() {
	if [[ -n "${HIGHASCG_CASPAR_RUNNING_CMD:-}" ]]; then
		bash -c "$HIGHASCG_CASPAR_RUNNING_CMD"
		return
	fi
	pgrep -x casparcg >/dev/null 2>&1
}

# WO-638 boot screen gate released for this boot (run.sh starts Caspar only after it; node writes the boot id).
# After a web-UI update it is already released, so a binary that dies at once (pgrep never sees it) is caught too.
gate_released() {
	if [[ -n "${HIGHASCG_CASPAR_GATE_CMD:-}" ]]; then
		bash -c "$HIGHASCG_CASPAR_GATE_CMD"
		return
	fi
	local b
	b="$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || true)"
	[[ -n "$b" && "$(cat "$(user_home)/.highascg/run/caspar-screens-ready" 2>/dev/null)" == "$b" ]]
}

detach_verify() {
	command -v systemd-run >/dev/null 2>&1 && [[ "$EUID" -eq 0 ]] || {
		log "cannot detach (needs root + systemd-run) — verify later: $(basename "$SELF") verify"
		return 0
	}
	local stamp unit dir logfile
	stamp="$(date -u +%Y%m%dT%H%M%SZ)"
	unit="highascg-caspar-verify-${stamp}"
	dir="${HIGHASCG_CASPAR_SWAP_LOG_DIR:-/var/log/highascg}"
	install -d -m 0755 "$dir"
	logfile="${dir}/caspar-swap-${stamp}.log"
	: >"$logfile"
	systemd-run --unit="$unit" --collect --no-block --description="HighAsCG Caspar swap check ${stamp}" \
		--property=StandardOutput="append:${logfile}" --property=StandardError="append:${logfile}" \
		"$SELF" verify --root "$ROOT" >/dev/null 2>&1 || {
		log "WARN: could not start ${unit}"
		return 0
	}
	log "verify detached into ${unit}; log: ${logfile}"
}

cmd_verify() {
	if [[ "${1:-}" == "--detach" ]]; then
		detach_verify
		return 0
	fi
	[[ "$(state_get result)" == "swapped" ]] || {
		log "nothing to verify (last result: $(state_get result))"
		return 0
	}
	local short want start now up_since="" gate_since="" api_seen=0 line rc
	short="$(state_get pinned)"
	want="$(state_get version)"
	start="$(date +%s)"
	log "waiting for Caspar VERSION ${short} (node :${PORT})"
	while :; do
		now="$(date +%s)"
		rc=0
		line="$(probe_version)" || rc=$?
		[[ $rc -ne 2 ]] && api_seen=1
		if [[ -n "$short" && "$line" == *"$short"* ]]; then
			log "verified: Caspar reports ${line}"
			state_set result=verified "reason=VERSION ${line}"
			return 0
		fi
		if caspar_running; then
			[[ -z "$up_since" ]] && up_since="$now"
		fi
		if [[ -n "$up_since" && $((now - up_since)) -ge "$UP_SEC" && "$api_seen" -eq 1 ]]; then
			do_rollback "Caspar ran ${UP_SEC} s and never reported ${want:-$short} (last: ${line:-no Caspar connection})"
			return 1
		fi
		if [[ -z "$up_since" && -z "$gate_since" ]] && gate_released; then
			gate_since="$now"
		fi
		if [[ -z "$up_since" && -n "$gate_since" && $((now - gate_since)) -ge "$UP_SEC" && "$api_seen" -eq 1 ]]; then
			do_rollback "the boot screen gate was released ${UP_SEC} s ago and no casparcg process ever ran (crashes at start?)"
			return 1
		fi
		if [[ $((now - start)) -ge "$MAX_SEC" ]]; then
			local why="node never answered"
			[[ -z "$up_since" ]] && why="Caspar never started"
			log "unverified after ${MAX_SEC} s (${why}) — the new binary stays; check: GET /api/state caspar.versionLine"
			state_set result=unverified "reason=${why}"
			return 0
		fi
		sleep "$POLL"
	done
}

do_rollback() {
	local why="$1" backup
	backup="$(state_get backup)"
	[[ -n "$backup" && -f "$backup" ]] || backup="${ROOT}/bin/casparcg.prev"
	if [[ ! -f "$backup" ]]; then
		log "ROLLBACK impossible: no backup (${why})"
		state_set result=rollback-failed "reason=${why}; no backup"
		return 1
	fi
	log "ROLLBACK: ${why} → $(basename "$backup")"
	cp -f "$backup" "${BIN}.new"
	chmod 0755 "${BIN}.new"
	mv -f "${BIN}.new" "$BIN"
	[[ "$EUID" -eq 0 ]] && chown "${USER_NAME}:" "$BIN" 2>/dev/null || true
	state_set result=rolled-back "reason=${why}"
	"${SYSTEMCTL[@]}" reset-failed "$CASPAR_UNIT" >/dev/null 2>&1 || true
	restart_caspar
	restart_node
}

main() {
	local cmd="${1:-}"
	[[ $# -gt 0 ]] && shift
	local -a rest=()
	while [[ $# -gt 0 ]]; do
		case "$1" in
		--root) ROOT="${2:?}"; shift 2 ;;
		--user) USER_NAME="${2:?}"; shift 2 ;;
		*) rest+=("$1"); shift ;;
		esac
	done
	setup_paths
	case "$cmd" in
	plan) cmd_plan ;;
	apply) cmd_apply "${rest[@]}" ;;
	verify) cmd_verify "${rest[@]}" ;;
	rollback)
		[[ -n "$(state_get backup)" || -f "${ROOT}/bin/casparcg.prev" ]] || { log "no backup recorded"; exit 1; }
		do_rollback "manual rollback"
		;;
	-h | --help | "") sed -n '2,28p' "$SELF" | sed 's/^# \{0,1\}//' ;;
	*) log "unknown command: $cmd"; exit 2 ;;
	esac
}

main "$@"
