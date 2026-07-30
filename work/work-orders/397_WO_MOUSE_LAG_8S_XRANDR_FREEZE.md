# WO-397 — Mouse lag ROOT-CAUSED: the 8 s pointer-confine watchdog freezes X ~370 ms per tick via uncached xrandr

**Status: OPEN — diagnosis complete and causally proven; fix proposed below, awaiting owner go-ahead**
**Source:** owner 30.07.26: "i still these small lags of mouse. it definitly feels like there is something firing in the background that makes the pc lag. i want you to do a thorough reserch into that."
**Related:** WO-391 (prior investigation — poll loop disproven, §7 left the lag "still unexplained"; §7's candidates 1–2 were already fixed and were NOT it), WO-391c (the xrandr cache whose TTL makes it useless here).

---

## 1. Investigation (2026-07-30, all measured live on the box)

### 1.1 Objective measurement — the lag is real, periodic, and exactly clocked

An in-process X round-trip probe (`XQueryPointer` via ctypes at 50 Hz, no forks — script in the
session scratchpad, `x-latency-probe.py`) over 3 minutes:

```
samples=8518  p50=0.07ms  p95=0.20ms  p99=2.56ms  max=190.8ms  spikes>15ms=47
SPIKE 15:19:27.369 rtt=171.7ms     SPIKE 15:19:27.572 rtt=183.2ms
SPIKE 15:19:35.369 rtt=170.3ms     SPIKE 15:19:35.576 rtt=186.3ms
SPIKE 15:19:43.369 rtt=174.7ms     SPIKE 15:19:43.574 rtt=184.5ms
… (every 8.000 s, phase drift < 2 ms over 2 min) …
```

**Two back-to-back ~180 ms X-server freezes every 8.000 seconds** — ~370 ms of dead cursor per
tick. The drift-free phase is the signature of a node `setInterval`, not a sleep loop. A second,
sparser pair rides a ~30 s cadence (15:19:56.691/.892 etc.).

### 1.2 Who fires — caught in the act

A 50 Hz /proc scanner (`catch-forks.py`) captured the process bursts. At every 8 s tick, parent
`node /home/casparcg/highascg/index.js` (pid 2132378) spawns, in order:

```
15:23:27.190  /bin/sh -c xrandr --verbose      ← freeze #1 (EDID read of every output)
15:23:27.399  /bin/sh -c xrandr --query        ← freeze #2
15:23:27.585  /bin/sh -c nvidia-smi --query-gpu=gpu_name  (×3)
15:23:43.379  modetest -c                      (some ticks)
```

Correlation sampler: each tick = 6–17 forks + **Xorg burning 310–380 ms CPU** in that 500 ms
window. Same spawns repeat at 15:23:35.18, 15:23:43.19 — the exact spike phase.

### 1.3 Causality — proven, not correlated

With the probe running and the 8 s tick out of frame, one manual `xrandr --verbose` (386 ms wall):

```
fired 15:25:56.490 → SPIKE .680 (173ms)  SPIKE .870 (170ms)  SPIKE 57.068 (178ms)
```

One xrandr --verbose = ~350 ms of X unresponsiveness, on demand. `xrandr --verbose` re-reads
EDID from every output through the NVIDIA driver; the X main thread serves nothing else while
each block runs.

### 1.4 The code chain

1. `src/system/pointer-confine.js:131` — `startBarrierWatchdog` `setInterval(…, 8000)` calls
   `startPointerConfine(config)` every tick.
2. `startPointerConfine` (:281-282) computes `const layout = opts.layout ||
   calculateLayoutPositions(config)` and `resolveOperatorMonitorRect` **BEFORE** the
   steady-state "unchanged" shortcut at :289 — so the full layout derivation runs every tick
   even when nothing changed and the only real work needed is a pgrep.
3. `calculateLayoutPositions` → GPU layout assignment → display/GPU inventory →
   `getDisplaysXrandrVerboseRaw` (**`xrandr --verbose`**) + `xrandr --query` +
   `nvidia-smi --query-gpu=gpu_name` ×3 (+ `modetest -c` on some paths).
4. The WO-391c cache never absorbs this: `XRANDR_CACHE_TTL_MS = 3000` (hardware-info-xrandr.js
   :185-187) — **3 s TTL vs an 8 s caller**. Every tick is a guaranteed cache miss. The ~30 s
   OS-Config layout watchdog pays the same misses (the off-phase spike pair).

### 1.5 Why WO-391 missed it

WO-391 profiled the *python confine helper* (which is genuinely clean now — 0 forks, RandR
events) and the xdotool/spawnSync storms. The 8 s **node-side** watchdog was added as the "safe"
retry mechanism (§9.2: "leans on the existing 8s retry") — nobody costed the layout
recomputation inside `startPointerConfine` itself. §7's advice "note what was on screen" turned
out unnecessary; the lag is unconditional, every 8 s, idle or not.

### 1.6 Ruled out this round / background findings (not the lag)

- `run.sh` (pid 12556) forks `ss -tlnp` + `grep` + `sleep 1` **every second, forever** — the
  Caspar port-wait loop apparently never exits its check loop. ~3 forks/s, no X contact, cheap
  but worth killing someday.
- `lsblk -J` every ~6 s (USB-ingest watcher) — no X, cheap.
- vcam bridge ffmpeg at **39 % CPU** looping a still JPEG at 50 fps into /dev/video10 —
  constant load, not periodic; candidate for `-framerate 5` someday.
- Xorg baseline 13.5 % CPU; no swap, no PSI pressure (unchanged from WO-391).

## 2. Proposed fix (not yet applied — owner asked for research)

Ranked, smallest-first; 1+2 together are the real fix:

1. **Make the steady-state watchdog tick X-free** (`pointer-confine.js`): move the
   layout/rect computation BELOW the "still running + still desired" check. Tick =
   `evaluateOperatorPointerConfineDesire` (pure) + `isBarrierDaemonRunning` (pgrep). Recompute
   layout only on transition (daemon dead / desire flipped) — and on layout *apply*, which
   already calls `startPointerConfine` with a fresh `opts.layout`.
2. **Raise `XRANDR_CACHE_TTL_MS` above the slowest periodic consumer** (e.g. 60 s; env override
   already exists). Layout applies already call `invalidateXrandrCache()`, and the confine
   helper gets geometry from RandR events — nothing needs 3 s freshness. This also silences the
   ~30 s OS-Config watchdog's misses.
3. Optional hygiene: cache `nvidia-smi gpu_name` (it cannot change at runtime) and audit
   `modetest -c` on the same path.

Expected result: X freeze events drop from every 8 s to only on real layout transitions; the
probe (§1.1) re-run should show p99 < 3 ms and zero periodic spikes.

## 3. What was VERIFIED

- Diagnosis verified as in §1 (probe + fork capture + manual causality reproduction, all on the
  live box, 2026-07-30 15:19–15:26 UTC). No fix applied yet.
