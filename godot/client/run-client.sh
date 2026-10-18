#!/usr/bin/env bash
# WO-599 — run the Godot operator client (dev). Server: --server=… or HIGHASCG_SERVER (default http://127.0.0.1:4200).
#   godot/client/run-client.sh                      # windowed, local server
#   godot/client/run-client.sh --fullscreen --screen=1
#   GODOT=/opt/godot/godot godot/client/run-client.sh --server=http://box:4200
#   godot/client/run-client.sh --test               # headless unit tests (exit code = failures)
#   godot/client/run-client.sh --check              # headless boot: fails on any script/parse error
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${GODOT:-}" ]]; then
	for c in /opt/godot/godot /Applications/Godot.app/Contents/MacOS/Godot "$(command -v godot 2>/dev/null || true)"; do
		if [[ -n "$c" && -x "$c" ]]; then GODOT="$c"; break; fi
	done
fi
[[ -n "${GODOT:-}" ]] || { echo "Godot not found — set GODOT=/path/to/godot" >&2; exit 1; }
# GDExtensions load from .godot/extension_list.cfg (no editor import; see WO-596).
if [[ -f "$HERE/addons/hshm/hshm.gdextension" ]]; then
	mkdir -p "$HERE/.godot"
	echo "res://addons/hshm/hshm.gdextension" > "$HERE/.godot/extension_list.cfg"
fi
if [[ "${1:-}" == "--test" ]]; then
	exec "$GODOT" --headless --path "$HERE" --script res://tests/run_tests.gd
fi
# --check: boot the real app headless for a few seconds (all autoloads + every UI scene script compile and
# _ready runs); exit 1 on any script/parse error. The unit runner (--test) never loads the UI scripts.
if [[ "${1:-}" == "--check" ]]; then
	# A parse error in the main script means --quit-after never runs → bound the boot, then judge the log.
	out="$(timeout 45 "$GODOT" --headless --path "$HERE" -- --quit-after=4 --tab=1 2>&1)" && rc=0 || rc=$?
	errs="$(grep -E 'SCRIPT ERROR|Parse Error|Compile Error' <<<"$out" || true)"
	if [[ $rc -eq 124 ]]; then errs="${errs:+$errs$'\n'}[check] boot did not quit within 45 s"; fi
	if [[ -n "$errs" ]]; then echo "$errs" >&2; echo "[check] FAILED" >&2; exit 1; fi
	echo "[check] boot OK (no script errors)"; exit 0
fi
exec "$GODOT" --path "$HERE" -- "$@"
