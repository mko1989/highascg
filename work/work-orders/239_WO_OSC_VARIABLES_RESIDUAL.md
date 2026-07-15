# WO-239 — OSC variables parser still broken AFTER the WO-235 fixes went live

**Status:** Fixed in repo — NEEDS highascg RESTART to activate | **Priority:** HIGH | **Date:** 2026-07-15
**Source:** owner: "still something is broken in the osc variables parser" — VERIFIED REAL: service restarted 12:57 (after the 12:36 WO-235 deploy), so the type-leaf fix is active and something else remains.

## Which variables are wrong (T239.1 findings)

Variables the parser derives (src/osc/osc-variables.js): per channel `osc_ch{N}_healthy`,
`osc_ch{N}_audio_c{1..16}_dBFS`, `osc_ch{N}_audio_L/_R`; per layer
`osc_ch{N}_l{L}_clip`, `_time`, `_remaining`, `_progress` (from `layer.type`, `layer.file.{name,path,elapsed,remaining,progress,frameElapsed,frameTotal}`, `layer.template.path`).

Live probe (GET /api/state `variables` + `osc`, 12:59+ process, WO-235 fixes active) confirmed
the store feed/plumbing is NOT dead: audio dBFS variables update live, `layer.type` populates
from producer leaves (`route`/`html`/`decklink`/`transition` observed live), `playback.matrix`
populates. The residual defect is **transient by nature and was reproduced deterministically
from source + synthetic packets** (no ffmpeg clip with timers was on air during probing — ch1
L10–15 are still empty after the WO-235 T235.6 incident):

- **WRONG (frozen): `osc_ch{N}_l{L}_clip`, `_time`, `_remaining`, `_progress` for any layer that
  stops/CLEARs.** They freeze at their last values FOREVER (e.g. frozen `clip=BRIDGE/355317
  time=4.06 remaining=0.98 progress=80.6` — captured by replaying the exact packet sequence
  against the pre-fix parser) instead of clearing to `''`. This is the owner-visible "variables
  parser still broken": stale clip names/timers stuck in companion/UI after playout stops.
- Audio/healthy variables: verified CORRECT live.
- `osc_ch{N}_l{L}_time` etc. blank for playing html/route/decklink layers: correct (those
  producers emit no `file/time`) — not a defect.

## Root causes (T239.2) — file:line, old vs new

1. **PRIMARY — frozen per-layer variables after CLEAR/stop (pre-existing gap EXPOSED by WO-235).**
   `src/osc/osc-state.js` `_pruneStaleLayers` (config `layerStaleTimeoutMs`, default 10000ms —
   src/osc/osc-config.js:37) deletes a layer from `channels[ch].layers` once Caspar stops
   emitting OSC for it (CLEAR / stage teardown — per that function's own comment, "there is no
   final empty message" on either lineage). `applyOscSnapshotToVariables`
   (src/osc/osc-variables.js) only walked `Object.keys(layers)` of the CURRENT snapshot, so a
   pruned layer was silently skipped forever and its 4 variables kept their last values.
   **Why "still broken after WO-235":** before WO-235, `layer.type` stayed `null` forever on the
   new binary (no `.../type` leaf — src-tree core/producer/layer.cpp:132-141 emits only
   `foreground/producer`), so the `type === 'empty'` gate cleared every layer's variables on
   EVERY emit — variables were blank-but-fresh, and this pruning gap was invisible. WO-235
   fixing type derivation is exactly what let real values populate — and therefore freeze.
   Not old-vs-new wire drift; an old highascg bug the new binary's fixed type path exposed.
2. **SECONDARY — `loop` leaf never parsed on the new lineage.** New tree
   (src-tree src/modules/ffmpeg/producer/av_producer.cpp:766 and :991) emits `state_["loop"]`
   as a TOP-LEVEL producer-state key → wire address
   `/channel/N/stage/layer/L/foreground/loop` (per core/monitor/monitor.h state_proxy
   path-join; confirmed by live `INFO 1` showing `<loop>` as a SIBLING of `<file>`). Our
   osc-state.js only handled old-style `.../file/loop` (`_routeLayerFile` `sub === 'loop'`) →
   the new binary's loop leaf was silently dropped. Not consumed by osc-variables.js (so not
   the owner symptom) but fixed for `layer.file.loop` consumers.
   Also cross-checked per T239.2: `foreground/paused` (layer.cpp:134) — already handled
   correctly (nested prefix stripped in `_routeLayer`, then `tail === 'paused'`); `file/frame`,
   `file/time` units, channel `format`, `profiler/time` — no old-vs-new shape drift for the
   variables path; `file/time` double→float32 downcast (protocol/osc/client.cpp:61) is harmless
   at seconds scale and the WO-235 sanity clamp guards the rare garbage samples.
   `foreground/frames_left` (layer.cpp:137) is new and unhandled but has no consumer — left
   alone. A live-observed decklink `file/fps` denormal (2.59e-41) is isolated to a leaf the
   variables path never reads.

## Tasks
- [x] T239.1 Reproduced + variable store dumped live (GET /api/state `variables`; store feed =
      src/bootstrap/osc-lifecycle.js `pushOscToState` → state-manager.js `setVariable` —
      subscription path verified alive, so this was a parsing/coverage bug, not a dead feed).
      Wrong-variable list above.
- [x] T239.2 Every `state_["` emission in /home/casparcg/caspar-build/src-tree diffed against
      osc-state.js/osc-variables.js expectations for the variables path (see root causes; the
      loop leaf was the only unparsed consumed-shape drift; WO-235's "paused moved?" question
      answered: yes, under `foreground/`, and the nested-prefix handler already covers it).
- [x] T239.3 Fixed rollback-safe:
      - src/osc/osc-variables.js: tracks per-channel layer sets across emits
        (`ctx._oscVarsSeenLayers`) and explicitly clears `clip/time/remaining/progress` for any
        layer that vanished from the snapshot (prune-safe); `clearOscVariables` resets the
        tracking; shared `_clearLayerVariables` helper. Old + new binaries both fine (behavior
        depends only on our own snapshot shape).
      - src/osc/osc-state.js: `.../foreground/loop` + `.../background/loop` (new) parsed into
        `file.loop`/`backgroundFile.loop`; old `.../file/loop` still honored.
      Smokes: NEW tools/smoke/smoke-wo239-osc-variables.test.js (9 tests: old+new-format
      variable derivation from synthetic packet sequences → exact expected values, the
      frozen-after-prune regression — verified to FAIL against the pre-fix parser (frozen
      values captured) and PASS with the fix — explicit-empty clear no-regression,
      clearOscVariables tracking reset, multi-layer selective clear, loop leaf
      old+new+background). Added to tools/ci/run-offline-tests.js FILES (kept separate from
      smoke-wo235-osc-compat.test.js, which is unchanged and still passes).
- [x] T239.4 Gate: `node tools/ci/run-offline-tests.js` → 300 tests, 298 pass / 0 fail /
      2 skipped (same pre-existing CI-gated WS-integration skips as WO-235). `node --check` +
      `eslint --quiet` clean on all 4 touched files. **A highascg service restart is required
      for the fixes to take effect** (pure in-process JS; Caspar itself untouched, no config
      changes).
- [ ] A239.1 owner: variables correct in UI/companion. **NOT verified live** — the fix is not in
      the running process yet (restart needed), and the frozen-variable state could not be
      provoked live under the read-only constraint (would require state-changing AMCP
      PLAY/STOP). After restart: play a clip, verify `osc_ch{N}_l{L}_time` counts up, then
      STOP/CLEAR it and verify all 4 `osc_ch{N}_l{L}_*` variables go blank within
      ~layerStaleTimeoutMs (10s) instead of freezing.
