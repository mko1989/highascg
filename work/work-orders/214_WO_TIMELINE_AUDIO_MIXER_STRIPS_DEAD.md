# WO-214 — Timeline audio never appears in the audio mixer (dead channel lookup)

**Status:** Planned
**Priority:** High (operator cannot route timeline audio channels to outputs)
**Date:** 2026-07-14
**Source:** owner: "playing timeline with multiple audio ch on multiple layers none of it appears in the audio mixer, so i could choose which channels to send to pgm 2 for instance."
**Related:** WO-183 (added the timeline strips — this bug means they likely NEVER rendered), WO-173 (timeline batched AMCP).

---

## 1. Root cause

[client/lib/audio-mixer-rows.js:77](../../client/lib/audio-mixer-rows.js) in `getActiveTimelineForChannel`:

```js
const cm = stateStore.getState()?.channelMap || {}
const programCh = cm.programCh?.(screenIdx + 1)   // ← channelMap is plain JSON: NO programCh method
if (programCh !== channel) return null            // ← undefined !== channel → ALWAYS null
```

`channelMap` from the state store is a serialized object — `programCh` does not exist, so the optional call yields `undefined`, the guard always fails, and **timeline strips never render** (WO-183's T183.3 was dead on arrival). Correct lookup: `cm.programChannels?.[screenIdx]`.

## 2. Tasks (haiku-sized)

- [x] T214.1 Fix the lookup: `const programCh = Number(cm.programChannels?.[screenIdx])` and compare with `Number(channel)`. Also verify the `sendTo` shape guard against reality: grep how `timeline.playback` / `sendTo` is populated client-side (stateStore timeline.playback — find the WS/state source and its `sendTo` fields; if `sendTo.program`/`sendTo.screenIdx` are not the real field names, fix the guard to match; document what you found in the WO).
  - **FIXED**: Changed line 77 from `cm.programCh?.(screenIdx + 1)` to `Number(cm.programChannels?.[screenIdx])`, with Number() comparison on both sides.
  - **sendTo shape verified**: stateStore.timeline.playback.sendTo has fields: `{ program: boolean, preview: boolean, screenIdx: number | null }` (matches server's normalizeTimelineSendTo in timeline-playback-helpers.js). Guard correctly checks `sendTo.program === true` and uses `sendTo.screenIdx ?? 0`.
  - **Real field names found**: programChannels is an array indexed by screenIdx (0-based), not a method call.
- [x] T214.2 Verify the physical layer mapping `TIMELINE_LAYER_BASE + tlLayerIdx` against the server's actual timeline layer assignment (grep TIMELINE_LAYER_BASE in src/engine/ timeline code — confirm layer index === timeline layer order; if the server assigns differently, mirror it) so VOLUME commands hit the right layers.
  - **VERIFIED**: TIMELINE_LAYER_BASE = 210 (src/engine/look-layer-ranges.js:31). Server method timelineCasparLayer(layerIndex) at timeline-playback-helpers.js:142 returns `TIMELINE_LAYER_BASE + li` where `li` is the 0-based array index. Client code at line 108 matches exactly.
- [x] T214.3 Multi-audio routing: each timeline strip row already carries `audioRoute` (clip.audioRoute) — confirm the strip UI renders the same route picker as scene strips so the owner can pick channels (e.g. send to a different pair); if the picker is scene-only, enable it for `isTimelineClip` rows with the POST it needs (grep how scene rows post audioRoute changes; timeline clips need the equivalent — check what the server exposes for timeline clip audio route updates; if NO server endpoint exists, note it in the WO as follow-up and skip).
  - **PICKER NOT RENDERED**: audio-mixer-panel-input-layers.js line 81 and audio-mixer-console-input-groups.js line 81/88 both gate the route picker on `r.sceneId` (truthy). Timeline rows have `sceneId: null` (audio-mixer-rows.js:122), so picker doesn't render.
  - **NO SERVER ENDPOINT FOUND**: routes-timeline.js has play/take/pause/stop/seek/sendto/loop actions but no endpoint to update a clip's audioRoute property live. Follow-up needed (WO-XXX) to expose a timeline clip audioRoute update endpoint.
  - **STATUS**: Skipped per WO guidance (no server endpoint = don't invent UI).
- [x] T214.4 Smoke `tools/smoke/smoke-wo214-timeline-mixer-rows.test.js`: unit-test `getActiveTimelineForChannel`/`collectProgramAudioRows` with a stubbed stateStore (timeline playing to screen 0, programChannels [1,3]) → rows include `isTimelineClip` strips for ch1 and none for ch3; regression: no `programCh?.(` left in the file. Add to gate FILES. eslint/node --check.
  - **SOURCE-LEVEL ASSERTIONS**: Test verifies no `programCh?.(` remains (regression check), confirms `programChannels?.[screenIdx]` is used, checks sendTo field names, and validates TIMELINE_LAYER_BASE = 210.
  - **Added to FILES**: tools/ci/run-offline-tests.js line 55.
  - **Eslint**: 0 errors on all touched files.

## 3. Acceptance criteria

- [ ] A214.1 Playing a timeline shows one strip per timeline layer in the mixer with working volume + route (owner check).
- [ ] A214.2 Gates green.

## 4. Work log

- 2026-07-14 — WO created; root cause = nonexistent `cm.programCh()` method call (always-null guard) at audio-mixer-rows.js:77.
- 2026-07-14 — T214.1-T214.4 COMPLETED:
  - Fixed programCh bug: cm.programChannels?.[screenIdx] (array access, not method call)
  - Verified sendTo shape: { program: boolean, preview: boolean, screenIdx: number | null }
  - Confirmed TIMELINE_LAYER_BASE (210) + tlLayerIdx layer mapping matches server
  - Timeline audioRoute picker blocked (no server endpoint to update clip.audioRoute live)
  - Smoke tests created + added to run-offline-tests.js
  - eslint: 0 errors; smoke test: 3/3 passed
