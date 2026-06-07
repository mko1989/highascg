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
	mkdir -p /etc/X11/Xsession.d
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

	cat >/usr/local/bin/highascg-nvidia-x-apply.sh <<'EOF'
#!/bin/bash
command -v nvidia-settings &>/dev/null || exit 0
for _g in 0 1 2 3; do
	nvidia-settings -q "[gpu:${_g}]/GPUPowerMizerMode" &>/dev/null || continue
	nvidia-settings -a "[gpu:${_g}]/GPUPowerMizerMode=2" 2>/dev/null ||
		nvidia-settings -a "[gpu:${_g}]/GPUPowerMizerMode=1" 2>/dev/null || true
done
for _g in 0 1 2 3; do
	nvidia-settings -q "[gpu:${_g}]/SyncToVBlank" &>/dev/null || continue
	nvidia-settings -a "[gpu:${_g}]/SyncToVBlank=0" 2>/dev/null || true
done
nvidia-settings -a "[gpu:0]/SyncToVBlank=0" 2>/dev/null || true
nvidia-settings -a "[screen:0]/SyncToVBlank=0" 2>/dev/null || true
EOF
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
[ -x /usr/local/bin/highascg-nvidia-x-apply.sh ] && /usr/local/bin/highascg-nvidia-x-apply.sh

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
  (
    exec 9>/tmp/caspar-openbox-autostart.lock
    flock -n 9 || exit 0

    cd ${PLAYOUT} || exit 1
    command -v casparcg-scanner >/dev/null && casparcg-scanner &
    export CASPAR_RESPAWN=1
    [ -x ./run.sh ] && exec ./run.sh >> /tmp/caspar.log 2>&1
  ) &
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
