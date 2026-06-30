#!/usr/bin/env bash
# Step 9: Openbox autostart — X session only (layout, NVIDIA policy). Caspar + scanner = systemd (WO-73).
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
	install -m 755 "${PLAYOUT}/tools/runtime/confine-cursor.py" /usr/local/bin/confine-cursor.py
	chmod 755 /usr/local/bin/confine-cursor.py
	install -m 755 "${PLAYOUT}/tools/runtime/confine-pointer-barriers.py" /usr/local/bin/confine-pointer-barriers.py
	chmod 755 /usr/local/bin/confine-pointer-barriers.py
	ok "nvidia-x-apply + confine-pointer-barriers installed"
fi

install -m 755 "${PLAYOUT}/tools/runtime/capture-boot-xrandr.sh" /usr/local/bin/highascg-capture-boot-xrandr.sh
chmod 755 /usr/local/bin/highascg-capture-boot-xrandr.sh
ok "boot xrandr capture installed"

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

# WO-73: when casparcg-server.service is installed, Openbox must not reference run.sh at all.
if [[ -f /etc/systemd/system/casparcg-server.service ]]; then
	CASPAR_PLAYOUT_BLOCK='# WO-73: playout via casparcg-server.service + casparcg-scanner.service (systemd).'
else
	CASPAR_PLAYOUT_BLOCK="$(cat <<LEGACY
  # Legacy fallback when casparcg-server.service is not installed (no scanner here).
  exec 9>>/tmp/caspar-runsh.lock
  flock -n 9 || exit 0
  (
    cd ${PLAYOUT} || exit 0
    [ -x ./run.sh ] && exec ./run.sh >> /tmp/caspar.log 2>&1
  ) &
LEGACY
)"
fi

cat >"/home/${USER_CASPAR}/.config/openbox/autostart" <<AST
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/${USER_CASPAR}/.Xauthority

xset s off
xset s noblank
xset -dpms
unclutter -idle 2 -root &

# GPU port names for Device View (before apply-layout mutates modes).
if [ -x "${PLAYOUT}/tools/runtime/capture-boot-xrandr.sh" ]; then
  HIGHASCG_REPO="${PLAYOUT}" "${PLAYOUT}/tools/runtime/capture-boot-xrandr.sh" || true
elif [ -x /usr/local/bin/highascg-capture-boot-xrandr.sh ]; then
  HIGHASCG_REPO="${PLAYOUT}" /usr/local/bin/highascg-capture-boot-xrandr.sh || true
fi

# xrandr (apply-layout) resets MetaMode — layout first, then one NVIDIA policy pass with retries.
_layout="\${HOME}/.config/highascg/apply-layout.sh"
if [ -x "\$_layout" ]; then
  "\$_layout"
elif [ -x /etc/highascg/apply-layout.sh ]; then
  /etc/highascg/apply-layout.sh
fi
(
  sleep 6
  for _nv in 1 2; do
    [ -x /usr/local/bin/highascg-nvidia-x-apply.sh ] && /usr/local/bin/highascg-nvidia-x-apply.sh
    [ "\$_nv" -eq 2 ] && break
    sleep 12
  done
) &

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
${CASPAR_PLAYOUT_BLOCK}
fi
AST
chmod +x "/home/${USER_CASPAR}/.config/openbox/autostart"
chown -R "${USER_CASPAR}:${USER_CASPAR}" "/home/${USER_CASPAR}/.config"

if [[ "${OPENBOX_SKIP_NODM_RESTART:-0}" != "1" ]]; then
	systemctl enable nodm 2>/dev/null || true
	systemctl restart nodm 2>/dev/null || true
else
	ok "skipped nodm restart (OPENBOX_SKIP_NODM_RESTART=1)"
fi

echo
ok "autostart → /home/${USER_CASPAR}/.config/openbox/autostart"
echo "Logs: /tmp/caspar.log"
echo "DeckLink GUI mode: sudo highascg-display-mode x11-only"
