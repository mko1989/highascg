#!/usr/bin/env bash
# Launch Calamares disk installer on DISPLAY :0 (live ISO or installed playout host).
# Must be invoked as root: sudo -n /usr/local/bin/launch-calamares.sh
set -euo pipefail

USER_CASPAR="${HIGHASCG_USER:-casparcg}"
HOME_CASPAR="/home/${USER_CASPAR}"
CALAMARES_BIN="${CALAMARES_BIN:-/usr/bin/calamares}"

if [[ "${1:-}" == "--check" ]]; then
	command -v "${CALAMARES_BIN}" >/dev/null 2>&1 || exit 1
	exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
	echo "ERROR: launch-calamares.sh must run as root (passwordless sudo for ${USER_CASPAR})" >&2
	echo "       Run: sudo bash scripts/setup/12-passwordless-sudo.sh" >&2
	exit 1
fi

if ! command -v "${CALAMARES_BIN}" >/dev/null 2>&1; then
	echo "Calamares not installed (eggs calamares --install or apt install calamares)" >&2
	exit 1
fi

CASPAR_UID="$(id -u "${USER_CASPAR}")"
export DISPLAY="${DISPLAY:-:0}"
export HOME="${HOME_CASPAR}"
export XAUTHORITY="${XAUTHORITY:-${HOME_CASPAR}/.Xauthority}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${CASPAR_UID}}"
unset WAYLAND_DISPLAY

# nodm :0 allows only SI:localuser:casparcg — grant root temporary GUI access.
if command -v xhost >/dev/null 2>&1; then
	runuser -u "${USER_CASPAR}" -- env DISPLAY="${DISPLAY}" xhost +SI:localuser:root >/dev/null 2>&1 || true
fi

if [[ -x /usr/local/lib/highascg/fix-calamares-branding.sh ]]; then
	/usr/local/lib/highascg/fix-calamares-branding.sh
fi

exec "${CALAMARES_BIN}" -d
