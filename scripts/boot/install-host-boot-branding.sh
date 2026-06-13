#!/usr/bin/env bash
# Host boot: GRUB wallpaper + full early kernel dmesg on the console.
#
# Plymouth/splash hides the framebuffer dmesg stream — this host profile uses nosplash
# plus a lightweight framebuffer corner throbber (no Plymouth at boot).
# Plymouth theme stays installed for eggs ISO builds (finalize-boot-branding).
#
#   sudo bash scripts/install-host-boot-branding.sh
#
# Optional Plymouth boot on host (throbber, no full dmesg):
#   sudo HIGHASCG_HOST_BOOT_MODE=plymouth bash scripts/install-host-boot-branding.sh
#
# ISO/live-USB: eggs produce + inject-iso-boot-branding.sh (see branding/README.md).
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo $0" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIVE_USB="${REPO_ROOT}/tools/eggs/live-usb"
BRANDING="${LIVE_USB}/branding"
GRUB=/etc/default/grub
GRUB_D=/etc/grub.d/00_highascg_gfxtheme
KVER="$(uname -r)"
BOOT_MODE="${HIGHASCG_HOST_BOOT_MODE:-dmesg}"

log() { echo "==> $*"; }

[[ -f "${BRANDING}/splash.png" ]] || {
	echo "Missing ${BRANDING}/splash.png" >&2
	exit 1
}

log "Prepare RGB splash + throbber frames (for ISO / optional Plymouth)"
bash "${LIVE_USB}/prepare-branding-assets.sh"

if [[ "$BOOT_MODE" == "plymouth" ]]; then
	systemctl unmask plymouth-start.service 2>/dev/null || true
	systemctl enable plymouth-start.service 2>/dev/null || true
	log "Plymouth theme + initramfs (host will use splash — dmesg hidden during Plymouth)"
	bash "${LIVE_USB}/install-highascg-plymouth-theme.sh"
else
	log "Host boot mode: dmesg (nosplash) — Plymouth masked; corner throbber on framebuffer"
	systemctl disable plymouth-start.service plymouth-quit-wait.service 2>/dev/null || true
	systemctl mask plymouth-start.service 2>/dev/null || true
	bash "${LIVE_USB}/install-fb-corner-throbber.sh"
fi

log "GRUB splash + theme.cfg → /boot/grub/"
install -d /boot/grub
install -m 0644 "${BRANDING}/splash.boot.png" /boot/grub/splash.png
install -m 0644 "${LIVE_USB}/highascg-eggs-theme/theme/livecd/grub.theme.cfg" /boot/grub/theme.cfg
# theme.cfg ships with ISO Unifont names; host uses Rewir (same as client UI).
sed -i 's/GNU Unifont Regular 16/Rewir Regular 16/g' /boot/grub/theme.cfg

REWIR_TTF="${REPO_ROOT}/template/fonts/Rewir-Light.ttf"
if command -v grub-mkfont >/dev/null 2>&1; then
	if [[ -f "$REWIR_TTF" ]]; then
		grub-mkfont -o /boot/grub/font.pf2 "$REWIR_TTF"
		log "GRUB font: Rewir (${REWIR_TTF} → /boot/grub/font.pf2)"
	else
		echo "Missing ${REWIR_TTF}" >&2
		exit 1
	fi
else
	echo "grub-mkfont not found (install grub-common)" >&2
	exit 1
fi

log "GRUB gfx preamble (${GRUB_D})"
cat >"$GRUB_D" <<'GRUBHEAD'
#!/bin/sh
exec tail -n +3 "$0"
GRUBHEAD
cat "${LIVE_USB}/grub-gfx-preamble.cfg" >>"$GRUB_D"
echo 'set theme=/boot/grub/theme.cfg' >>"$GRUB_D"
chmod 0755 "$GRUB_D"

[[ -f "$GRUB" ]] || {
	echo "Missing $GRUB" >&2
	exit 1
}

if [[ "$BOOT_MODE" == "plymouth" ]]; then
	CMDLINE='consoleblank=0 console=tty0 fbcon=nodefer splash loglevel=4 systemd.show_status=true noresume nvidia-drm.modeset=1 nvidia-drm.fbdev=1'
else
	# nosplash + loglevel=7 = full early kernel dmesg (no ignore_loglevel — floods console for minutes)
	CMDLINE='consoleblank=0 console=tty0 fbcon=nodefer loglevel=7 nosplash noresume systemd.show_status=auto nvidia-drm.modeset=1 nvidia-drm.fbdev=1'
fi

if grep -q '^GRUB_CMDLINE_LINUX_DEFAULT=' "$GRUB"; then
	sed -i "s|^GRUB_CMDLINE_LINUX_DEFAULT=.*|GRUB_CMDLINE_LINUX_DEFAULT=\"${CMDLINE}\"|" "$GRUB"
else
	echo "GRUB_CMDLINE_LINUX_DEFAULT=\"${CMDLINE}\"" >>"$GRUB"
fi

# splash.boot.png is 1920×1080 — explicit mode avoids GRUB centering at ~50% with black bars
if grep -q '^GRUB_GFXMODE=' "$GRUB"; then
	sed -i 's/^GRUB_GFXMODE=.*/GRUB_GFXMODE=1920x1080/' "$GRUB"
else
	echo 'GRUB_GFXMODE=1920x1080' >>"$GRUB"
fi
if grep -q '^GRUB_GFXPAYLOAD_LINUX=' "$GRUB"; then
	sed -i 's/^GRUB_GFXPAYLOAD_LINUX=.*/GRUB_GFXPAYLOAD_LINUX=keep/' "$GRUB"
else
	echo 'GRUB_GFXPAYLOAD_LINUX=keep' >>"$GRUB"
fi

sed -i 's/^GRUB_TIMEOUT_STYLE=.*/GRUB_TIMEOUT_STYLE=menu/' "$GRUB" 2>/dev/null || true
if grep -q '^GRUB_TIMEOUT=' "$GRUB"; then
	sed -i 's/^GRUB_TIMEOUT=.*/GRUB_TIMEOUT=3/' "$GRUB"
else
	echo 'GRUB_TIMEOUT=3' >>"$GRUB"
fi
grep -q '^GRUB_TIMEOUT_STYLE=' "$GRUB" || echo 'GRUB_TIMEOUT_STYLE=menu' >>"$GRUB"

log "update-grub"
update-grub

if ! grep -q 'insmod gfxterm' /boot/grub/grub.cfg 2>/dev/null; then
	log "WARN: grub.cfg missing gfxterm — check ${GRUB_D}" >&2
fi

echo
echo "OK: host boot branding (${BOOT_MODE} mode)"
echo "     GRUB: /boot/grub/splash.png + theme.cfg (3s menu)"
echo "     Kernel: ${CMDLINE}"
if [[ "$BOOT_MODE" == "dmesg" ]]; then
	echo "     Plymouth: masked on host"
	echo "     Corner throbber: highascg-fb-corner-throbber.service (framebuffer overlay)"
	echo
	echo "Reboot to verify: GRUB wallpaper → scrolling kernel + systemd messages + corner animation."
	echo "Optional Plymouth splash (hides dmesg): HIGHASCG_HOST_BOOT_MODE=plymouth"
else
	echo "     Plymouth: $(update-alternatives --query default.plymouth 2>/dev/null | sed -n 's/^Value: //p')"
	echo
	echo "Reboot to verify GRUB wallpaper + Plymouth (no full dmesg while splash is active)."
fi
