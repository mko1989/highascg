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

if [[ "${SKIP_STRIP_HOST_SWAP:-0}" != "1" ]]; then
	echo "==> strip host swap for live ISO (swapoff + drop fstab lines — right before produce)"
	bash "${HERE}/strip-host-swap-for-live-iso.sh" prepare
fi

# WO-481: the squashfs clones the LIVE filesystem, so what ships is /usr/local/bin, never the repo.
# WO-475 shipped an ISO whose launcher still had no bridge release for exactly this reason: the
# repo copy was fixed and the installed copy — the one the sudoers rule and the GUI button call —
# was months old. Refresh it here, the last place before the clone, so a produce cannot bake a
# stale launcher again.
REPO_LAUNCHER="$(cd "${HERE}/../../.." && pwd)/tools/runtime/launch-calamares.sh"
if [[ -f "$REPO_LAUNCHER" ]]; then
	if cmp -s "$REPO_LAUNCHER" /usr/local/bin/launch-calamares.sh; then
		echo "==> /usr/local/bin/launch-calamares.sh already matches the repo"
	else
		install -m 0755 "$REPO_LAUNCHER" /usr/local/bin/launch-calamares.sh
		echo "==> refreshed /usr/local/bin/launch-calamares.sh from the repo (WO-481)"
	fi
else
	echo "WARN: ${REPO_LAUNCHER} missing — cannot refresh the installed launcher" >&2
fi

echo "==> Calamares shellprocess fixes (last chance before squashfs clone — avoids install exit 127)"
echo "     note: eggs produce regenerates /etc/calamares; patch-iso-squashfs-calamares.sh runs after produce"
bash "${HERE}/fix-calamares-shellprocess.sh"

bash "${HERE}/verify-calamares-installed.sh"

echo "    liveroot: ${LIVEROOT} — left untouched"
echo "OK: preflight complete — safe to run eggs produce"
