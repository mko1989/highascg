#!/usr/bin/env bash
# Step 9: Openbox autostart — scanner + run.sh (CASPAR_RESPAWN=1) on nodm :0.
#
#   sudo bash scripts/setup/09-openbox-autostart.sh
#   sudo systemctl restart nodm   # or reboot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "${SCRIPT_DIR}/lib/common.sh"

require_root

PLAYOUT="${CASPAR_PLAYOUT_ROOT:-/home/casparcg/highascg}"

	if command -v nvidia-settings &>/dev/null; then
	log "NVIDIA GL env + per-session nvidia-settings"
	mkdir -p /etc/X11/Xsession.d /etc/X11/xorg.conf.d
	cat >/etc/X11/Xsession.d/99-highascg-nvidia-gl <<'EOF'
#!/bin/sh
export __GL_SYNC_TO_VBLANK=0
export __GL_ALLOW_MAXIMUM_PERFORMANCE=1
EOF
	chmod 644 /etc/X11/Xsession.d/99-highascg-nvidia-gl

	cat >/etc/profile.d/99-highascg-nvidia-gl.sh <<'EOF'
export __GL_SYNC_TO_VBLANK=0
export __GL_ALLOW_MAXIMUM_PERFORMANCE=1
EOF
	chmod 644 /etc/profile.d/99-highascg-nvidia-gl.sh

	# Driver-level default: Force Composition Pipeline on (not "full" — see docs).
	# xrandr still resets CurrentMetaMode at runtime; highascg-nvidia-x-apply.sh re-patches after layout.
	cat >/etc/X11/xorg.conf.d/99-highascg-force-composition.conf <<'EOF'
# HighAsCG playout: default Force Composition Pipeline on all NVIDIA outputs.
# See docs/reference/screen-consumer-vsync-nvidia.md
Section "Device"
    Identifier "NVIDIA Default Device"
    Driver "nvidia"
    Option "ForceCompositionPipeline" "On"
EndSection
EOF
	chmod 644 /etc/X11/xorg.conf.d/99-highascg-force-composition.conf
	ok "xorg ForceCompositionPipeline default installed"

	install -m 755 "${PLAYOUT}/tools/runtime/highascg-nvidia-x-apply.sh" /usr/local/bin/highascg-nvidia-x-apply.sh
	chmod 755 /usr/local/bin/highascg-nvidia-x-apply.sh
	ok "nvidia-x-apply installed"
fi

log "highascg-display-mode helper"
cat >/usr/local/bin/highascg-display-mode <<EOF
#!/bin/bash
set -e
MODE="\${1:-}"
if [[ "\$MODE" != "normal" && "\$MODE" != "x11-only" ]]; then
	echo "Usage: sudo highascg-display-mode normal|x11-only"
	exit 1
fi
mkdir -p /etc/highascg
echo "\$MODE" >/etc/highascg/display-mode
chmod 644 /etc/highascg/display-mode
systemctl restart nodm
echo "Display mode: \$MODE (nodm restarted)."
EOF
chmod 755 /usr/local/bin/highascg-display-mode

mkdir -p /etc/highascg
[[ -f /etc/highascg/display-mode ]] || echo "normal" >/etc/highascg/display-mode

log "Openbox autostart for ${USER_CASPAR}"
mkdir -p "/home/${USER_CASPAR}/.config/openbox"
cat >"/home/${USER_CASPAR}/.config/openbox/autostart" <<AST
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/${USER_CASPAR}/.Xauthority

xset s off
xset s noblank
xset -dpms
unclutter -idle 1 -root &

# xrandr (apply-layout) resets MetaMode — run layout first, then NVIDIA policy (with retries).
_layout="\${HOME}/.config/highascg/apply-layout.sh"
if [ -x "\$_layout" ]; then
  "\$_layout"
elif [ -x /etc/highascg/apply-layout.sh ]; then
  /etc/highascg/apply-layout.sh
fi
( sleep 6; [ -x /usr/local/bin/highascg-nvidia-x-apply.sh ] && /usr/local/bin/highascg-nvidia-x-apply.sh ) &
( sleep 18; [ -x /usr/local/bin/highascg-nvidia-x-apply.sh ] && /usr/local/bin/highascg-nvidia-x-apply.sh ) &

if [ -f /etc/highascg/display-mode ] && grep -q '^x11-only\$' /etc/highascg/display-mode; then
  if command -v BlackmagicDesktopVideoSetup >/dev/null 2>&1; then
    (sleep 2 && BlackmagicDesktopVideoSetup) &
  elif command -v desktopvideo_setup >/dev/null 2>&1; then
    (sleep 2 && desktopvideo_setup) &
  fi
  if command -v xterm >/dev/null 2>&1; then
    (xterm -e 'bash -c "echo X11-only: CasparCG not started.; echo Resume: sudo highascg-display-mode normal; read"') &
  fi
else
  if systemctl is-active --quiet casparcg-server.service 2>/dev/null; then
    : # WO-73: Caspar owned by systemd — Openbox autostart must not duplicate scanner/run.sh
  elif systemctl is-enabled --quiet casparcg-server.service 2>/dev/null; then
    : # enabled but not active yet — skip legacy autostart
  else
  _runpid=/tmp/caspar-runsh.pid
  if [ -f "\$_runpid" ] && kill -0 "\$(cat "\$_runpid")" 2>/dev/null; then
    exit 0
  fi
  (
    cd ${PLAYOUT} || exit 0
    command -v casparcg-scanner >/dev/null && casparcg-scanner &
    # run.sh relaunches on AMCP RESTART and kills hung teardown (CASPAR_RESTART_HANG_SEC).
    # Use CASPAR_RESPAWN=1 only while debugging CEF crashes.
    [ -x ./run.sh ] && exec ./run.sh >> /tmp/caspar.log 2>&1
  ) &
  fi
fi
AST
chmod +x "/home/${USER_CASPAR}/.config/openbox/autostart"
chown -R "${USER_CASPAR}:${USER_CASPAR}" "/home/${USER_CASPAR}/.config"

systemctl enable nodm 2>/dev/null || true
systemctl restart nodm 2>/dev/null || true

echo
ok "autostart → /home/${USER_CASPAR}/.config/openbox/autostart"
echo "Logs: /tmp/caspar.log"
echo "DeckLink GUI mode: sudo highascg-display-mode x11-only"
