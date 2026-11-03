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

# WO-939: an install whose /etc/locale.conf names a locale the image does not carry (Calamares default en_US.UTF-8,
# no `locales` package) left Caspar unable to start. The guard unit must be on THIS host to ship in the clone.
REPO_ROOT_PF="$(cd "${HERE}/../../.." && pwd)"
LOCALE_GUARD_SRC="${REPO_ROOT_PF}/tools/runtime/highascg-locale-guard.sh"
LOCALE_GUARD_UNIT="${REPO_ROOT_PF}/scripts/systemd/highascg-locale-guard.service"
if [[ -f "$LOCALE_GUARD_SRC" && -f "$LOCALE_GUARD_UNIT" ]]; then
	install -d -m 0755 /usr/local/lib/highascg
	install -m 0755 "$LOCALE_GUARD_SRC" /usr/local/lib/highascg/highascg-locale-guard.sh
	install -m 0644 "$LOCALE_GUARD_UNIT" /etc/systemd/system/highascg-locale-guard.service
	systemctl daemon-reload
	systemctl enable highascg-locale-guard.service >/dev/null 2>&1
	if systemctl is-enabled --quiet highascg-locale-guard.service; then
		echo "==> highascg-locale-guard.service installed + enabled (WO-939)"
	else
		echo "ERROR: highascg-locale-guard.service did not enable — the ISO would ship without it" >&2
		exit 1
	fi
else
	echo "ERROR: WO-939 locale guard sources missing (${LOCALE_GUARD_SRC}, ${LOCALE_GUARD_UNIT})" >&2
	exit 1
fi

# shellcheck source=eggs-cli-lib.sh
source "${HERE}/eggs-cli-lib.sh"
if [[ "$(highascg_eggs_flavor)" == "new" ]]; then
	# WO-870 Phase 4: eggs 26.10 writes the Calamares config at launch on the live stick (installer.d); the
	# /etc/calamares shellprocess patches have nothing to patch. Our overlay is checked by verify-eggs-config.sh.
	echo "==> Calamares: eggs 26.10 configures it on the live stick (eggs sysinstall calamares) — no /etc/calamares patches"
	bash "${HERE}/fix-calamares-shellprocess.sh" --log-rescue-only
else
	echo "==> Calamares shellprocess fixes (last chance before squashfs clone — avoids install exit 127)"
	echo "     note: eggs produce regenerates /etc/calamares; patch-iso-squashfs-calamares.sh runs after produce"
	bash "${HERE}/fix-calamares-shellprocess.sh"
fi

bash "${HERE}/verify-calamares-installed.sh"

echo "    liveroot: ${LIVEROOT} — left untouched"
echo "OK: preflight complete — safe to run eggs produce"
