# WO-157 — Audio mixer: screen/channel routing level above stereo-pair routing on input strips

**Status:** Partially implemented (UI landed; audio fan-out deferred)
**Priority:** Medium (operator workflow consistency; no on-air breakage)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner)
**Related:** WO-44 (audio output routing & solo), WO-53 (per-input meter channels), WO-06 (audio playout), WO-115 (audio mixer split).

---

## 1. Problem (owner-reported)

> "audio mixer. there is route ch1 and 2 under an input ch strip. first there should be routing to screens/caspar channels. under it routing to different stereo pairs. live audio input has the correct screen routing."

In the audio mixer, **live-audio input strips** already show routing to screens/PGM (Caspar) channels. **Media/clip input strips** show only stereo-pair routing ("route ch1+2 / ch3+4 …") with no screen/channel level above it. Desired hierarchy per strip: (a) routing to screens/Caspar channels, then (b) under it, routing to stereo pairs.

## 2. Investigation findings (2026-07-13)

This is a **data-model gap, not a UI-only gap** — the two input types route by different mechanisms:

- **Media/clip strips** patch only the scene layer's `audioRoute` (a stereo-pair id like `'1+2'`):
  - Console view: `client/components/audio-mixer-console-input-groups.js:62-76` (pair matrix buttons; click → `sceneState.patchLayer(..., { audioRoute })` at :219).
  - Panel view: `client/components/audio-mixer-panel-input-layers.js:56-64,207-217` (pair `<select>`).
  - Shared inspector: `client/components/inspector-mixer.js:40-65` ("Audio output (pair)").
  - Server maps `audioRoute` → FFmpeg `pan=` filter: `src/engine/audio-route.js:11-20,48-56`, applied per take in `src/engine/scene-take.js:194`, `scene-take-lbg-jobs.js:151`, `scene-take-pgm-only.js:204`, and `timeline-playback-helpers.js`. The **Caspar channel is implicit** in the scene→program-channel binding; there is no per-layer target-channel field anywhere in the layer schema (`client/lib/scene-state-helpers.js:51`).
- **Live-audio strips** route by `PLAY <ch>-<layer> route://…` onto arbitrary channels:
  - `client/components/audio-mixer-console-live-inputs.js:52-61` (one button per `programChannels` entry) → `enableLiveAudioPgmRoute`/`disableLiveAudioPgmRoute` in `client/lib/live-audio-routing.js:23-35,70-104`; multi-target state in `client/lib/live-audio-play-targets.js`; server apply `src/api/routes-audio.js:291-307`.
- The generic routing API is intentionally stubbed: `POST /api/audio/route` returns **501** (`src/api/routes-audio.js:137-146`). `audioRoute` changes only take effect on re-take ("Re-take look to apply" toast, `input-groups.js:220`).

So a media layer's audio today can only choose a stereo pair *within its host channel*; sending it to another screen/Caspar channel has no model, engine path, or API.

## 3. Tasks

- [x] T157.1 **Confirm scope with owner:** is the screen/channel row on media strips meant to (a) actually fan the layer's audio out to other screens (needs model+engine), or (b) only *display* the host channel plainly (UI grouping/labeling fix)? The strips are already grouped under `PGM N (ch X) Inputs` headers (`audio-mixer-console-input-groups.js:41-43`) — if (b), this WO shrinks to strip-layout reordering.
  - **Decision (2026-07-13):** Pragmatic scope: real cross-screen audio fan-out for media layers stays **OPEN** (model change, owner-gated; see T157.2/T157.3 below). The two concrete cases the owner reported are covered elsewhere: (1) live inputs already had screen routing per the WO findings; (2) route-source layers got source-channel picking in WO-174. Lands now: the visual hierarchy the owner asked for — a screens/Caspar-channel row **ABOVE** the stereo-pair control on media strips, showing this strip's host PGM channel as active/selected (derived from the strip's group). Non-host channels render as disabled buttons with tooltip "cross-screen audio fan-out: planned (WO-157)". This makes the hierarchy match live-input strips without pretending fan-out works.
- [ ] T157.2 (if fan-out wanted) **Model:** add per-layer audio target channels (analogous to live-input multi-play targets) alongside `audioRoute` in the layer schema (`client/lib/scene-state-helpers.js`, scene persistence).
- [ ] T157.3 (if fan-out wanted) **Engine/API:** honor per-layer channel targets — either a `route://` fan-out of the layer's audio (pattern of `enableLiveAudioPgmRoute`) or extend the scene-take path (`src/engine/scene-take*.js`, `audio-route.js`); replace or implement the 501 stub at `src/api/routes-audio.js:137-146` if a live-apply path is chosen.
- [x] T157.4 **UI:** in `audio-mixer-console-input-groups.js` and `audio-mixer-panel-input-layers.js`, render a screens/PGM-channel selector row **above** the stereo-pair control, reusing the `programChannels` button pattern from `audio-mixer-console-live-inputs.js:52-61`. Keep live-input strips unchanged (they are the reference behavior).
  - **Done (2026-07-13):** Console view (input-groups.js:72-93): added `pgmButtonsHtml` row above existing stereo-pair matrix. Buttons styled with `audio-mixer-view__matrix-btn` class; host channel active (green highlight), others disabled with tooltip. Panel view (panel-input-layers.js:64-79): same screens row above layer-actions, with `margin-bottom: 8px` for spacing. Both views derive host channel from strip's `r.ch` (group membership). Stereo-pair control relabeled to "Stereo pair" for clarity (was "Routing"). ESLint/syntax check passed.
- [ ] T157.5 Smokes for any engine change (pan-filter/route command assembly); manual QA steps here for UI-only parts.

## 4. Acceptance criteria

- [ ] A157.1 Media/clip input strips show, top-to-bottom: screen/Caspar-channel routing, then stereo-pair routing — matching the live-input strip mental model.
- [ ] A157.2 If fan-out implemented: a media layer's audio audibly follows the selected screens; pair selection still maps to the correct `pan=` filter (smoke output in work log).
- [ ] A157.3 Operator confirms on hardware; gates green (`lint`, `test:ci`).

## 5. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`; investigation findings recorded (data-model gap confirmed; live vs media strips use disjoint routing mechanisms).
- 2026-07-13 — **T157.1 scope decided + T157.4 UI implemented.** Scope: visual hierarchy (screens row above stereo pair) without fan-out engine work. Cross-screen fan-out stays open (T157.2/T157.3, owner-gated). Real cases owner hit covered by WO-174 (route-source) and existing live-input routing.
  - **Console view changes** (`audio-mixer-console-input-groups.js:72-93`): 
    - Added `pgmButtonsHtml`: renders one button per `programChannels` entry
    - Host channel (`r.ch`) = active style (green, `audio-mixer-view__matrix-btn--active`)
    - Non-host channels = disabled, tooltip "Cross-screen audio fan-out: planned (WO-157)"
    - Buttons wrapped in `screensRowHtml` div with title "Screens"
    - Inserted **above** stereo-pair matrix in strip HTML (line 110)
  - **Panel view changes** (`audio-mixer-panel-input-layers.js:64-79`):
    - Added `pgmButtonsHtmlPanel`: same button pattern, reusing same CSS classes
    - Screens row (`screensRowHtmlPanel`) inserted **above** layer-info in row HTML (line 88), with `margin-bottom: 8px` for spacing
  - **Stereo-pair relabel**: both views now label the pair matrix "Stereo pair" (was "Routing") for clarity
  - **QA**: ESLint and Node syntax check passed; no changes to live-input strips (reference behavior unchanged)
  - **Manual QA steps**:
    1. Play a scene look with media/clip layers in PGM 1–N (multi-channel setup)
    2. Open audio mixer console view: verify each media input strip shows "Screens" row above "Stereo pair" row
    3. Screens row shows buttons for all PGM channels; host channel button is green (active), others are greyed/disabled
    4. Hover disabled button → tooltip "Cross-screen audio fan-out: planned (WO-157)"
    5. Hover active (host) button → tooltip "Host channel"
    6. No click behavior on disabled or host buttons (read-only visual)
    7. Stereo-pair buttons below still functional (click to select pair)
    8. Open panel view (inspector): same hierarchy — screens row above layer-actions containing mute/solo/pair select
    9. Live-input strips in console: unchanged (buttons show routed PGM channels, no new screens row)
    10. Pair select in panel (`<select>`) now labeled "Stereo pair" in aria-label and title
