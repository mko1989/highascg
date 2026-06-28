#!/usr/bin/env bash
# Control CasparCG systemd units from HighAsCG Nuclear tab (fixed-path sudo helper).
#
# Usage:
#   caspar-systemd-control.sh status|stop|start|restart
set -euo pipefail

INHIBIT="${CASPAR_INHIBIT_FILE:-/run/highascg/inhibit-caspar-autostart}"
SERVER_UNIT="${CASPAR_SERVER_UNIT:-casparcg-server.service}"
SCANNER_UNIT="${CASPAR_SCANNER_UNIT:-casparcg-scanner.service}"
PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

unit_state() {
	local u="$1"
	if systemctl is-active --quiet "$u" 2>/dev/null; then
		echo active
	elif systemctl is-failed --quiet "$u" 2>/dev/null; then
		echo failed
	else
		echo inactive
	fi
}

ensure_stopped_processes() {
	if [[ -f "${PLAYOUT}/tools/runtime/casparcg-supervisor-lib.sh" ]]; then
		# shellcheck source=casparcg-supervisor-lib.sh
		. "${PLAYOUT}/tools/runtime/casparcg-supervisor-lib.sh"
		caspar_ensure_fully_stopped || true
	fi
}

clear_crash_loop_state() {
	if [[ -f "${PLAYOUT}/tools/runtime/casparcg-supervisor-lib.sh" ]]; then
		# shellcheck source=casparcg-supervisor-lib.sh
		. "${PLAYOUT}/tools/runtime/casparcg-supervisor-lib.sh"
		caspar_crash_loop_reset || true
	fi
}

cmd="${1:-}"
case "$cmd" in
status)
	printf 'scanner=%s\n' "$(unit_state "$SCANNER_UNIT")"
	printf 'server=%s\n' "$(unit_state "$SERVER_UNIT")"
	if [[ -f "$INHIBIT" ]]; then
		echo 'inhibited=1'
	else
		echo 'inhibited=0'
	fi
	;;
stop)
	mkdir -p "$(dirname "$INHIBIT")"
	touch "$INHIBIT"
	systemctl stop "$SERVER_UNIT" 2>/dev/null || true
	ensure_stopped_processes
	printf 'scanner=%s\n' "$(unit_state "$SCANNER_UNIT")"
	printf 'server=%s\n' "$(unit_state "$SERVER_UNIT")"
	echo 'inhibited=1'
	;;
start)
	rm -f "$INHIBIT"
	clear_crash_loop_state
	systemctl start "$SCANNER_UNIT" 2>/dev/null || true
	systemctl start "$SERVER_UNIT"
	printf 'scanner=%s\n' "$(unit_state "$SCANNER_UNIT")"
	printf 'server=%s\n' "$(unit_state "$SERVER_UNIT")"
	echo 'inhibited=0'
	;;
restart)
	rm -f "$INHIBIT"
	clear_crash_loop_state
	systemctl start "$SCANNER_UNIT" 2>/dev/null || true
	systemctl restart "$SERVER_UNIT"
	printf 'scanner=%s\n' "$(unit_state "$SCANNER_UNIT")"
	printf 'server=%s\n' "$(unit_state "$SERVER_UNIT")"
	echo 'inhibited=0'
	;;
*)
	echo "Usage: $0 status|stop|start|restart" >&2
	exit 1
	;;
esac
