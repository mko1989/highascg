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

caspar_amcp_listening() {
	ss -tlnp 2>/dev/null | grep -qE ":${CASPAR_AMCP_PORT}\\b"
}

caspar_cmdline() {
	_pid="$1"
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
		_cmd="$(caspar_cmdline "$_pid")"
		caspar_is_main_process "$_cmd" || continue
		printf '%s\n' "$_pid"
	done | sort -u
}

caspar_kill_main_processes() {
	_sig="${1:-TERM}"
	_killed=0
	for _pid in $(caspar_list_main_pids); do
		kill -"$_sig" "$_pid" 2>/dev/null && _killed=1
	done
	return "$([ "$_killed" -eq 1 ] && echo 0 || echo 1)"
}

caspar_clear_cef_cache() {
	_cache="${CASPAR_CEF_CACHE:-$CASPAR_ROOT/cef-cache}"
	mkdir -p "$_cache"
	find "$_cache" -mindepth 1 -delete 2>/dev/null || true
	rm -rf /tmp/.org.chromium.Chromium.* /tmp/.com.google.* 2>/dev/null || true
}

# Wait until AMCP port is free before the next casparcg start.
# If the port stays busy (zombie listener / hung teardown), kill main caspar after max wait.
caspar_wait_amcp_port_free() {
	_max="${CASPAR_PORT_FREE_WAIT_SEC:-90}"
	_n=0
	while caspar_amcp_listening; do
		_n=$((_n + 1))
		if [ "$_n" -ge "$_max" ]; then
			caspar_supervisor_log "[supervisor] AMCP :${CASPAR_AMCP_PORT} still busy after ${_max}s — killing main casparcg"
			caspar_kill_main_processes TERM
			sleep 3
			caspar_kill_main_processes KILL
			sleep 2
			break
		fi
		sleep 1
	done
	_grace="${CASPAR_RESTART_GRACE_SEC:-2}"
	if [ -n "$_grace" ] && [ "$_grace" != "0" ]; then
		sleep "$_grace"
	fi
}

caspar_supervisor_running() {
	# Openbox autostart runs ./run.sh — cmdline often has no absolute path.
	for _pid in $(pgrep -f 'run\.sh' 2>/dev/null); do
		_cwd="$(readlink -f "/proc/${_pid}/cwd" 2>/dev/null || true)"
		[ "$_cwd" = "$CASPAR_ROOT" ] && return 0
	done
	pgrep -f "${CASPAR_ROOT}/run\\.sh" >/dev/null 2>&1 \
		|| pgrep -f "tools/runtime/casparcg-run\\.sh" >/dev/null 2>&1
}
