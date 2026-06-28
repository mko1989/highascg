#!/usr/bin/env bash
# Launch Calamares disk installer on DISPLAY :0 (live ISO or installed playout host).
set -euo pipefail

USER_CASPAR="${HIGHASCG_USER:-casparcg}"
XAUTH="${XAUTHORITY:-/home/${USER_CASPAR}/.Xauthority}"

export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="$XAUTH"
unset WAYLAND_DISPLAY

if [[ ! -f "$XAUTHORITY" ]]; then
	echo "WARN: X authority missing at $XAUTHORITY — Calamares may fail without nodm :0" >&2
fi

if command -v eggs >/dev/null 2>&1 && [[ -x /usr/bin/eggs ]]; then
	exec /usr/bin/eggs calamares
fi

if command -v calamares >/dev/null 2>&1; then
	exec calamares -d
fi

echo "Calamares not installed (eggs calamares --install or apt install calamares)" >&2
exit 1
