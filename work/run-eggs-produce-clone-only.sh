#!/usr/bin/env bash
# Bare eggs produce --clone (no host prepare, no flash, no hostname/netplan changes).
#
#   cd ~/highascg
#   sudo bash work/run-eggs-produce-clone-only.sh
#
# Uses existing /etc/penguins-eggs.d/exclude.list and eggs.yaml kernel.
#
# WO-148 branding gate: a plain `eggs produce` overwrites the custom GRUB splash and
# ships a stock initrd, so this wrapper now ALWAYS runs inject-iso-boot-branding.sh +
# verify-iso-boot-branding.sh after produce and fails (non-zero exit) when branding is
# missing. It intentionally does NOT route through build-highascg-egg.sh because that
# script also mutates the host (apt installs, hostname, factory config reset) — this
# is the debug wrapper that skips host prep, not the branding gate.
#
# Escape hatch (unbranded debug ISO, never flash): HIGHASCG_SKIP_ISO_BOOT_BRANDING=1
#
set -euo pipefail

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO="/home/casparcg/highascg"
LIVE_USB="${REPO}/tools/eggs/live-usb"
# shellcheck source=../tools/eggs/live-usb/eggs-liveroot-safety.sh
source "${LIVE_USB}/eggs-liveroot-safety.sh"

LIVEROOT="$(eggs_liveroot_default)"
if eggs_liveroot_produce_in_progress; then
	echo "ERROR: eggs produce / mksquashfs still running — wait or reboot if you interrupted it." >&2
	exit 1
fi
if eggs_liveroot_has_host_bind_mounts "$LIVEROOT"; then
	echo "ERROR: ${LIVEROOT} has live bind mounts — reboot before produce." >&2
	echo "  rm -rf ${LIVEROOT} in this state erases /usr on the real host." >&2
	eggs_liveroot_print_host_bind_mounts "$LIVEROOT"
	exit 1
fi

BR="$(cat /etc/highascg/nvidia-iso-driver 2>/dev/null || echo 595)"
BASENAME="${BASENAME:-highascg-nvidia-${BR}}"
THEME_ABS="$(cd "${LIVE_USB}/highascg-eggs-theme" && pwd)"
LOG="${REPO}/work/eggs-produce-clone-$(date +%Y%m%d-%H%M%S).log"

echo "==> eggs produce --clone only"
echo "    basename: ${BASENAME}"
echo "    theme:    ${THEME_ABS}"
echo "    log:      ${LOG}"
echo "    kernel pin: $(cat /etc/highascg/pinned-kernel 2>/dev/null || echo none)"

bash "${LIVE_USB}/pre-produce-preflight.sh"

exec > >(tee -a "$LOG") 2>&1
eggs produce --nointeractive --clone --max --excludes static \
	--basename "${BASENAME}" --theme "${THEME_ABS}"

# WO-148: mandatory branding gate — inject (re-copies splash.png, rebuilds initrd,
# re-packs ISO) then verify. Failures propagate; the host remount below still runs.
brand_rc=0
if [[ "${HIGHASCG_SKIP_ISO_BOOT_BRANDING:-0}" == "1" ]]; then
	echo "WARN: HIGHASCG_SKIP_ISO_BOOT_BRANDING=1 — ISO is UNBRANDED (debug only, do not flash)" >&2
else
	set +e
	echo "==> Inject GRUB splash + Plymouth initrd into ISO (mandatory — WO-148)"
	HIGHASCG_SKIP_SQUASHFS_REFRESH=1 bash "${LIVE_USB}/inject-iso-boot-branding.sh"
	brand_rc=$?
	if [[ "$brand_rc" -eq 0 ]]; then
		echo "==> Verify ISO boot branding (mandatory — WO-148)"
		bash "${LIVE_USB}/verify-iso-boot-branding.sh"
		brand_rc=$?
	fi
	set -e
fi

echo "==> Remount bridge/USB + config sync"
bash "${LIVE_USB}/unmask-exfat-systemd.sh"
bash "${REPO}/scripts/highascg-exfat-remount-sync.sh" casparcg 2>/dev/null || {
	echo "WARN: remount/sync skipped — run: sudo bash ${REPO}/scripts/highascg-exfat-remount-sync.sh" >&2
}

if [[ "$brand_rc" -ne 0 ]]; then
	echo "BUILD FAILED (exit ${brand_rc}): ISO boot branding inject/verify failed — do not flash this ISO." >&2
	echo "  The FAIL lines above name the missing asset (e.g. boot/grub/splash.png, plymouth theme, show.qml)." >&2
	echo "  Log: ${LOG}" >&2
	exit "$brand_rc"
fi

echo "==> done $(date -Is)"
echo "ISO under /home/eggs/ — name starts with ${BASENAME}_ (branding injected + verified)"
