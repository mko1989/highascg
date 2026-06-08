#!/usr/bin/env bash
# Fix post-branding boot issues on the playout host:
#   - Blank screen + "_" cursor (text console / throbber vs NVIDIA X handoff)
#   - ~90s perceived hang (networkd-wait-online, exfat ordering, ignore_loglevel flood)
#   - GRUB countdown: large black letterbox (gfxmode not matching 1920×1080 splash)
#
#   cd ~/highascg && sudo bash scripts/fix-host-boot-display-hang.sh
set -euo pipefail

[[ "$(id -u)" -eq 0 ]] || {
	echo "Run as root: sudo bash $0" >&2
	exit 1
}

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USER_CASPAR="${1:-casparcg}"
GRUB=/etc/default/grub
LIVE_USB="${REPO_ROOT}/tools/eggs/live-usb"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

log() { echo "==> $*"; }

backup_grub() {
	[[ -f "$GRUB" ]] || return 0
	cp -a "$GRUB" "${GRUB}.bak.${STAMP}"
}

fix_grub() {
	[[ -f "$GRUB" ]] || {
		echo "Missing $GRUB" >&2
		exit 1
	}
	backup_grub

	# Full early dmesg without ignore_loglevel (that floods the console for minutes).
	local cmdline='consoleblank=0 console=tty0 fbcon=nodefer loglevel=7 nosplash noresume systemd.show_status=auto nvidia-drm.modeset=1 nvidia-drm.fbdev=1'
	if grep -q '^GRUB_CMDLINE_LINUX_DEFAULT=' "$GRUB"; then
		sed -i "s|^GRUB_CMDLINE_LINUX_DEFAULT=.*|GRUB_CMDLINE_LINUX_DEFAULT=\"${cmdline}\"|" "$GRUB"
	else
		echo "GRUB_CMDLINE_LINUX_DEFAULT=\"${cmdline}\"" >>"$GRUB"
	fi

	# Match splash.boot.png (1920×1080) — avoids centered half-size image + black bars.
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

	log "GRUB: 1920×1080 gfx, nosplash dmesg (no ignore_loglevel), 3s menu"
	update-grub
}

fix_throbber_and_nodm() {
	log "Framebuffer throbber: no restart loop; hard stop before nodm/X"
	bash "${LIVE_USB}/install-fb-corner-throbber.sh"

	install -d -m 0755 /etc/systemd/system/nodm.service.d
	cat >/etc/systemd/system/nodm.service.d/stop-fb-throbber.conf <<'EOF'
[Service]
# Stop throbber before X takes fb0 (Restart=no on throbber — must not respawn during X start).
ExecStartPre=-/bin/systemctl stop highascg-fb-corner-throbber.service
# Ensure primary monitor leaves the text-console VT once X is up.
ExecStartPost=-/usr/bin/chvt 7
EOF

	cat >/etc/systemd/system/highascg-fb-corner-throbber-stop.service <<'EOF'
[Unit]
Description=Stop HighAsCG framebuffer throbber before graphical session
DefaultDependencies=no
Before=nodm.service display-manager.service
Conflicts=shutdown.target

[Service]
Type=oneshot
ExecStart=/bin/systemctl stop highascg-fb-corner-throbber.service
RemainAfterExit=yes

[Install]
WantedBy=graphical.target
EOF
	systemctl daemon-reload
	systemctl enable highascg-fb-corner-throbber-stop.service
}

log "Refresh WO-47/WO-52 units (exfat-boot --no-block ordering)"
bash "${REPO_ROOT}/scripts/install-exfat-systemd-units.sh" "$USER_CASPAR"
bash "${REPO_ROOT}/scripts/fix-boot-emergency-recovery.sh" "$USER_CASPAR"

log "Disable systemd-networkd-wait-online (~2 min stall on unused NICs)"
systemctl disable systemd-networkd-wait-online.service 2>/dev/null || true
systemctl mask systemd-networkd-wait-online.service

fix_throbber_and_nodm
fix_grub

if modinfo nvidia &>/dev/null && grep -q '^version:.*595' <(modinfo nvidia 2>/dev/null); then
	log "NVIDIA 595.x: disable GPU runtime PM (GSP RPC / heartbeat workaround)"
	bash "${REPO_ROOT}/scripts/deprecated/nvidia/install-nvidia-gsp-rpc-workaround.sh"
fi

systemctl daemon-reload
systemctl reset-failed systemd-networkd-wait-online.service highascg-bridge-boot.service 2>/dev/null || true

echo
echo "OK: boot display fixes applied."
echo "  Reboot to verify. Expected:"
echo "    • GRUB splash fills the screen (no huge black letterbox)"
echo "    • Kernel dmesg scrolls, corner throbber, then X on tty7 (~30–60s, not ~2 min)"
echo ""
echo "  If the monitor is still blank after boot but SSH works:"
echo "    sudo chvt 7"
echo "    sudo systemctl restart nodm"
echo "    sudo bash tools/eggs/live-usb/recover-display-after-plymouth.sh"
