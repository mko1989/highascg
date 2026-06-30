#!/usr/bin/env bash
# test-07-amcp-playout.sh
st_section "07 AMCP playout port"
if ss -tln 2>/dev/null | grep -qE ':5250[[:space:]]'; then
	st_ok "AMCP :5250 listening"
else
	st_fail "AMCP :5250 not listening"
fi
if [[ "${ST_QUICK:-0}" == "1" ]]; then
	st_skip "VERSION probe (--quick)"
else
	if command -v nc >/dev/null 2>&1; then
		ver="$(printf 'VERSION\r\n' | nc -w 2 127.0.0.1 5250 2>/dev/null | head -1 || true)"
		if [[ -n "$ver" ]]; then
			st_ok "AMCP VERSION: ${ver}"
		else
			st_warn "AMCP port open but VERSION probe empty"
		fi
	else
		st_skip "nc not installed — skip VERSION probe"
	fi
fi
