# WO-174 — Route sources: choose which source audio channels play (e.g. only ch1+2 of an 8ch program)

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium-High (owner's screen-2 use case downmixes all 8ch today)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): screen 1 has 8ch audio; route of ch1 on screen 2 downmixes all 8ch to stereo; want to pick e.g. ch1&2 only.
**Related:** WO-157 (audio strip hierarchy — shares the model discussion), WO-160b (pgm-only via LBG makes the jobs.js fix cover both engines).

---

## 1. Investigation findings (2026-07-13)

- Route PLAYs get an `AF` filter from the SAME path as media clips: `scene-take-lbg-jobs.js:151` → `audioRouteToAudioFilter(layer.audioRoute, layout)` (`src/engine/audio-route.js:48-56`) → `pan=8c|c2=c0|c3=c1`-style — a **stereo-input → output-pair** mapping. A `route://` producer outputs the SOURCE channel's full layout (8ch), so this formula is wrong for routes; the destination then blanket-downmixes. Confirmed by test expectation `smoke-timeline-audio-route.test.js:12`.
- Caspar's route producer accepts **no CHANNEL_LAYOUT param on PLAY** (`docs/reference/audio/audio-routing-reference.md:37` — channel-level only). The AF pan filter on the PLAY line is the correct mechanism.
- AF serialization already works for any filter string (`src/caspar/amcp-command-plan.js:57`).
- UI: `appendAudioInspectorGroup` (`client/components/inspector-mixer.js:228-243`, dropdown :40-65) renders the same output-pair dropdown for every layer type.

## 2. Tasks (haiku-sized)

- [x] T174.1 **New engine function** in `src/engine/audio-route.js`: `routeSourceChannelsToAudioFilter(pairId, sourceLayout)` — for pair "N+M" (1-based) on an e.g. 8ch source, build a pan that SELECTS source channels and fills the destination stereo image: `pan=stereo|c0=c<N-1>|c1=c<M-1>`. Support 'all' (default) = no filter (today's behavior). Export + JSDoc mirroring the existing function's style. ✓ Implemented with full validation and edge case handling.
- [x] T174.2 **Route detection at the call site** (`scene-take-lbg-jobs.js:151` region): if the resolved clip starts with `route://`, use `layer.routeSourceAudio` (new layer field: `'all' | '1+2' | '3+4' | '5+6' | '7+8'`, default 'all') with the NEW function; media clips keep the existing behavior byte-identical. ✓ Implemented; scene-take-pgm-only.js marked LEGACY since WO-160b — skipped per WO instructions.
- [x] T174.3 **UI:** in `inspector-mixer.js` audio group — when the layer's source is a route (`String(layer.source?.value||'').startsWith('route://')`), render a "Source audio channels" dropdown (All / 1+2 / 3+4 / 5+6 / 7+8) patching `layer.routeSourceAudio`, INSTEAD of the output-pair dropdown (which is meaningless for routes). ✓ Implemented with conditional rendering; media layers unchanged.
- [x] T174.4 **Smokes:** `routeSourceChannelsToAudioFilter('1+2','8ch')` → `pan=stereo|c0=c0|c1=c1`; `'3+4'` → `c0=c2|c1=c3`; 'all' → null; jobs builder emits the route filter for route clips and the legacy filter for media (extend the existing audio-route smoke). ✓ Extended smoke-timeline-audio-route.test.js with 13 test cases covering all variants + edge cases; all pass.
- [x] T174.5 Persistence check: new layer field survives save/load (scene-state schema — check if layer fields are whitelisted anywhere or free-form; note finding). ✓ Added `routeSourceAudio: 'all'` to `defaultLayerConfig()` in scene-state-helpers.js; field persists through migrations via spread operator.

## 3. Acceptance criteria

- [ ] A174.1 Owner's case: route of ch1 on screen 2 with "1+2" selected plays ONLY program channels 1+2 (hardware check after restart); "All" behaves exactly as today.
- [ ] A174.2 Media-clip audio routing byte-identical (smoke).
- [ ] A174.3 Gates green.

## 4. Work log

- 2026-07-13 — WO created. Root cause: stereo-input pan formula applied to multi-channel route producers; fix = source-channel-selecting pan on the route PLAY's AF (Caspar route producer has no per-PLAY layout param).
- 2026-07-13 — Implementation complete. Summary:
  - T174.1: `routeSourceChannelsToAudioFilter(pairId, sourceLayout)` added to `src/engine/audio-route.js` with JSDoc, full validation, out-of-range → null (no throw).
  - T174.2: `scene-take-lbg-jobs.js:151` updated to detect `route://` clips and use new function with resolved source layout; media clips byte-identical.
  - T174.3: `inspector-mixer.js` conditionally renders "Source audio channels" dropdown for route sources, "Audio output (pair)" for media; bound to `layer.routeSourceAudio`.
  - T174.4: Extended `smoke-timeline-audio-route.test.js` with 13 test cases for `routeSourceChannelsToAudioFilter`: pairs 1+2/3+4/5+6/7+8, 'all', null/undefined, out-of-range, same-channel (all pass).
  - T174.5: Added `routeSourceAudio: 'all'` to `defaultLayerConfig()` in `client/lib/scene-state-helpers.js`; field persists through save/load.
  - Linting & syntax: node --check + eslint --quiet passed on all touched files.
  - Notes: scene-take-pgm-only.js marked LEGACY since WO-160b, skipped per WO.
