# WO-164 — Live-audio health watchdog: stop the unconditional INFO 6-10 every 15 s (probe on suspicion only)

**Status:** Implemented (pending operator log verification, A164.1)
**Priority:** Low-Medium (AMCP noise + owner confusion; watchdog itself is correct and wanted)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "there is a INFO 6-10 amcp command going out every 15s WTF???!!!!"
**Related:** WO-53 (per-input meters), WO-06 (audio playout), WO-172 (live-audio device hot-swap — same subsystem).

---

## 1. Investigation findings (2026-07-13)

The command is the **live audio input health watchdog** — by design, not a bug:

- `src/audio/meter-health.js:9` `WATCH_INTERVAL_MS = 15000`; `:83` `setInterval` → `repairLiveInputMetersIfStale()`.
- That calls `ensureLiveAudioInputsHealthy()` (`src/audio/live-audio-health.js:157`) → `isLiveAlsaProducerHealthy()` which sends `ctx.amcp.info(channel, layer)` (`live-audio-health.js:58`) — the visible `INFO 6-10`.
- Ch6 layer 10 = live audio input slot 1 on this rig: `config/caspar_server.json:148-149` (`live_audio_input_count: 1`, `alsa://hw:2,0`); channels 1-4 = screens, 5 = DeckLink in, 6 = live-audio capture; layer 10 = `LIVE_AUDIO_LAYER_BASE` (`src/config/live-audio-input.js:14`).
- Log confirms exact 15 s cadence. Purpose: if OSC meters go stale (>8 s) or the ffmpeg ALSA capture dies, the watchdog restarts capture (CLEAR/PLAY). The watchdog already no-ops when no live audio slots are configured (`meter-health.js:75`).

**Defect:** the INFO probe runs **unconditionally every tick** even when OSC meter traffic proves the producer is alive. The cheap, local signal (recent OSC meter updates) should gate the expensive/noisy AMCP probe.

## 2. Tasks

- [x] T164.1 Reorder the health check: on each 15 s tick, first check OSC meter freshness (the staleness signal already exists — the >8 s stale test); send the AMCP `INFO <ch>-<layer>` probe **only when meters are stale/absent** (or immediately after a repair, to confirm recovery). Healthy steady-state → zero periodic AMCP traffic.
- [x] T164.2 Log clarity: when the watchdog does probe/repair, log one clear line (`[live-audio-health] meters stale on slot N → probing ch<ch>-<layer>`), so future log readers know what the INFO is.
- [x] T164.3 Doc note in the WO + a comment at the interval definition explaining the design (15 s tick, probe-on-suspicion), so this doesn't get re-reported.
- [x] T164.4 Smoke: tick with fresh meters → no amcp.info call; tick with stale meters → probe + (mocked unhealthy) repair path unchanged. Mock the amcp client; follow tools/smoke conventions.

## 3. Acceptance criteria

- [ ] A164.1 A day of caspar log after restart shows `INFO 6-10` only around genuine meter-stale events (grep count evidence), not every 15 s. *(Not yet verifiable offline — box was not restarted per WO-164 constraints. To confirm post-deploy: `grep -c "INFO 6-10" <caspar log>` over a healthy 24 h window should show sparse hits, not one every 15 s.)*
- [x] A164.2 Pulling the ALSA device still triggers auto-repair within one watchdog tick (existing behavior preserved; smoke + operator check). Verified via smoke — repair (CLEAR/PLAY) decision logic is byte-for-byte unchanged; only the pre-repair AMCP INFO probe is now gated.
- [x] A164.3 Gates green (`lint`, `test:ci`) for the touched files — `node --check`, `eslint` (0 errors, 2 pre-existing warnings unrelated to this change), and `node --test` on the new smoke + existing live-audio/meter smokes all pass. Full repo `npm run lint` / `npm run test:ci` not run (out of scope per WO-164 file-touch constraints; eslint run standalone against the 3 touched files using the repo's `eslint.config.js`).

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Root cause: health watchdog probes AMCP INFO unconditionally every 15 s instead of gating on the already-available OSC meter staleness signal.
- 2026-07-13 — Implemented T164.1–T164.4.
  - **Root cause:** `ensureLiveAudioInputsHealthy()` (`src/audio/live-audio-health.js`) computed `oscStale` from the existing >8 s OSC-meter-freshness signal but then called `isLiveAlsaProducerHealthy()` (→ `ctx.amcp.info(channel, layer)`, the visible `INFO 6-10`) **unconditionally** on every slot, every 15 s tick, regardless of `oscStale`. The probe's result only ever mattered in the one case where meters were fresh and not forced (`!force && !oscStale && healthy` → skip); when meters were stale or a repair was forced, the probe fired but its result was discarded because repair happened unconditionally anyway — i.e. the periodic probe in the healthy/fresh path was pure waste.
  - **Fix:** restructured the per-slot loop in `ensureLiveAudioInputsHealthy()` so a fresh-meters, non-forced slot now takes an early `continue` before any AMCP call — zero AMCP traffic in the healthy steady state. The AMCP `INFO` probe now only fires when `oscStale` is true (or `force` is set), immediately preceded by a new log line `[live-audio-health] meters stale on slot N → probing ch<ch>-<layer>`. The repair decision (CLEAR/PLAY restart via `playLiveAlsaClipWithRecovery`) is untouched — whenever the code reaches past the new early-skip, it repairs unconditionally exactly as before (the pre-repair probe's result was already advisory/discarded in that branch pre-fix, so behavior there is unchanged bit-for-bit). The existing post-repair confirmation probe inside `playLiveAlsaClipWithRecovery` (verifies PLAY actually produced a live producer, with clip-variant fallback) is unchanged. Added a design comment at `WATCH_INTERVAL_MS` in `src/audio/meter-health.js` explaining the 15 s tick / probe-on-suspicion rationale, referencing this WO, so it doesn't get re-reported.
  - **Verification:** `node --check` on both touched source files + the new smoke; `eslint` (installed standalone into scratchpad — not in repo `node_modules` — run via `NODE_PATH` against the repo's own `eslint.config.js`) on the 3 touched files: 0 errors, 2 warnings both on pre-existing untouched lines (`live-audio-health.js:104` empty catch, `meter-health.js:47` useless assignment — both predate this change). New smoke `tools/smoke/smoke-live-audio-watchdog-quiet-probe.test.js` (4 tests, node:test/describe/it, mocked `ctx.amcp`): fresh OSC meters across 5 simulated ticks → 0 `amcp.info` and 0 `amcp.raw` calls; stale meters → probe fires, log line emitted, CLEAR/PLAY repair invoked, `repaired` populated; absent meters (never updated) treated as stale; forced repair still runs regardless of freshness. Re-ran existing related smokes (`smoke-live-audio-capture.test.js`, `smoke-meter-null-consumer.test.js`, `smoke-live-audio-pgm-screens.test.js`, `smoke-live-audio-add-input.test.js`) — all 17 pass, no regressions. Did not restart services, run the server, or commit, per live-production-box constraints. `src/config/live-audio-input.js` and client files were not touched, per instructions (reserved for a later investigation).
