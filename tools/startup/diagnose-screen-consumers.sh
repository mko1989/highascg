#!/usr/bin/env bash
# Read-only snapshot for "the screen consumers do not initialize / something is blocking them".
#
#   bash tools/startup/diagnose-screen-consumers.sh            # prints, and writes /tmp/sc-diag.txt
#   sudo bash tools/startup/diagnose-screen-consumers.sh       # adds dmesg (segfault/OOM/Xid)
#
# Answers three questions in order, because they need different fixes:
#   1. Is casparcg alive, and is it staying alive?      -> service state + exit signals
#   2. Did the consumers initialize and create windows? -> its own log + the X window tree
#   3. If the windows exist, is something covering them? -> stacking order + geometry vs xrandr
set -uo pipefail

OUT="${1:-/tmp/sc-diag.txt}"
USER_CASPAR="${HIGHASCG_USER:-casparcg}"
HOME_CASPAR="/home/${USER_CASPAR}"
LOG="${HOME_CASPAR}/highascg/log/caspar_$(date +%F).log"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME_CASPAR}/.Xauthority}"

section() { printf '\n===== %s =====\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

{
	printf 'host=%s  date=%s  display=%s\n' "$(hostname)" "$(date -Is)" "$DISPLAY"

	section "1. process / service"
	systemctl is-active casparcg-server.service highascg.service casparcg-scanner.service 2>&1 | paste -sd' '
	systemctl status casparcg-server.service --no-pager 2>&1 | head -12
	echo "-- casparcg processes (main only, zygotes filtered):"
	pgrep -af 'bin/casparcg' 2>/dev/null | grep -v -- '--type=' | head -5
	echo "-- run.sh supervisors (more than one = two things launching Caspar):"
	pgrep -af 'run\.sh' 2>/dev/null | head -5
	echo "-- AMCP 5250 listening:"
	(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -c ':5250' || true

	section "2. why it stopped (exit codes / signals, last 30 min)"
	journalctl -u casparcg-server.service --since '-30min' --no-pager 2>/dev/null \
		| grep -iE 'main process|signal|core-dump|Stopped|Failed|Started|Scheduled restart' | tail -25

	section "3. kernel: segfault / OOM / GPU faults"
	if [[ "$(id -u)" -eq 0 ]]; then
		dmesg -T 2>/dev/null | grep -iE 'segfault|out of memory|killed process|NVRM|Xid|GPU has fallen' | tail -20 \
			|| echo '(none)'
	else
		echo '(needs sudo — re-run with sudo for this section)'
	fi
	have coredumpctl && coredumpctl list --no-pager 2>/dev/null | tail -5

	section "4. screen consumers in Caspar's own log"
	if [[ -f "$LOG" ]]; then
		echo "-- log: $LOG"
		echo "-- server starts today: $(grep -c 'Starting CasparCG Video and Graphics Playout Server' "$LOG" 2>/dev/null)"
		echo "-- consumer lines (last start):"
		awk '/Starting CasparCG Video and Graphics/{buf=""} {buf=buf $0 "\n"} END{print buf}' "$LOG" 2>/dev/null \
			| grep -iE 'screen consumer|Initialized\.|Initialized screen|\[error\]|\[warning\]' | tail -30
	else
		echo "(no $LOG)"
	fi

	section "5. X: do the consumer windows exist?"
	if have xdpyinfo && xdpyinfo >/dev/null 2>&1; then
		echo "-- canvas: $(xdpyinfo | awk '/dimensions:/{print $2}')"
		have xrandr && xrandr --listmonitors 2>/dev/null
		echo "-- window tree (casparcg / kiosk / chrome):"
		have xwininfo && xwininfo -root -tree 2>/dev/null \
			| grep -iE 'casparcg|highascg|chromium|chrome|kiosk|nodm' | head -25
		echo "-- stacking order, bottom→top (last id is on top):"
		have xprop && xprop -root _NET_CLIENT_LIST_STACKING 2>/dev/null
		if have wmctrl; then
			echo "-- wmctrl geometry:"
			wmctrl -lG 2>/dev/null | head -20
		fi
	else
		echo "(no X on $DISPLAY as this user — run as ${USER_CASPAR} with DISPLAY=:0)"
	fi

	section "6. GPU"
	have nvidia-smi && nvidia-smi --query-gpu=name,driver_version,memory.used,memory.total --format=csv,noheader 2>/dev/null
	have glxinfo && DISPLAY="$DISPLAY" glxinfo -B 2>/dev/null | head -6

	section "7. highascg server view"
	PORT="$(python3 -c "import json;print(json.load(open('${HOME_CASPAR}/highascg/webui-port.json'))['port'])" 2>/dev/null || echo 4200)"
	curl -s -m 5 "http://127.0.0.1:${PORT}/api/logs?lines=60&caspar=0" 2>/dev/null \
		| python3 -c "import json,sys;[print(str(l)[:200]) for l in (json.load(sys.stdin).get('highascg') or [])[-25:]]" 2>/dev/null \
		|| echo "(highascg API not answering on ${PORT})"
} 2>&1 | tee "$OUT"

printf '\nWrote %s\n' "$OUT"
