#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/casparcg/.Xauthority

xset s off
xset s noblank
xset -dpms
unclutter -idle 1 -root &

if [ -f /etc/highascg/display-mode ] && grep -q '^x11-only$' /etc/highascg/display-mode; then
  if command -v desktopvideo_setup >/dev/null 2>&1; then
    (sleep 2 && desktopvideo_setup) &
  fi
  if command -v xterm >/dev/null 2>&1; then
    (xterm -e 'bash -c "echo X11-only: CasparCG not started.; echo Open Desktop Video Setup from the menu.; echo Resume: sudo highascg-display-mode normal; read"') &
  fi
else
  # --- Single instance: second autostart exits immediately (nodm/X restart, duplicate runs) ---
  (
    exec 9>/tmp/caspar-openbox-autostart.lock
    if ! flock -n 9; then
      exit 0
    fi

    cd /opt/casparcg || exit 1
    /usr/bin/casparcg-scanner &

    while true; do
      cd /opt/casparcg || exit 1
      rm -r /opt/casparcg/cef-cache/* 2>/dev/null
      /usr/bin/casparcg-server-2.5 /opt/casparcg/config/casparcg.config >> /tmp/caspar.log 2>&1
      # Wait until nothing listens on AMCP (adjust port if your config differs)
      while ss -tlnp 2>/dev/null | grep -qE ':5250\b'; do sleep 1; done
      sleep 2
    done
  ) &
fi
