#!/usr/bin/env bash
# test-04-drop-update.sh — validate drop-update/ shape (no apply)
st_section "04 drop-update/ (read-only validate)"
if [[ ! -d "$DROP" ]]; then
	st_fail "missing ${DROP}/"
else
	st_ok "drop-update/ directory exists"
fi
for req in package.json index.js src dist-web/index.html tools/runtime/exfat-sync-cli.js; do
	if [[ -e "${DROP}/${req}" ]]; then
		st_ok "drop-update/${req}"
	else
		st_fail "drop-update missing ${req}"
	fi
done
if [[ -f "${DROP}/package.json" ]] && [[ -f "${PLAYOUT}/package.json" ]]; then
	drop_v="$(node -e "try{console.log(require(process.argv[1]).version||'')}catch(e){}" "${DROP}/package.json" 2>/dev/null || true)"
	play_v="$(node -e "try{console.log(require(process.argv[1]).version||'')}catch(e){}" "${PLAYOUT}/package.json" 2>/dev/null || true)"
	if [[ -n "$drop_v" && -n "$play_v" && "$drop_v" == "$play_v" ]]; then
		st_ok "package version drop==playout (${drop_v})"
	elif [[ -n "$drop_v" ]]; then
		st_warn "version drop=${drop_v} playout=${play_v:-?} (apply may be pending)"
	fi
fi
if [[ -f "${DROP}/.applied-stamp" ]]; then
	st_ok "retain stamp ${DROP}/.applied-stamp=$(cat "${DROP}/.applied-stamp" 2>/dev/null | head -c 40)"
fi
if [[ -f /etc/highascg/server-update-retain-drop ]]; then
	st_ok "server-update-retain-drop marker"
else
	st_warn "no /etc/highascg/server-update-retain-drop (consume mode risk on stick)"
fi
