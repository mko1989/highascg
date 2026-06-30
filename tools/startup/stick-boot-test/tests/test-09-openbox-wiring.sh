#!/usr/bin/env bash
# test-09-openbox-wiring.sh
st_section "09 Openbox autostart wiring"
as="${HOME}/.config/openbox/autostart"
if [[ ! -f "$as" ]]; then
	st_warn "no ${as} (headless or x11-only)"
else
	if systemctl is-enabled --quiet casparcg-scanner.service 2>/dev/null; then
		if grep -vE '^\s*#' "$as" | grep -q 'casparcg-scanner'; then
			st_fail "autostart must not start casparcg-scanner — use casparcg-scanner.service"
		else
			st_ok "autostart does not start casparcg-scanner"
		fi
	fi
	if systemctl is-enabled --quiet casparcg-server.service 2>/dev/null; then
		if grep -vE '^\s*#' "$as" | grep -qE 'exec \./run\.sh|\./run\.sh >>'; then
			st_fail "autostart still starts run.sh while casparcg-server.service is enabled"
		else
			st_ok "autostart does not duplicate casparcg-server"
		fi
	else
		st_warn "casparcg-server not enabled — legacy run.sh autostart path may be intentional"
	fi
	nv_n="$(grep -c 'highascg-nvidia-x-apply' "$as" 2>/dev/null || echo 0)"
	if [[ "$nv_n" -le 2 ]]; then
		st_ok "nvidia-x-apply invocations in autostart: ${nv_n}"
	else
		st_warn "autostart has ${nv_n} nvidia-x-apply lines (expected ≤2 retry loop)"
	fi
fi
