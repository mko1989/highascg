# WO-154 — Long looping clip decays to ~50% speed after 2nd/3rd wrap

**Status:** Workaround implemented (opt-in, 2026-07-08) — root cause is CasparCG-internal; live validation pending
**Priority:** High (on-air playback speed)
**Date:** 2026-07-08
**Source:** owner report ("long clip in a loop, on second or third loop the playback gets slower, looks like 50%")

---

## 1. Diagnosis (2026-07-08, measured live)

- Clip: `PiekloKobiet_S01E01_Master…HAP` — 3072×1728 **HAP**, 25 fps, **436 Mbps**, 147 GB, 2850.4 s
  (47.5 min), multiple audio streams. Looping on look layer 1-10; channel 1 = 2160p50 → DeckLink 8K Pro.
- **Measured 50.2% real speed**: OSC `file.elapsed` advanced 5.02 s per 10.00 s wall clock.
- NOT resource starvation: iowait 0, NVMe read (~21 MB/s) *follows* the half-rate decode (realtime
  needs ~55 MB/s), 28 cores ~89% idle.
- **Timing locks to loop wraps**: first PLAY 14:02 → wraps ≈ 14:50 / 15:37; DeckLink
  `Failed to schedule primary video` errors begin 15:48, i.e. right after wrap #2 — matching the
  owner's "second or third loop".
- Every start logs `[Parsed_amerge_0] No channel layout for input 1` — that `amerge` is
  **CasparCG's internal merge of the file's multiple audio streams** (our AF only sends `pan=`),
  so the suspected audio-paced decay at the producer's internal seek-to-0 wrap is NOT reachable
  from AMCP. (Red herring eliminated during diagnosis: OSC also showed the same clip on layers
  200–205 — those were stale OSC ghosts of stopped timeline layers, `INFO 1` shows them empty;
  the WO-151 prune removes such ghosts after restart.)

## 2. Workaround implemented (fresh producer at each wrap)

A fresh producer always plays realtime — so near each wrap the app re-issues the layer's ORIGINAL
`PLAY … LOOP …` line verbatim (audio filter included), replacing Caspar's internal wrap with a
producer reopen. Visual cost: a cut at the loop point (Caspar's wrap is a cut anyway) and the last
~2.5 s of the clip skipped per loop.

- `src/state/playback-tracker.js` — captures the full original PLAY line on looping foreground
  plays into the playback matrix (`playLine`).
- `src/engine/loop-restart-watchdog.js` (new) — 1 s poll over the matrix + OSC elapsed; when a
  managed layer is within `marginMs` of its wrap, re-sends `playLine` (10 s cooldown per layer).
  Timeline-engine loops are excluded by design (already app-driven restarts).
- `index.js` — watchdog started with the other lifecycles; inert unless enabled.

**Enable (owner): add to `config/general.json`:**

```json
"playback": { "appManagedLoop": { "enabled": true, "minDurationSec": 600, "marginMs": 2500 } }
```

## 3. Tasks / acceptance

- [x] T154.1 Diagnosis with live measurements (above).
- [x] T154.2 Watchdog implemented + smoke `smoke-loop-restart-watchdog.test.js` (3/3: exact-line
  re-issue near wrap, cooldown, unmanaged cases).
- [ ] A154.1 Owner validation: enable the flag, restart the service, loop the same clip through
  3+ wraps → elapsed advances 10 s per 10 s wall clock on every loop
  (`log` shows `[loop-restart] re-issuing fresh producer near wrap`).
- [ ] A154.2 Immediate relief without restart: re-take the look (fresh producer) — realtime until
  the next wrap.
- [ ] T154.3 (upstream) Consider reporting to CasparCG: HAP + multi-audio-stream file + LOOP wrap
  → producer decays to half speed; repro data in §1.

## 4. Work log

- 2026-07-08 — Diagnosed + workaround implemented (orchestrator). Takes effect on next service
  restart AND requires the config flag (default off).
