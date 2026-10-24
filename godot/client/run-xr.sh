#!/usr/bin/env bash
# WO-741 (detachable) — the operator client in a VR headset: walk the Previs tab's stage at 1:1 and program lights.
# Needs an OpenXR runtime that is active: WiVRn with the Quest connected (help/vr-walk.md). Godot starts OpenXR only
# at launch, so this waits until the runtime is registered (WiVRn does that when the headset connects).
#   godot/client/run-xr.sh                               # local server
#   godot/client/run-xr.sh --server=http://192.168.0.4:4200
#   XR_WAIT_S=0 godot/client/run-xr.sh                    # no wait: no runtime → the desktop walk (WASD)
# Its own Godot user dir (~/.local/share/highascg-xr): its window, profiles and follow setting never touch the kiosk's.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${GODOT:-}" ]]; then
	for c in /opt/godot/godot "$HOME/.local/opt/godot/godot" "$(command -v godot 2>/dev/null || true)"; do
		if [[ -n "$c" && -x "$c" ]]; then GODOT="$c"; break; fi
	done
fi
[[ -n "${GODOT:-}" ]] || { echo "Godot not found — set GODOT=/path/to/godot" >&2; exit 1; }

# The OpenXR loader's own lookup order: XR_RUNTIME_JSON, then the user's config, then the system's.
runtime() {
	local f
	for f in "${XR_RUNTIME_JSON:-}" "${XDG_CONFIG_HOME:-$HOME/.config}/openxr/1/active_runtime.json" /etc/xdg/openxr/1/active_runtime.json; do
		if [[ -n "$f" && -r "$f" ]]; then echo "$f"; return 0; fi
	done
	return 1
}
wait_s="${XR_WAIT_S:-120}"
if ! rt="$(runtime)" && ((wait_s > 0)); then
	echo "[xr] no OpenXR runtime yet — start WiVRn and connect the headset (waiting ${wait_s} s)"
	for ((i = 0; i < wait_s; i++)); do
		sleep 1
		rt="$(runtime)" && break
	done
fi
# --xr-mode on only with a runtime: without one Godot stops at a modal "OpenXR was requested but failed to start".
xr_mode=off
if [[ -n "${rt:-}" ]]; then
	export XR_RUNTIME_JSON="$rt"
	xr_mode=on
	echo "[xr] OpenXR runtime: $rt"
else
	echo "[xr] no OpenXR runtime — starting the desktop walk (WASD, left-drag looks)"
fi
export XDG_DATA_HOME="${HIGHASCG_XR_USER:-$HOME/.local/share/highascg-xr}"
mkdir -p "$XDG_DATA_HOME"
exec "$GODOT" --path "$HERE" --xr-mode "$xr_mode" -- --xr --windowed --tab=1 "$@"
