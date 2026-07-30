# Shared helpers for run.sh (POSIX sh).
# Source: . "$CASPAR_ROOT/tools/runtime/casparcg-supervisor-lib.sh"

: "${CASPAR_ROOT:=/home/casparcg/highascg}"
: "${CASPAR_AMCP_PORT:=5250}"
: "${CONFIG_PATH:=${CASPAR_CONFIG:-${CASPAR_CONFIG_PATH:-$CASPAR_ROOT/config/casparcg.config}}}"
: "${CASPAR_BIN:=${CASPAR_BIN:-$CASPAR_ROOT/bin/casparcg}}"

caspar_supervisor_log() {
	_msg="$1"
	_log="${CASPAR_SUPERVISOR_LOG:-/tmp/caspar.log}"
	printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$_msg" >>"$_log"
}

caspar_crash_state_file() {
	if [ -n "${CASPAR_CRASH_STATE:-}" ]; then
		printf '%s\n' "$CASPAR_CRASH_STATE"
		return 0
	fi
	if [ -d /run/highascg ] 2>/dev/null && [ -w /run/highascg ] 2>/dev/null; then
		printf '%s\n' "/run/highascg/caspar-crash-loop.state"
		return 0
	fi
	_home="${HOME:-}"
	if [ -z "$_home" ] || [ "$_home" = "/" ]; then
		_home="$(getent passwd "${HIGHASCG_SERVICE_USER:-casparcg}" 2>/dev/null | cut -d: -f6)"
	fi
	[ -n "$_home" ] || _home="/tmp"
	printf '%s\n' "${_home}/.cache/highascg/caspar-crash-loop.state"
}

caspar_inhibit_file() {
	if [ -n "${CASPAR_INHIBIT_FILE:-}" ]; then
		printf '%s\n' "$CASPAR_INHIBIT_FILE"
		return 0
	fi
	if [ -d /run/highascg ] 2>/dev/null && [ -w /run/highascg ] 2>/dev/null; then
		printf '%s\n' "/run/highascg/inhibit-caspar-autostart"
		return 0
	fi
	_home="${HOME:-}"
	if [ -z "$_home" ] || [ "$_home" = "/" ]; then
		_home="$(getent passwd "${HIGHASCG_SERVICE_USER:-casparcg}" 2>/dev/null | cut -d: -f6)"
	fi
	[ -n "$_home" ] || _home="/tmp"
	printf '%s\n' "${_home}/.cache/highascg/inhibit-caspar-autostart"
}

caspar_crash_is_hard_fail_code() {
	_ec="$1"
	case "$_ec" in
	134 | 139 | 136 | 11) return 0 ;;
	esac
	return 1
}

caspar_crash_loop_reset() {
	_state="$(caspar_crash_state_file)"
	rm -f "$_state" 2>/dev/null || true
}

# After rapid GPU/CEF aborts, back off and eventually stop auto-relaunch (inhibit).
caspar_crash_loop_backoff() {
	_ec="$1"
	_now="$(date +%s)"
	_window="${CASPAR_CRASH_LOOP_WINDOW_SEC:-120}"
	_max="${CASPAR_CRASH_LOOP_MAX:-6}"
	_base_sleep="${CASPAR_RESTART_SLEEP:-5}"
	_max_sleep="${CASPAR_RESTART_SLEEP_MAX:-120}"
	_giveup="${CASPAR_CRASH_LOOP_GIVEUP:-18}"
	_state="$(caspar_crash_state_file)"
	_streak=0
	_last=0
	_last_ec=0
	if [ -f "$_state" ]; then
		set -- $(cat "$_state" 2>/dev/null)
		_streak="${1:-0}"
		_last="${2:-0}"
		_last_ec="${3:-0}"
	fi
	if [ "$_last" -gt 0 ] && [ $((_now - _last)) -le "$_window" ]; then
		_streak=$((_streak + 1))
	else
		_streak=1
	fi
	mkdir -p "$(dirname "$_state")" 2>/dev/null || true
	printf '%s %s %s\n' "$_streak" "$_now" "$_ec" >"$_state" 2>/dev/null || true

	if [ "$_streak" -ge "$_giveup" ]; then
		_inhibit="$(caspar_inhibit_file)"
		mkdir -p "$(dirname "$_state")" "$(dirname "$_inhibit")" 2>/dev/null || true
		printf '%s\n' "caspar crash loop give-up ec=${_ec} streak=${_streak} at $(date -Is)" >"$_inhibit" 2>/dev/null || true
		caspar_supervisor_log "[run.sh] crash loop give-up (${_streak} failures) — inhibiting Caspar autostart (${_inhibit})"
		return 2
	fi

	_pow=0
	if [ "$_streak" -gt 1 ]; then
		_pow=$((_streak - 1))
		[ "$_pow" -gt 6 ] && _pow=6
	fi
	_sleep=$_base_sleep
	_mult=1
	_i=0
	while [ "$_i" -lt "$_pow" ]; do
		_mult=$((_mult * 2))
		_i=$((_i + 1))
	done
	_sleep=$((_base_sleep * _mult))
	[ "$_sleep" -gt "$_max_sleep" ] && _sleep="$_max_sleep"
	if caspar_crash_is_hard_fail_code "$_ec"; then
		_extra=$((_streak * 2))
		_sleep=$((_sleep + _extra))
		[ "$_sleep" -gt "$_max_sleep" ] && _sleep="$_max_sleep"
	fi
	if [ "$_streak" -ge "$_max" ]; then
		caspar_supervisor_log "[run.sh] crash loop (${_streak}/${_max} in ${_window}s, ec=${_ec}) — backing off ${_sleep}s"
	else
		caspar_supervisor_log "[run.sh] casparcg exited ${_ec} (restart ${_streak}/${_max}), waiting ${_sleep}s"
	fi
	sleep "$_sleep"
	return 0
}

caspar_amcp_listening() {
	# WO-400: -p (process info) dropped — the grep never used it and it walks the process table.
	ss -tln 2>/dev/null | grep -qE ":${CASPAR_AMCP_PORT}\\b"
}

caspar_cmdline() {
	_pid="$1"
	[ -d "/proc/${_pid}" ] || return 0
	tr '\0' ' ' </proc/"$_pid"/cmdline 2>/dev/null || true
}

caspar_is_cef_child() {
	_cmd="$1"
	case "$_cmd" in
	*--type=*) return 0 ;;
	esac
	return 1
}

caspar_is_main_process() {
	_cmd="$1"
	case "$_cmd" in
	*"${CASPAR_BIN}"*"${CONFIG_PATH}"*) caspar_is_cef_child "$_cmd" && return 1; return 0 ;;
	*"casparcg-server"*"${CONFIG_PATH}"*) caspar_is_cef_child "$_cmd" && return 1; return 0 ;;
	esac
	return 1
}

caspar_list_main_pids() {
	for _pid in $(pgrep -f "${CASPAR_BIN}" 2>/dev/null) $(pgrep -f "casparcg-server" 2>/dev/null); do
		[ -d "/proc/${_pid}" ] || continue
		_cmd="$(caspar_cmdline "$_pid")"
		caspar_is_main_process "$_cmd" || continue
		printf '%s\n' "$_pid"
	done | sort -u
}

# All casparcg PIDs for this install (main + CEF children).
caspar_list_all_pids() {
	for _pid in $(pgrep -f "${CASPAR_BIN}" 2>/dev/null) $(pgrep -f "casparcg-server" 2>/dev/null); do
		[ -d "/proc/${_pid}" ] || continue
		_cmd="$(caspar_cmdline "$_pid")"
		case "$_cmd" in
		*"${CASPAR_ROOT}"* | *"${CONFIG_PATH}"*) printf '%s\n' "$_pid" ;;
		esac
	done | sort -u
}

caspar_any_process_running() {
	caspar_list_all_pids | grep -q .
}

# Kill main process and CEF children (user-data-dir under this CASPAR_ROOT).
caspar_kill_all_processes() {
	_sig="${1:-TERM}"
	_killed=0
	for _pid in $(caspar_list_main_pids); do
		for _child in $(pgrep -P "$_pid" 2>/dev/null); do
			kill -"$_sig" "$_child" 2>/dev/null && _killed=1
		done
		kill -"$_sig" "$_pid" 2>/dev/null && _killed=1
	done
	_cache="${CASPAR_CEF_CACHE:-$CASPAR_ROOT/cef-cache}"
	for _pid in $(pgrep -f "user-data-dir=${_cache}" 2>/dev/null); do
		kill -"$_sig" "$_pid" 2>/dev/null && _killed=1
	done
	return "$([ "$_killed" -eq 1 ] && echo 0 || echo 1)"
}

caspar_clear_cef_cache() {
	if caspar_any_process_running; then
		caspar_supervisor_log "[supervisor] skip cef-cache clear — casparcg still running"
		return 1
	fi
	_cache="${CASPAR_CEF_CACHE:-$CASPAR_ROOT/cef-cache}"
	mkdir -p "$_cache"
	find "$_cache" -mindepth 1 -delete 2>/dev/null || true
	rm -rf /tmp/.org.chromium.Chromium.* /tmp/.com.google.* 2>/dev/null || true
	return 0
}

# Port may be free while the main process is hung mid-RESTART teardown.
caspar_ensure_fully_stopped() {
	caspar_wait_amcp_port_free
	if ! caspar_any_process_running; then
		return 0
	fi
	caspar_supervisor_log "[supervisor] casparcg still running without AMCP — killing process tree"
	caspar_kill_all_processes TERM
	sleep 2
	caspar_kill_all_processes KILL
	sleep 1
}

# Wait until AMCP port is free before the next casparcg start.
caspar_wait_amcp_port_free() {
	_max="${CASPAR_PORT_FREE_WAIT_SEC:-30}"
	_n=0
	while caspar_amcp_listening; do
		_n=$((_n + 1))
		if [ "$_n" -ge "$_max" ]; then
			if caspar_list_main_pids | grep -q . && [ "${CASPAR_KILL_FAST:-}" != "1" ]; then
				caspar_supervisor_log "[supervisor] AMCP :${CASPAR_AMCP_PORT} still busy with live casparcg after ${_max}s — skip kill (duplicate supervisor or adopt path)"
				break
			fi
			caspar_supervisor_log "[supervisor] AMCP :${CASPAR_AMCP_PORT} still busy after ${_max}s — killing casparcg tree"
			caspar_kill_all_processes TERM
			sleep 3
			caspar_kill_all_processes KILL
			sleep 2
			break
		fi
		sleep 1
	done
	# WO-400: the restart grace used to be slept HERE as well as in run.sh's loop (two sleeps
	# per relaunch, with the WO-337 one-shot skip flag coordinated across both files). run.sh
	# owns the grace now — this helper only guarantees the port is free.
}
