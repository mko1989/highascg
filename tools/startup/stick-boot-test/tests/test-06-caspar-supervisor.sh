#!/usr/bin/env bash
# test-06-caspar-supervisor.sh
st_section "06 Caspar supervisor (single instance)"
_run_n="$(pgrep -cf 'run\.sh' 2>/dev/null || echo 0)"
_main_n=0
while read -r line; do
	case "$line" in
	*bin/casparcg*config*) _main_n=$((_main_n + 1)) ;;
	esac
done < <(pgrep -af 'bin/casparcg.*casparcg\.config' 2>/dev/null || true)

if [[ "$_run_n" -le 1 ]]; then
	st_ok "run.sh supervisors: ${_run_n}"
else
	st_fail "multiple run.sh supervisors (${_run_n}) — Openbox + systemd duplicate"
fi
if [[ "$_main_n" -eq 1 ]]; then
	st_ok "main casparcg process: 1"
elif [[ "$_main_n" -eq 0 ]]; then
	st_fail "no main casparcg process"
else
	st_fail "multiple main casparcg processes (${_main_n})"
fi
for pid in $(pgrep -f 'bin/casparcg.*casparcg\.config' 2>/dev/null || true); do
	cwd="$(readlink -f "/proc/${pid}/cwd" 2>/dev/null || echo ?)"
	cmd="$(tr '\0' ' ' </proc/"${pid}/cmdline" 2>/dev/null || true)"
	if [[ "$cwd" == "${PLAYOUT}" ]]; then
		st_ok "casparcg cwd ${cwd}"
	else
		st_fail "casparcg cwd ${cwd} (expected ${PLAYOUT})"
	fi
	case "$cmd" in
	*"${PLAYOUT}/config/casparcg.config"*) st_ok "casparcg config path OK" ;;
	*) st_fail "unexpected casparcg cmdline: ${cmd}" ;;
	esac
done
if systemctl is-enabled --quiet casparcg-server.service 2>/dev/null; then
	st_ok "casparcg-server.service enabled"
else
	st_warn "casparcg-server.service not enabled"
fi
if pgrep -x casparcg-scanner >/dev/null 2>&1 || systemctl is-active --quiet casparcg-scanner.service 2>/dev/null; then
	st_ok "casparcg-scanner running"
else
	st_warn "casparcg-scanner not running"
fi
