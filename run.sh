#!/bin/sh
# CasparCG playout supervisor — one instance, relaunch on AMCP RESTART exit codes.
#
#   CASPAR_ROOT, CASPAR_LIB, CASPAR_BIN, CASPAR_CONFIG_PATH — paths (systemd sets these)
#   DISPLAY, XAUTHORITY — required for screen consumers on :0
#
# Optional:
#   CASPAR_RESTART_EXIT_CODES   default: 5 139 1 134 0 (systemd); +137 143 130 without CASPAR_SYSTEMD_SERVICE=1
#   CASPAR_RESPAWN=1            relaunch after any exit (debug)
#   CASPAR_RESTART_GRACE_SEC    pause before start (default 2)
#   CASPAR_RESTART_SLEEP        crash-backoff base sleep (default 5; doubles per streak, cap CASPAR_RESTART_SLEEP_MAX 120)
#   CASPAR_CRASH_LOOP_WINDOW_SEC / _MAX / _GIVEUP   crash-streak window 120 / warn 6 / inhibit+stop 18
#   CASPAR_HANG_SEC             kill if AMCP drops after it was up (default 90)
#   CASPAR_BOOT_HANG_SEC        kill if AMCP never comes up (default 180)
#   CASPAR_PORT_FREE_WAIT_SEC   wait for :5250 before start (default 30)
#
set -f

CASPAR_ROOT="${CASPAR_ROOT:-/home/casparcg/highascg}"
CASPAR_LIB="${CASPAR_LIB:-$CASPAR_ROOT/lib}"
export LD_LIBRARY_PATH="$CASPAR_LIB"
unset LD_PRELOAD
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-/home/casparcg/.Xauthority}"

# WO-407/WO-444: optional BOX-LOCAL caspar env (not in the repo — Syncthing peers unaffected).
# e.g. CASPAR_GL_SYNC_DISPLAY=DP-0 gates GL swaps on the PGM display's vblank instead of
# the driver-default head (multi-head X screen: the other head beats → micro-stutter).
# The file is rewritten on every config Apply, so it is sourced PER CASPAR LAUNCH inside
# run_caspar() — sourcing only here at supervisor start meant an Apply-time change never
# reached the relaunched binary until the whole service restarted (WO-444).
source_caspar_env() {
	# Clear first so a line REMOVED from the file also clears the exported var.
	unset CASPAR_GL_SYNC_DISPLAY
	[ -r "${HOME:-/home/casparcg}/.config/highascg/caspar-env" ] && . "${HOME:-/home/casparcg}/.config/highascg/caspar-env"
	if [ -n "${CASPAR_GL_SYNC_DISPLAY:-}" ]; then
		export __GL_SYNC_DISPLAY_DEVICE="$CASPAR_GL_SYNC_DISPLAY"
	else
		unset __GL_SYNC_DISPLAY_DEVICE
	fi
}
source_caspar_env

CONFIG_PATH="${CASPAR_CONFIG:-${CASPAR_CONFIG_PATH:-$CASPAR_ROOT/config/casparcg.config}}"
CASPAR_BIN="${CASPAR_BIN:-$CASPAR_ROOT/bin/casparcg}"

exec 9>>"${CASPAR_RUNSH_LOCK:-/tmp/caspar-runsh.lock}"
flock -n 9 || exit 0

# shellcheck source=casparcg-supervisor-lib.sh
. "${CASPAR_ROOT}/tools/runtime/casparcg-supervisor-lib.sh"

_inhibit="${CASPAR_INHIBIT_FILE:-}"
if [ -z "$_inhibit" ]; then
	_inhibit="$(caspar_inhibit_file 2>/dev/null || echo /run/highascg/inhibit-caspar-autostart)"
fi
if [ -f "$_inhibit" ]; then
	caspar_supervisor_log "[run.sh] inhibited ($_inhibit)"
	exit 0
fi

if [ ! -x "$CASPAR_BIN" ]; then
	caspar_supervisor_log "[run.sh] missing or not executable: $CASPAR_BIN"
	exit 127
fi
if [ ! -f "$CONFIG_PATH" ]; then
	caspar_supervisor_log "[run.sh] missing config: $CONFIG_PATH"
	exit 66
fi

if [ "${CASPAR_SYSTEMD_SERVICE:-0}" = "1" ]; then
	# Include 0: X session loss (nodm restart) can exit casparcg cleanly; still relaunch.
	RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139 1 134 0}"
else
	RESTART_CODES="${CASPAR_RESTART_EXIT_CODES:-5 139 1 134 137 143 130}"
fi

is_restart_code() {
	_ec="$1"
	for _c in $RESTART_CODES; do
		[ "$_c" = "$_ec" ] && return 0
	done
	return 1
}

should_relaunch() {
	_ec="$1"
	[ "${CASPAR_RESPAWN:-0}" = "1" ] && return 0
	is_restart_code "$_ec"
}

run_caspar() {
	source_caspar_env
	# WO-508: the flock at the top guards against a second run.sh, NOT against a second casparcg.
	# A binary started outside the supervisor — by hand, or a survivor of a previous boot — was never
	# noticed, and this launched a second MAIN alongside it. Two mains cannot coexist: they fight for
	# AMCP :5250, the DeckLink cards and the screen consumers, and the loser exiting non-zero puts the
	# unit into a restart loop.
	#
	# caspar_list_main_pids() already excludes CEF children (they carry --type=), so this counts real
	# mains only — the pgrep-self-match false alarm from WO-407 is handled there, not re-invented here.
	#
	# Wait briefly first: on a supervisor relaunch the pid we see is usually our own just-exited child
	# still being reaped, and refusing on that would break every legitimate restart.
	_wait=0
	while [ "$_wait" -lt 50 ]; do
		[ -z "$(caspar_list_main_pids)" ] && break
		_wait=$((_wait + 1))
		sleep 0.1
	done
	# Confirm each candidate by /proc/<pid>/exe before acting on it. caspar_list_main_pids() matches on
	# the COMMAND LINE, so any process that merely mentions both the binary and the config path — a
	# shell running a caspar command, an editor, this script's own tooling — is reported as a main.
	# That is the WO-407 self-match false alarm, and it is measurable: a shell with both paths in its
	# argv lands in that list. Pattern-matching is fine for a kill sweep; it is NOT good enough to
	# refuse a launch on, because a false positive here leaves the box dark.
	_stray=''
	for _p in $(caspar_list_main_pids); do
		[ "$_p" = "$$" ] && continue
		_exe="$(readlink -f "/proc/$_p/exe" 2>/dev/null || true)"
		[ "$_exe" = "$(readlink -f "$CASPAR_BIN" 2>/dev/null || echo "$CASPAR_BIN")" ] || continue
		_stray="$_stray$_p "
	done
	if [ -n "${_stray% }" ]; then
		# Deliberately refuse rather than kill: that other process may be the one currently ON AIR.
		# Exiting non-zero lets systemd back off (RestartSec) and puts the reason in the journal.
		caspar_supervisor_log "[run.sh] REFUSING to launch — a casparcg main process is already running (pid(s): ${_stray% }). Only one instance may run; stop it first (systemctl stop casparcg-server) or kill it by hand."
		exit 3
	fi
	"$CASPAR_BIN" "$CONFIG_PATH" "$@" </dev/null &
	_child=$!
	_saw_amcp=0
	_stuck=0
	# WO-398: the hang detector used to fork ss+grep+sleep EVERY second forever (~260k
	# forks/day) for a 90 s reaction budget. Healthy steady state now checks every 10 s;
	# while a stall is being counted (and during boot) it stays at 1 s. `_stuck` counts
	# SECONDS (the interval just slept), so detection latency stays within CASPAR_HANG_SEC
	# (+ at most one healthy 10 s window).
	_poll=1
	while kill -0 "$_child" 2>/dev/null; do
		if caspar_amcp_listening; then
			_saw_amcp=1
			_stuck=0
			_poll=10
		else
			_stuck=$((_stuck + _poll))
			_poll=1
			if [ "$_saw_amcp" -eq 1 ]; then
				_limit="${CASPAR_HANG_SEC:-90}"
			else
				_limit="${CASPAR_BOOT_HANG_SEC:-180}"
			fi
			if [ "$_stuck" -ge "$_limit" ]; then
				caspar_supervisor_log "[run.sh] hang (${_limit}s, amcp_seen=${_saw_amcp}) — stopping"
				caspar_kill_all_processes TERM
				sleep 2
				caspar_kill_all_processes KILL
				wait "$_child" 2>/dev/null
				return 5
			fi
		fi
		sleep "$_poll"
	done
	wait "$_child" 2>/dev/null
	return $?
}

while :; do
	if [ -f "$_inhibit" ]; then
		caspar_supervisor_log "[run.sh] inhibited — exit"
		exit 0
	fi

	caspar_wait_amcp_port_free

	# Single grace site (WO-400 — the lib no longer sleeps its own copy of this grace).
	_grace="${CASPAR_RESTART_GRACE_SEC:-2}"
	# WO-337 #3: consume the one-shot operator fast-relaunch flag (set at the marker check below).
	if [ "${CASPAR_SKIP_GRACE_ONCE:-}" = "1" ]; then
		_grace=0
		CASPAR_SKIP_GRACE_ONCE=""
	fi
	if [ -n "$_grace" ] && [ "$_grace" != "0" ]; then
		sleep "$_grace"
	fi

	ec=0
	run_caspar "$@" || ec=$?

	if ! should_relaunch "$ec"; then
		exit "$ec"
	fi

	caspar_ensure_fully_stopped

	# Hard-fail list lives in ONE place now (WO-400) — the old inline `case 134|139` had
	# drifted from the lib's 134/139/136/11.
	if caspar_crash_is_hard_fail_code "$ec"; then
		caspar_clear_cef_cache
	fi

	# WO-337 #3: an operator-initiated apply (node writes the marker just before its kill/RESTART)
	# gets a fast relaunch and skips crash damping — it is not a crash. Stale markers (>120s) ignored.
	_marker="/tmp/caspar-operator-restart"
	CASPAR_SKIP_GRACE_ONCE=""
	if [ -f "$_marker" ] && [ $(($(date +%s) - $(stat -c %Y "$_marker" 2>/dev/null || echo 0))) -le 120 ]; then
		rm -f "$_marker"
		CASPAR_SKIP_GRACE_ONCE=1
		caspar_supervisor_log "[run.sh] operator restart marker — fast relaunch (sleep 1s, grace skipped)"
		sleep 1
		continue
	fi

	# ONE damping engine (WO-400): caspar_crash_loop_backoff logs, sleeps with exponential
	# backoff, and at give-up WRITES THE INHIBIT FILE and returns non-zero — so a permanently
	# crashing Caspar actually STOPS autostarting. The old inline `_restarts` counter exited
	# instead, which systemd Restart=on-failure relaunched 10s later with a fresh counter —
	# the give-up never held.
	if ! caspar_crash_loop_backoff "$ec"; then
		exit "$ec"
	fi
done
