#!/usr/bin/env bash
# Report duplicate Caspar supervisors, Openbox vs systemd ownership, and path sanity.
#
#   bash tools/runtime/diagnose-caspar-supervisors.sh
set -euo pipefail

PLAYOUT="${CASPAR_ROOT:-/home/casparcg/highascg}"
AUTOSTART="${HOME}/.config/openbox/autostart"

section() {
	echo ""
	echo "=== $* ==="
}

section "Host"
hostname
date -Is

section "Processes (run.sh + main casparcg)"
pgrep -af 'run\.sh|bin/casparcg.*casparcg\.config' || echo "(none)"

_run_n=0
_main_n=0
while read -r line; do
	case "$line" in
	*run.sh*) _run_n=$((_run_n + 1)) ;;
	*bin/casparcg*config*) _main_n=$((_main_n + 1)) ;;
	esac
done < <(pgrep -af 'run\.sh|bin/casparcg.*casparcg\.config' 2>/dev/null || true)

echo "Summary: run.sh supervisors=${_run_n}, main casparcg=${_main_n}"
if [[ "$_run_n" -gt 1 ]]; then
	echo "PROBLEM: multiple run.sh — Openbox autostart + systemd casparcg-server both active"
elif [[ "$_run_n" -eq 1 && "$_main_n" -eq 1 ]]; then
	echo "OK: single supervisor + single main casparcg"
fi

section "Supervisor parent chains"
for pid in $(pgrep -f 'run\.sh' 2>/dev/null || true); do
	echo "--- pid ${pid} ---"
	ps -o pid,ppid,user,stat,lstart,cmd -p "$pid" 2>/dev/null || true
	ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
	[[ -n "$ppid" ]] && ps -o pid,ppid,user,stat,cmd -p "$ppid" 2>/dev/null || true
	cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || echo '?')"
	echo "  cwd: ${cwd}"
done

section "Main casparcg cwd + config"
for pid in $(pgrep -f 'bin/casparcg.*casparcg\.config' 2>/dev/null | head -5); do
	cmd="$(tr '\0' ' ' </proc/"$pid"/cmdline 2>/dev/null || true)"
	cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || echo '?')"
	echo "pid ${pid} cwd=${cwd}"
	echo "  ${cmd}"
done

section "systemd units"
for u in casparcg-server casparcg-scanner; do
	if systemctl cat "${u}.service" &>/dev/null; then
		echo "${u}: enabled=$(systemctl is-enabled "${u}.service" 2>/dev/null || echo ?) active=$(systemctl is-active "${u}.service" 2>/dev/null || echo ?) mainpid=$(systemctl show -p MainPID --value "${u}.service" 2>/dev/null || echo ?)"
	else
		echo "${u}.service: not installed"
	fi
done

section "Openbox autostart (caspar + nvidia lines)"
if [[ -f "$AUTOSTART" ]]; then
	grep -nE 'run\.sh|casparcg-scanner|nvidia-x-apply|casparcg-server' "$AUTOSTART" || echo "(no caspar/nvidia lines)"
	if grep -vE '^\s*#' "$AUTOSTART" | grep -q 'casparcg-scanner'; then
		echo "PROBLEM: autostart must not start casparcg-scanner — use casparcg-scanner.service"
	fi
	if [[ -f /etc/systemd/system/casparcg-server.service ]] \
		&& systemctl is-enabled --quiet casparcg-server.service 2>/dev/null \
		&& grep -vE '^\s*#' "$AUTOSTART" | grep -qE 'exec \./run\.sh|\./run\.sh >>'; then
		echo "PROBLEM: autostart still starts run.sh while casparcg-server.service is enabled"
	fi
	nvidia_n="$(grep -c 'highascg-nvidia-x-apply' "$AUTOSTART" 2>/dev/null || echo 0)"
	[[ "$nvidia_n" -gt 1 ]] && echo "NOTE: ${nvidia_n} nvidia-x-apply invocations in autostart (expected: 1 retry loop)"
else
	echo "missing ${AUTOSTART}"
fi

section "AMCP :5250"
ss -tlnp 2>/dev/null | grep ':5250 ' || echo "(not listening)"

section "Supervisor state"
ls -la /tmp/caspar-runsh.lock 2>/dev/null || true
ls -la /run/highascg/ 2>/dev/null || true
tail -5 /tmp/caspar.log 2>/dev/null || true

section "Expected paths"
for f in "${PLAYOUT}/run.sh" "${PLAYOUT}/bin/casparcg" "${PLAYOUT}/config/casparcg.config"; do
	[[ -e "$f" ]] && echo "OK ${f}" || echo "MISSING ${f}"
done
