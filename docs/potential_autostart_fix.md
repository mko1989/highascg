### Canonical `run.sh` (repo)

Use **`tools/casparcg-run.sh`** in this repository — it replaces the older pattern (`RET=5` + tight relaunch) with:

- **`</dev/null`** on the Caspar binary so stdin never blocks odd shutdown paths.
- **`CASPAR_RESTART_GRACE_SEC`** (default **2**) between exit and the next start so AMCP **5250** / CEF can release (tune to **3–5** if the second start fails with “address already in use”).
- **`CASPAR_RESTART_EXIT_CODES`** (default **`5`**) — space-separated list if your build uses another restart status.

Install on the playout host:

```bash
sudo install -m 0755 tools/casparcg-run.sh /opt/casparcg/run.sh
```

**If AMCP `RESTART` still “hangs”** (no second process, log stops): the Caspar process is stuck *inside* teardown — the shell is still waiting on the first `casparcg`. The wrapper cannot fix that. Try: close HTML producers before restart, wipe **`cef-cache`**, shorten **`command-line-args`** / disable GPU in config, or use **`KILL`** and rely on **`CASPAR_RESPAWN=1`** or systemd **`Restart=`** instead of `RESTART`.

**If RESTART exits with a code other than 5** (wrapper exits and does not relaunch): run once, send `RESTART`, then `echo $?` in a wrapper, or check logs — set e.g. `export CASPAR_RESTART_EXIT_CODES="5 42"` before `run.sh`.

---

### Example Openbox autostart (reference)

```text
casparcg@serwer:~$ cat /home/casparcg/.config/openbox/autostart
#!/bin/bash

export DISPLAY=:0
export XAUTHORITY=/home/casparcg/.Xauthority

# Disable screen blanking
xset s off
xset s noblank
xset -dpms

# Hide mouse cursor
unclutter -idle 1 -root &

# --- Single instance lock (prevents duplicate starts) ---
(
  exec 9>/tmp/caspar-openbox-autostart.lock
  if ! flock -n 9; then
    exit 0
  fi

  ulimit -c unlimited

  cd /opt/casparcg || exit 1

  /usr/bin/casparcg-scanner &

  # Clean cache before start
  rm -rf /opt/casparcg/cef-cache/* 2>/dev/null

  # --- START CASPARCG (set CASPAR_RESPAWN=1 while debugging CEF crashes) ---
  # export CASPAR_RESPAWN=1
  # export CASPAR_RESTART_SLEEP=5
  bash /opt/casparcg/run.sh >> /tmp/caspar.log 2>&1

) &
```

Optional before `run.sh`: `export CASPAR_RESTART_GRACE_SEC=3` if the child often fails to bind **5250** on the immediate relaunch.

### Verify the loader (on the server)

After `export LD_LIBRARY_PATH=/opt/casparcg/lib` the same way as `run.sh`:

```bash
ldd /opt/casparcg/bin/casparcg | head -40
ldd /opt/casparcg/lib/libcef.so | egrep 'x264|ffmpeg|icu|nss|glib'
```

Anything you want **only** from your tree (e.g. `libx264`) must resolve to a path under `/opt/casparcg/lib`. If you still see `/usr/lib/.../libx264.so`, copy or symlink your build’s `libx264.so*` into `/opt/casparcg/lib` with matching **SONAME** (e.g. `libx264.so.164`), or rebuild Caspar/FFmpeg so dependencies are bundled there.

Check the binary’s runpath (should prefer your lib dir if you linked that way):

```bash
readelf -d /opt/casparcg/bin/casparcg | egrep 'RPATH|RUNPATH'
```

### About the `partition_root.h` / `libx264` crash

Stacks often show **both** `libcef.so` and `/usr/lib/.../libx264.so` — that mix can trigger hard-to-debug allocator / alignment failures inside Chromium’s PartitionAlloc. **Pinning** `libx264` (and any other codec libs Caspar loads) under `/opt/casparcg/lib` with a strict `LD_LIBRARY_PATH` is the first thing to try; if it still crashes, rebuild/run with a single consistent toolchain (same glibc, same build flags) for CEF, Caspar, and FFmpeg.

### Segfault right after “Using CEF cache path”

Often still **GPU / driver / bad cache**. With **`CASPAR_RESPAWN=1`**, try between crashes: **wipe** `/opt/casparcg/cef-cache/*`, set **`<enable-gpu>false</enable-gpu>`** under **`<html>`** in `casparcg.config` (or trim **`<command-line-args>`**), confirm **`LD_LIBRARY_PATH`** only sees your **`libEGL.so` / `libGLESv2.so`** next to **`libcef.so`**. Use **cores** under **`ulimit -c unlimited`** with the autostart snippet above if you need a backtrace.

### Autostart log line

Use a single append redirect for the log (avoid duplicate `>` / `2>&1`), as in the `autostart` snippet above.

### Restart Caspar after a config change

The `run.sh` loop runs Caspar again when the process exits with a **restart** status (default **5**; override with **`CASPAR_RESTART_EXIT_CODES`**). **`tools/casparcg-run.sh`** adds a short **`CASPAR_RESTART_GRACE_SEC`** pause before the next start. **Saving a new `casparcg.config` on disk does not by itself exit the process**, so Openbox will not re-run `run.sh` until you log in again.

**Preferred (no extra process kill):** send **AMCP `RESTART`** after the file is written — Caspar reloads/restarts according to your build. HighAsCG **Settings → System → Write & restart** does exactly that (writes XML, then `RESTART` on port **5250**). Or manually, from any host that reaches the playout machine:

```bash
# Replace host if Caspar AMCP is not local
printf 'RESTART\r\n' | nc -N 127.0.0.1 5250
```

**After a segfault while tuning CEF / config:** enable **`CASPAR_RESPAWN=1`** in autostart (see commented `export` lines above). Then each crash waits **`CASPAR_RESTART_SLEEP`** seconds and starts Caspar again — new **`casparcg.config`** on disk is read on every start. To retry immediately without waiting for a crash: **`pkill -f '/opt/casparcg/bin/casparcg'`** (only the `casparcg` binary; leave the `bash run.sh` parent running).

**Hard restart via AMCP:** **`RESTART`** on port 5250 (see above) — useful when Caspar stays up and you only changed config.

**If you edited `run.sh` itself** (e.g. `LD_LIBRARY_PATH`): the running `bash` already loaded the old script — **`pkill` casparcg is not enough**. Kill the **`run.sh`** bash (e.g. find its PID, `kill <pid>`), then start again from a terminal with **`DISPLAY=:0`** or re-login.

**Scanner:** restarting Caspar does not restart **casparcg-scanner**; restart that separately if you change scanner config (`pkill casparcg-scanner` then start it again, or log out/in).
