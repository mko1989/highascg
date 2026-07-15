# WO-252 — Feed clip duration from the AMCP INFO supplement into oscState (new binary omits it on OSC)

**Status:** OPEN
**Priority:** HIGH (feeds MV progress bars/digits, playlist stall watchdog, timer remaining/progress)
**Owner check:** A252.1

## Live-proven problem (2026-07-15)
The custom 2.6-dev binary emits `file/time = [elapsed, file_duration().value_or(0)/fps]` (av_producer.cpp:990) and on this box duration arrives absent/0 for every playing layer; `file/frame` (frameTotal) is not emitted by the producer at all. Live probe of `/api/state`: all four playing movie layers show `duration=undefined, frameTotal=undefined`. Consequences: MV bars+digits dark (WO-250's frameTotal fallback CANNOT fire), playlist stall watchdog inert (WO-251 note), timer remaining/progress unavailable.

The designed remedy exists but is incomplete: `runOscPlaybackInfoSupplementOnce` (`src/utils/periodic-sync.js:~160`) polls AMCP `INFO <ch>` per program channel (interval `osc_info_supplement_ms`, **default OFF**) and parses per-layer `durationSec/timeSec/remainingSec` via `updateChannelVariablesFromXml` (`src/utils/query-cycle.js:344-392`) — but writes them ONLY into Companion `ctx.variables`. Nothing reaches `oscState.channels[ch].layers[L].file`, which is what the MV templates, web timers, and playlist watchdog read.

## Tasks

**T252.1 — oscState supplement API** (`src/osc/osc-state.js`)
Add `applyInfoTimingSupplement(ch, layerNum, { durationSec, timeSec })`:
- Only sets `f.duration` when the OSC-provided duration is absent/0 (OSC stays authoritative when the binary provides it — rollback-safe); runs the same `isSane` clamp used in the `file/time` branch (extract/share it, don't duplicate the constant).
- Never touches `f.elapsed` (OSC elapsed is fresher than a 2s INFO poll) UNLESS elapsed is entirely absent, in which case timeSec may seed it.
- Recomputes `f.remaining`/`f.progress` the same way the `file/time` branch does (reuse, don't fork, that code — extract a small helper if needed).
- Must mark the layer fresh the same way other file updates do (whatever `_lastOscAt`-style stamp exists — investigate) so `_pruneStaleLayers` and stale checks don't fight it.

**T252.2 — supplement injects into oscState** (`src/utils/query-cycle.js` `updateChannelVariablesFromXml` or a sibling called from `runOscPlaybackInfoSupplementOnce`)
- CRITICAL INVESTIGATION FIRST: determine how `extractChannelInfoFromParsed` identifies the REAL Caspar layer number for each parsed entry (array index vs an explicit layer number field in the INFO XML — read the function and a captured INFO sample if `work/` has one; the variables path keys by array index which may itself be a latent bug — report what you find, fix the oscState injection to use REAL layer numbers, leave the variables keying as-is unless trivially wrong).
- After parsing, for each layer entry with a finite durationSec > 0: `appCtx.oscState?.applyInfoTimingSupplement(ch, layerNum, {...})` (guard oscState null).
- The INFO poll covers program channels (`getProgramChannelsForOscInfo`) — check whether bank-B physical layers (110-199) appear in INFO output and are included (they must be; INFO returns all layers on the channel).

**T252.3 — default the supplement ON** (`src/config/defaults-core.js` + `resolveOscInfoSupplementMs` in periodic-sync.js)
Default `osc_info_supplement_ms` to 2000 when unset (explicit 0 still disables; keep env override). Update the doc comment at periodic-sync.js:~125 to say the new binary needs it for durations. Note: this adds one `INFO <ch>` round-trip per program channel per 2s — cheap (the query cycle already does heavier polling).

**T252.4 — smoke** (`tools/smoke/smoke-wo252-info-duration-supplement.test.js`, curated gate)
- applyInfoTimingSupplement: sets duration when absent; does NOT override a real OSC duration; recomputes remaining/progress; insane values rejected; elapsed untouched when present.
- Parser→injection: feed a captured/synthetic INFO XML through the parse path with a stub oscState and assert the right (ch, layerNum, durationSec) calls — INCLUDING a layer above 100 if the XML sample supports it.
- resolveOscInfoSupplementMs: unset → 2000; explicit 0 → 0; explicit 500 → 500; env override respected.

## Constraints (standard)
No git, no service ops, no AMCP, no HTTP to :4200/:5250, no vite build, curated gate ONLY, never the full suite. node --check + eslint --quiet on touched files; exact gate counts; <500 lines/file (osc-state.js is at ~560 — if your additions push it further, extract the new supplement + shared helpers into a small `src/osc/osc-state-timing.js` instead); honest checkboxes.

- [ ] T252.1 oscState supplement API
- [ ] T252.2 INFO parse → oscState injection (with the real-layer-number investigation reported)
- [ ] T252.3 default 2000ms
- [ ] T252.4 smoke in gate
- [ ] A252.1 (owner) after restart: MV shows digits+bars again; playlist watchdog logs on stalled media; timer shows remaining
