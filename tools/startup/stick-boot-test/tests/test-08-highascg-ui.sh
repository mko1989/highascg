#!/usr/bin/env bash
# test-08-highascg-ui.sh
st_section "08 HighAsCG operator UI"
if systemctl is-active --quiet highascg.service 2>/dev/null; then
	st_ok "highascg.service active"
else
	st_fail "highascg.service not active"
fi
for url in http://127.0.0.1/ http://127.0.0.1:4200/; do
	if command -v curl >/dev/null 2>&1; then
		code="$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "$url" 2>/dev/null || echo 000)"
		case "$code" in
		200 | 301 | 302 | 304) st_ok "${url} HTTP ${code}" ;;
		000) st_warn "${url} unreachable" ;;
		*) st_warn "${url} HTTP ${code}" ;;
		esac
	else
		st_skip "curl missing — skip HTTP check ${url}"
		break
	fi
done
if [[ -f "${PLAYOUT}/dist-web/index.html" ]]; then
	st_ok "dist-web/index.html on playout tree"
else
	st_fail "missing ${PLAYOUT}/dist-web/index.html"
fi
if command -v curl >/dev/null 2>&1; then
	api="$(curl -s --connect-timeout 3 http://127.0.0.1:4200/api/system/status 2>/dev/null || true)"
	if [[ -n "$api" ]] && echo "$api" | grep -q '"ok"'; then
		st_ok "GET /api/system/status responds"
	elif [[ -n "$api" ]]; then
		st_warn "/api/system/status body present but unexpected shape"
	else
		st_warn "/api/system/status empty (nginx proxy or Node not on :4200)"
	fi
fi
