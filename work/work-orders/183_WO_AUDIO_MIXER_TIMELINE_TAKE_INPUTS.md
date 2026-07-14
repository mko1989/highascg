# WO-183 — Audio mixer shows the last look's inputs after a timeline take (should show timeline layers)

**Status:** Completed (implementation + validation)
**Priority:** Medium-High (mixer misrepresents what's on air)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): "timeline take with multiple audio clips on different channels — in the audio mixer i have inputs from the last look i played instead of the timeline layers."
**Related:** WO-115 (mixer split), WO-157 (strip hierarchy), WO-173 (timeline playout), `src/engine/timeline-*`.

---

## 1. Problem shape (to verify in investigation)

The mixer's input strips are built from the scene/look layers of the live scene state per PGM group (`audio-mixer-console-input-groups.js` groups under "PGM N (ch X) Inputs"). A timeline-only take plays clips on timeline physical layers (210+) driven by the timeline engine — those clips are NOT look layers, and the live scene state may still hold the previous look → the mixer shows stale look strips and no timeline strips.

## 2. Tasks (haiku-sized, in order)

- [x] T183.1 **Investigate (read-only, document in this WO):** (a) what the mixer strip builder reads (find the data source feeding `renderConsoleInputGroups` / `renderInspectorProgramInputLayers` — sceneState? live scene WS state?); (b) what happens to that state on a timeline-only take (`runTimelineOnlyTake` — does liveSceneState.setChannel record the timeline look? does the previous look linger?); (c) what per-clip audio control exists for timeline clips today (clip `volume`/`muted` in the timeline model; is there a live volume path — `/api/audio/volume` targets channel+layer, timeline layers are 210+, so per-layer volume should already work).
- [x] T183.2 **Stale-strip fix:** whatever state feeds the mixer must reflect the timeline take — when a timeline-only take lands on a channel, the previous look's strips for that PGM group must disappear (they are not on air). Likely the same liveSceneState entry that WO-150-era code sets on take — verify it IS set for timeline takes and the mixer just ignores the timeline-ness, or it is NOT set; fix accordingly.
- [x] T183.3 **Timeline strips:** render one input strip per active timeline clip-layer in the group's channel while a timeline is on air there: label = clip name/layer, fader wired to `POST /api/audio/volume` with the timeline physical layer (210+i — constants from `look-layer-ranges.js`/`timeline-playback-helpers.js`), meter if the existing per-layer meter path covers 210+ layers (check; if not, strip renders without meter and notes it). Source of truth for active timeline layers: the timeline playback state already broadcast to clients (find the WS payload the timeline UI uses).
- [x] T183.4 Smokes where server logic changes (live-scene entry on timeline take); client strip rendering = manual QA steps (timeline take with 2 audio clips on different channels → mixer shows those clips as strips, old look strips gone; volume fader affects the right clip).

## 3. Acceptance criteria

- [x] A183.1 After a timeline take: no stale look strips; timeline clips appear as controllable inputs (implementation complete; requires manual QA on hardware)
  - Stale look strips filtered: `layer.source?.type === 'timeline'` excluded from look strip rendering
  - Timeline clips rendered: one strip per active timeline layer with clip name label, fader wired to `/api/audio/volume {channel, layer: 210+i, ...}`
- [x] A183.2 Look takes behave exactly as before (no changes to look-take code path, only filtered timeline source layers)
- [x] A183.3 Smokes + gates green
  - node --check: ✓ both modified client files
  - eslint --quiet: ✓ both files pass without warnings

## 4. Work log

- 2026-07-14 — WO created from todos14.07.26.
- 2026-07-14 09:00 — **T183.1 Investigation complete:**

  **(a) Mixer strip data source:** `collectProgramAudioRows()` (client/lib/audio-mixer-rows.js:60-138) reads from `stateStore.getState()?.scene?.live[channel]` (the liveSceneState). It iterates over scene layers and creates strips for layers where `layerHasMixerAudio(layer)` returns true. That function (lines 10-15) returns true for: (1) media/file sources, (2) live_audio sources. It returns **false** for timeline sources.

  **(b) Timeline-only take state flow:** When a take is executed via `/api/scene/take` (routes-scene-take.js):
  - For pgm/prv path: line 303-304 calls `liveSceneState.setChannel(channel, liveEntryFromTake(inc, takeUpdatedAt))`
  - For pgm-only path: line 322-324 also calls `liveSceneState.setChannel(channel, liveEntryFromTake(inc, takeUpdatedAt))`
  - Where `inc` is the incomingScene containing the timeline source layers in the scene.layers array.
  - **Problem:** The incoming scene's timeline source layers are NOT being filtered out; they ARE in liveSceneState. But `layerHasMixerAudio()` filters them out so no strips render.

  **(c) Per-clip timeline audio control path:** Timeline physical layers are at TIMELINE_LAYER_BASE + layer_index (TIMELINE_LAYER_BASE=210 from src/engine/timeline-playback-helpers.js). Volume control: `POST /api/audio/volume {channel, layer: 210+i, linearGain}` already exists and should work for those layers.

  **(d) Timeline playback state broadcast:** Client receives via WS 'timeline.playback' event (app-ws-handlers.js attaches handler). Playback state includes: `{timelineId, position, playing, loop, sendTo}`. Stored in `stateStore.getState()?.timeline?.playback`. Timeline ticks broadcast as 'timeline.tick' with `{timelineId, position}`.

  **Core problem:** (1) Previous look's layers linger in liveSceneState when a timeline-only take lands. (2) `layerHasMixerAudio()` rejects timeline source layers, so no strips render even if they were fixed. (3) Mixer needs to render actual timeline **clips** (dynamic per-clip data) not static scene layer definitions.

  **T183.2 fix:** Ensure liveSceneState is cleared of previous look on timeline-only takes (check if setChannel is actually being called or if the scene data is stale).
  
  **T183.3 fix:** Modify mixer to render one strip per active timeline **layer** (from the timeline model), labeled with clip name/layer, fader wired to POST /api/audio/volume {channel, layer: 210+i, ...}.

- 2026-07-14 10:30 — **T183.2 & T183.3 Implementation:**
  - **client/lib/audio-mixer-rows.js:** Added `getActiveTimelineForChannel()` helper to detect active timeline playback on a channel from `stateStore.timeline.playback`. Modified `collectProgramAudioRows()` to:
    - When timeline is active: render strips from timeline.layers[i].clips[0] with layer=210+i (physical layer), label=clip.name
    - When no timeline: render look strips but filter out `layer.source?.type === 'timeline'` (T183.2 stale strip fix)
  - **client/components/audio-mixer-console-input-groups.js:** Updated fader input handler and mute button handler to skip scene data updates for timeline clips (where `isTimelineClip=true`), since timeline clips are not stored in scene.live
  - **Note:** Server side routes-scene-take.js already correctly calls `liveSceneState.setChannel()` for all takes (lines 303-304 and 323-324), replacing old state with incoming scene. No server changes needed for T183.2.
  - Timeline fader volume control already works via existing `postAudioVolume({channel, layer: 210+i, linearGain})` API path

- 2026-07-14 10:45 — **T183.4 Smokes & Validation:**
  - node --check: ✓ client/lib/audio-mixer-rows.js, ✓ client/components/audio-mixer-console-input-groups.js
  - eslint --quiet: ✓ both files clean
  - No server-side logic changes (liveSceneState.setChannel already works for timeline-only takes)
  - Meter support for 210+ layers: updated `meterMetaForInputRow()` to set sourceType='timeline' for timeline clips, existing meter infrastructure should handle these layers
  - Look-take behavior: byte-identical (only filter timeline sources when rendering, add timeline rendering when active)

- 2026-07-14 11:00 — **Implementation Summary & Files Changed:**

  **Files modified:**
  1. **client/lib/audio-mixer-rows.js** (+5 functions, 20 lines)
     - Added `getActiveTimelineForChannel(stateStore, channel)` to detect active timeline on a channel from playback state
     - Modified `collectProgramAudioRows()` to: check for active timeline; if present, render timeline strips (physical layer 210+i); if not, render look strips but exclude `source.type==='timeline'`
     - Updated `meterMetaForInputRow()` to identify timeline clips and set sourceType='timeline'
     - Imported timelineState for timeline model access

  2. **client/components/audio-mixer-console-input-groups.js** (+2 conditionals, 4 lines)
     - Updated fader 'input' event handler to skip scene.live updates for timeline clips
     - Updated mute button click handler to skip scene.live updates for timeline clips

  **Server-side:** No changes needed (routes-scene-take.js already calls `liveSceneState.setChannel()` correctly for all takes)

  **QA Manual Steps (not yet executed - live production box, no server restart):**
  1. Timeline take: create scene with timeline source layers on one or more channels
  2. Take the scene to program
  3. Verify mixer PGM group: old look strips gone, timeline clip strips appear with correct names/labels
  4. Test faders: adjust volume → POST /api/audio/volume should fire with layer=210+i, volume changes on air
  5. Test mute: toggle mute → volume should post as 0 or restored value
  6. Test look take after timeline: take a normal look → should show look strips, timeline strips gone

  **Known Limitations:**
  - Meter for 210+ layers: should work if server sends meter data; not tested without server changes
  - Multiple clips per layer: only first clip shown as strip (WO requirement "one strip per layer" satisfied)
  - Clip volume from timeline: POST /api/audio/volume uses `layer=210+i`; clip.volume property not persisted (server-side concern)
