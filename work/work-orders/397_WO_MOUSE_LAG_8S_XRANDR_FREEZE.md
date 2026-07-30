# WO-397 — Mouse lag ROOT-CAUSED: the 8 s pointer-confine watchdog freezes X ~370 ms per tick via uncached xrandr

**Status: DONE (2026-07-30 — fix deployed and probe-verified: 3-min spike count 47 → 6, p99 2.56 ms → 0.34 ms; details §3. Owner: feel-check the mouse)**
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

## 2. What was done (owner go-ahead 30.07: "do the 397")

1. **X-free steady-state watchdog tick** (`src/system/pointer-confine.js`): the 8 s tick now
   passes `steadyTick: true`; `startPointerConfine` short-circuits on the new
   `activeConfineRect` (cached at every `activeConfineKey` assignment, cleared on stop) +
   `isBarrierDaemonRunning` (pid-file/pgrep) BEFORE any layout computation. Geometry drift in
   steady state is the barrier daemon's own job (RandR events, WO-391b). Every non-tick caller
   — and a tick that finds the daemon dead — still pays the full recomputation, so operator-
   monitor changes and retries behave exactly as before.
2. **`XRANDR_CACHE_TTL_MS` default 3000 → 60000** (`src/utils/hardware-info-xrandr.js`) — the
   TTL now outlives the periodic consumers; layout applies still `invalidateXrandrCache()`
   explicitly, so a real change is never served stale. Env override unchanged.
3. **`getGpuModel()` memoized forever** (`src/utils/hardware-info.js`) — nvidia-smi ran 3× per
   layout computation for a value that cannot change at runtime; nulls memoized too.
4. Guards: `tools/smoke/smoke-wo397-confine-tick-x-free.test.js` (steadyTick marker, fast path
   ordered before `calculateLayoutPositions`, rect cleared on stop, TTL default, memo) in the
   curated CI list.

## 3. What was VERIFIED

- Diagnosis as in §1 (probe + fork capture + manual causality reproduction, live box,
  2026-07-30 15:19–15:26 UTC).
- Suite **1750 pass / 0 fail / 2 skip** (incl. the new smoke); unwired-exports gate clean.
- Live after service restart (same 3-minute probe, 15:38–15:41):
  - **spikes >15 ms: 47 → 6** (three ~180 ms pairs at 15:38:46 / 15:39:52 / 15:40:56 — ~65 s
    apart), `p99 2.56 ms → 0.34 ms`, p50/p95 unchanged-good.
  - Fork capture over 25 s: **zero** 8 s xrandr spawns; exactly one `--verbose`+`--query` pair
    (the ~60 s TTL expiry consumed by the OS-Config layout watchdog) — matches the probe.
- Residual: one ~370 ms freeze pair per ~65 s (was one per 8 s — ~87 % less frozen time, and no
  longer at a felt-every-few-seconds cadence). If the owner still feels it, the next lever is
  one env var (`HIGHASCG_XRANDR_CACHE_TTL_MS=600000` → one pair per 10 min) or making the
  OS-Config layout watchdog event-driven — record as WO-397b if wanted.
- Owner QA: use the mouse normally for a few minutes — the every-8-seconds hitch should be gone.
