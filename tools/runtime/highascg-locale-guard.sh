#!/bin/sh
# WO-939 — boot-time locale guard (root, one-shot, highascg-locale-guard.service).
#
# Calamares writes the operator's language pick (default en_US.UTF-8) into /etc/locale.conf, but the HighAsCG image has
# no `locales` package: only C, C.UTF-8 and POSIX exist. Every service then inherits a locale libc cannot load, and
# casparcg's std::locale("") throws at startup (192.168.0.35, 03.11.26). When /etc/locale.conf names a locale that is
# not installed, this rewrites it to LANG=C.UTF-8 (the build host's own setting), keeping a .bak-wo939 copy once.
#
# PID 1 has already read the old file by the time this runs, so the boot that repairs it still hands the bad locale to
# services; run.sh's caspar_sanitize_locale covers Caspar on that boot. From the next boot on, everything is clean.
#
#   HIGHASCG_LOCALE_CONF   file to check (default /etc/locale.conf) — tests point it at a fixture
set -eu

CONF="${HIGHASCG_LOCALE_CONF:-/etc/locale.conf}"

log() { printf '%s\n' "highascg-locale-guard: $*"; }

locale_available() {
	case "$1" in C | POSIX | C.UTF-8 | C.utf8) return 0 ;; esac
	[ -z "$(LC_ALL="$1" locale 2>&1 >/dev/null)" ]
}

if [ ! -f "$CONF" ]; then
	log "no ${CONF} — nothing to check"
	exit 0
fi

bad=""
while IFS= read -r line || [ -n "$line" ]; do
	case "$line" in
	LANG=* | LC_*=*) ;;
	*) continue ;;
	esac
	val="${line#*=}"
	val="${val#\"}"
	val="${val%\"}"
	[ -n "$val" ] || continue
	locale_available "$val" || bad="${bad} ${line}"
done <"$CONF"

if [ -z "$bad" ]; then
	log "${CONF} names only installed locales — unchanged"
	exit 0
fi

[ -e "${CONF}.bak-wo939" ] || cp -p "$CONF" "${CONF}.bak-wo939"
# Write through a temp file + rename: /etc/default/locale is a symlink to this file on 26.04, so it follows too.
tmp="${CONF}.tmp-wo939"
printf 'LANG=C.UTF-8\n' >"$tmp"
chmod 0644 "$tmp"
mv -f "$tmp" "$CONF"
log "locale not installed:${bad} — ${CONF} set to LANG=C.UTF-8 (was saved as ${CONF}.bak-wo939)"
