# Openbox autostart — X session only (layout, NVIDIA). Caspar + scanner = systemd (WO-73).

**Current installer:** `scripts/setup/09-openbox-autostart.sh` writes `~/.config/openbox/autostart` for the Caspar user. It does **not** start `casparcg-scanner` or `run.sh` when `casparcg-scanner.service` / `casparcg-server.service` are enabled (`scripts/setup/13-caspar-systemd-units.sh`).

- **`casparcg-scanner.service`** — `After=network.target` only (no X, no nodm).
- **`casparcg-server.service`** — runs `run.sh` under systemd.

Sync wiring: `sudo bash scripts/setup/sync-caspar-supervisor-wiring.sh`

---

## Why `sudo systemctl restart nodm` did not stop Caspar (legacy)

1. **Background `&`** — The `while true; do … done &` block detaches from Openbox. After a nodm/X restart, those processes are **not always** in the same process tree as the new session; old loops can **keep running** (orphaned or still under a surviving user manager).
2. **Autostart runs again** — Each new X session executes `autostart` again, so you get **another** `while true` loop → **another** Caspar main process while the old one may still be alive.
3. **Caspar spawns many children** — Only the “main” lines without `--type=` are extra servers; killing X does not guarantee all of them exit together if multiple mains were started.

**Operational rule:** before or after a nodm restart, assume you may need to **stop Caspar explicitly** once:

```bash
# See main server processes (no CEF --type= helpers)
pgrep -af 'casparcg-server-2.5 /opt/casparcg/config/casparcg.config' | grep -v -- '--type='

# Stop them (run as user that owns the processes, or use sudo if needed)
pkill -f '/usr/bin/casparcg-server-2.5 /opt/casparcg/config/casparcg.config'
# Wait until none left, then restart nodm or let autostart start a single instance.
```

Use **`pkill -f`** carefully: it matches the full command line; adjust if your config path differs.

---

## Recommended autostart (single loop, single Caspar)

Use a **file lock** so only **one** autostart loop can run, even if Openbox runs `autostart` multiple times.

```bash
#!/bin/bash
export DISPLAY=:0
export XAUTHORITY=/home/casparcg/.Xauthority

xset s off
xset s noblank
xset -dpms
unclutter -idle 1 -root &
# Optional (production installer): NVIDIA Sync to VBlank off — see install-phase2.sh / docs/reference/screen-consumer-vsync-nvidia.md
# [ -x /usr/local/bin/highascg-nvidia-x-apply.sh ] && /usr/local/bin/highascg-nvidia-x-apply.sh

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
    export CASPAR_RESPAWN=1
    ./run.sh >> /tmp/caspar.log 2>&1
  ) &
fi
```

**Installer:** `scripts/install-phase3.sh` writes this logic to `~/.config/openbox/autostart` for the Caspar user (with `XAUTHORITY=/home/<user>/.Xauthority`). It inserts the **NVIDIA** line above after `unclutter` when `/usr/local/bin/highascg-nvidia-x-apply.sh` exists (Phase 2).

Notes:

- **`flock -n`** — If another session already holds `/tmp/caspar-openbox-autostart.lock`, this autostart **does nothing** (no second Caspar loop).
- **CEF cache** — Each restart clears **everything** under `/opt/casparcg/cef-cache` (`find … -mindepth 1 -delete`) so stale Chromium profile data does not accumulate.
- **Port check** — `grep -qE ':5250\b'` is a bit stricter than `grep 5250`.

---

## Restart workflow (suggested)

1. **Planned restart:**  
   `pkill -f '/usr/bin/casparcg-server-2.5 /opt/casparcg/config/casparcg.config'` → wait until `pgrep` shows none → `sudo systemctl restart nodm` (or reboot).

2. **After unclean restart:**  
   If you see **more than one** main `casparcg-server-2.5 … casparcg.config` without `--type=`, kill all mains as above once, then let **one** autostart loop respawn Caspar (or restart nodm after the kill).

3. **Long term (current):** Caspar runs as **systemd** units (`casparcg-scanner.service`, `casparcg-server.service`); Openbox handles X utilities and display layout only.

---

## Previous inline script (for diff / history)

```bash
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
  cd /opt/casparcg
  /usr/bin/casparcg-scanner &
  while true; do
    cd /opt/casparcg
    mkdir -p /opt/casparcg/cef-cache
    find /opt/casparcg/cef-cache -mindepth 1 -delete 2>/dev/null || true
    /usr/bin/casparcg-server-2.5 /opt/casparcg/config/casparcg.config >> /tmp/caspar.log 2>&1
    while ss -tlnp | grep -q 5250; do sleep 1; done
    sleep 2
  done &
fi
```

Problem: no lock → every new Openbox autostart could start **another** background loop → multiple Caspar mains.
