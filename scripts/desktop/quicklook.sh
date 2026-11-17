#!/usr/bin/env bash
# WO-1121 — quick look for the file manager: Space on a video / image file in Thunar opens a preview window; Space or
# Esc closes it (mpv), a second Space in Thunar closes it too. Muted: this is a playout box — `m` unmutes.
# Falls back to ffplay (Esc / q closes, Space pauses) while mpv is not installed.
#   quicklook.sh <file>
set -u
PIDFILE="${XDG_RUNTIME_DIR:-/tmp}/highascg-quicklook.pid"
if [ -r "$PIDFILE" ]; then
	old=$(cat "$PIDFILE" 2>/dev/null || true)
	rm -f "$PIDFILE"
	if [ -n "${old:-}" ] && [ "$old" -gt 1 ] 2>/dev/null && kill -0 "$old" 2>/dev/null; then
		kill "$old" 2>/dev/null
		exit 0 # the preview was open: Space closed it
	fi
fi
f="${1:-}"
[ -f "$f" ] || exit 0
if command -v mpv >/dev/null 2>&1; then
	keys=$(mktemp "${XDG_RUNTIME_DIR:-/tmp}/highascg-quicklook-keys.XXXXXX")
	printf 'SPACE quit\nESC quit\nq quit\nENTER cycle fullscreen\n' >"$keys"
	mpv --no-config --input-conf="$keys" --title="Quick look — $(basename "$f")" --autofit=60%x70% --ontop \
		--mute=yes --loop-file=inf --image-display-duration=inf --keep-open=yes --osd-level=1 --force-window=immediate \
		-- "$f" >/dev/null 2>&1 &
	echo $! >"$PIDFILE"
	wait $!
	rm -f "$keys"
else
	ffplay -loglevel error -window_title "Quick look — $(basename "$f")" -an -x 1100 -loop 0 -alwaysontop -- "$f" >/dev/null 2>&1 &
	echo $! >"$PIDFILE"
	wait $!
fi
rm -f "$PIDFILE"
