#!/usr/bin/env bash
# Pre-produce preflight: liveroot bind-mount guard + WO-47 umount.
# Never deletes anything under /home/eggs — eggs produce overwrites staging.
#
# Usage: sudo bash tools/eggs/live-usb/pre-produce-preflight.sh
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=eggs-liveroot-safety.sh
source "${HERE}/eggs-liveroot-safety.sh"

LIVEROOT="$(eggs_liveroot_default)"

echo "==> Pre-produce preflight (no deletes under /home/eggs)"

if eggs_liveroot_produce_in_progress; then
	echo "ERROR: eggs produce / mksquashfs still running." >&2
	echo "  Wait, or if you Ctrl-C'd: sudo reboot before retrying." >&2
	exit 1
fi

if eggs_liveroot_has_host_bind_mounts "$LIVEROOT"; then
	echo "ERROR: ${LIVEROOT} has LIVE system bind mounts — reboot before eggs produce." >&2
	echo "  Do NOT rm or umount anything under /home/eggs." >&2
	eggs_liveroot_print_host_bind_mounts "$LIVEROOT"
	exit 1
fi

bash "${HERE}/stop-and-unmount-wo47-for-eggs-produce.sh"

bash "${HERE}/verify-calamares-installed.sh"

echo "    liveroot: ${LIVEROOT} — left untouched"
echo "OK: preflight complete — safe to run eggs produce"
