#!/usr/bin/env bash
# WO-595 M0 spike launcher — macOS (dev) and Linux (box). Starts a test-pattern bridge unless a
# writer already exists (real Caspar consumer or your own bridge), then runs the Godot spike.
#
#   godot/spikes/m0/run-spike.sh [canvas|atlas|previs] [extra spike args…]
#   GODOT=/opt/godot/godot-4.7.2 SURFACE=opgui W=1920 H=1080 FPS=50 run-spike.sh atlas --fullscreen
#   SURFACE=pgm1 W=3072 H=1728 run-spike.sh previs --model=/path/stage.glb
#   NO_BRIDGE=1 run-spike.sh canvas          # attach to an existing writer (e.g. Caspar ADD 5-740 SHM NAME opgui)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MODE="${1:-canvas}"
shift || true
SURFACE="${SURFACE:-opgui}"
W="${W:-1920}"
H="${H:-1080}"
FPS="${FPS:-50}"

if [[ -z "${GODOT:-}" ]]; then
	for c in /opt/godot/godot /Applications/Godot.app/Contents/MacOS/Godot "$(command -v godot 2>/dev/null || true)" "$(command -v godot4 2>/dev/null || true)"; do
		if [[ -n "$c" && -x "$c" ]]; then GODOT="$c"; break; fi
	done
fi
[[ -n "${GODOT:-}" ]] || { echo "Godot not found — set GODOT=/path/to/godot (4.7.x)" >&2; exit 1; }

# Godot loads GDExtensions listed in .godot/extension_list.cfg (normally written by the editor's import
# scan; `--import` itself crashes at exit in 4.6.3 doc generation when an extension is present).
if [[ -f "$HERE/addons/hshm/hshm.gdextension" ]]; then
	mkdir -p "$HERE/.godot"
	echo "res://addons/hshm/hshm.gdextension" > "$HERE/.godot/extension_list.cfg"
fi

BRIDGE_PID=""
cleanup() { [[ -n "$BRIDGE_PID" ]] && kill "$BRIDGE_PID" 2>/dev/null || true; }
trap cleanup EXIT

if [[ -z "${NO_BRIDGE:-}" ]]; then
	python3 "$REPO/tools/hshm-bridge/hshm_bridge.py" --name "$SURFACE" --width "$W" --height "$H" --fps "$FPS" &
	BRIDGE_PID=$!
	sleep 1
fi

echo "[run-spike] $GODOT ($("$GODOT" --version 2>/dev/null | head -1)) mode=$MODE surface=$SURFACE"
"$GODOT" --path "$HERE" -- --name="$SURFACE" --mode="$MODE" "$@"
