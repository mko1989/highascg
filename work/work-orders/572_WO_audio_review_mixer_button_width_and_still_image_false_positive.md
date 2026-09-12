**Status: IMPLEMENTED (2026-09-12) — Parts A, B, and C all landed. Offline suite 2431/2434 (the
1 failing test is a pre-existing, unrelated timing flake in smoke-wo537 — see §"Verification"),
client build clean. Not yet kiosk-reloaded/service-restarted on the box (live show, owner-QA
owed for all three parts).**

**Source:** `work/work-orders/todos12.09.26` (owner, verbatim):
> i need you to do a review and fixing of the audio implementation and settings in highascg.
> while youre at it in the compact audio mixer in bottom right the routing buttons are stretched
> to fill width instead of being pretty small.
> highascg needs to be doing better job at determining wheter there is audio present on a layer,
> right now there are 2 layers on screen with jpg media, so no audio, yet they appear in the mixer.
> i also need audio only looks (single or playlist) that can be played without changing the video
> layers of the screen.
> on show so dont do anything destructive.

## Part A — compact mixer routing buttons stretched to fill width

**Found:** `.audio-mixer-view__matrix-buttons` in
[07c4-audio-mixer-view-matrix-empty-modal.css:21-26](../../client/styles/07c4-audio-mixer-view-matrix-empty-modal.css#L21)
was a hardcoded `display: grid; grid-template-columns: repeat(2, 1fr)`. With the common case of
1-2 PGM screens, each single/double-digit channel button stretched to half the strip's width.
This class is shared by every "Screens" routing matrix on the box: the Inspector's compact
Program-audio panel (`audio-mixer-panel-input-layers.js`), the Live Audio Mixer modal's
cross-screen matrix (`audio-mixer-console-input-groups.js`), and the live-input matrix
(`audio-mixer-console-live-inputs.js`).

**Fix:** switched the container to `display: flex; flex-wrap: wrap` and the buttons to
`flex: 0 0 auto; min-width: 1.6em` (was implicit full-cell width) — buttons now size to their own
label instead of stretching, and still wrap sanely if a box ever has many PGM screens.

No smoke test pins this class's layout rules (checked `tools/smoke/smoke-wo227-mixer-dense.test.js`
— that WO covers per-screen fader-strip width at 8 channels, a different CSS family, not this
button grid).

## Part B — still-image layers get a full audio strip in the mixer

**Found:** `layerHasMixerAudio(layer)` in
[audio-mixer-rows.js:11-16](../../client/lib/audio-mixer-rows.js#L11) — the sole gate deciding
whether a look layer gets a fader/meter/routing strip in `collectProgramAudioRows` (the compact
Inspector mixer's per-layer rows) — only checked `isMediaOrFileSource(src)`: `type === 'media' |
'file'` and a non-empty `value`. No media-kind check at all, so a layer whose source is a static
`.jpg` passed identically to a real audio-bearing clip.

**Fix:** reuse the box's existing, already-trusted filename classifier,
`classifyMediaKind()` ([media-ext.js](../../client/lib/media-ext.js) — the same function gating
loop/thumbnail behavior elsewhere) — a media/file source now needs `classifyMediaKind(src.value)
!== 'still'` to earn a mixer strip. Still images (jpg/jpeg/png/gif/bmp/webp/tiff/tif) no longer
appear; everything else (video, audio files, route://, extensionless clip ids) is unaffected —
`classifyMediaKind` returns `'unknown'` for those, which is not `'still'`.

**Deliberately not done:** consulting the server's real ffprobe `hasAudio` flag (already computed
in `local-media-ffmpeg.js` and merged onto `state.media`/`GET /api/media`, per investigation) to
also catch a genuinely silent **video** file. The owner's reported symptom was specifically jpg
stills — a filename-only, zero-ambiguity case. Wiring the probe cache in too would mean extending
`media-duration.js`'s index (or building a sibling) with the same normalization/conflict-handling
care that file already documents at length for duration — real work, not needed to fix what was
reported, and higher risk to make correctness-critical on a live box today. If a genuinely silent
video file turns out to also need excluding, that's a follow-up with its own WO.

## Part C — audio-only looks (single or playlist) that don't touch video layers

Owner picked **per-screen, additive** over the channel-decoupled `route://`-style shape (asked
live via AskUserQuestion — the two shapes have very different blast radius): a look flagged
`audioOnlyLook: true` plays its first layer's audio (single clip or playlist) on a screen's own
program channel, on a **fixed physical layer reserved outside every existing band**
(`AUDIO_ONLY_LOOK_LAYER = 200`, new entry in the table in
[look-layer-ranges.js](../../src/engine/look-layer-ranges.js), the 200-209 gap between the look
bank-B ceiling (199) and `TIMELINE_LAYER_BASE` (210)). Because it never enters
`buildTakeJobs`/`diffScenes`, and `isLookPhysicalLayer(200)` is already `false` by construction,
neither taking nor clearing an audio-only look can ever touch the 10-99/110-199 look band a
screen's real video look occupies — verified as a regression guard in the new smoke test, not just
asserted.

**New modules:**
- [`src/engine/audio-only-look.js`](../../src/engine/audio-only-look.js) — `isAudioOnlyLook`,
  `takeAudioOnlyLook`, `stopAudioOnlyLook`. Single clip: one `PLAY` with the layer's `loop` flag.
  Playlist: `PLAY` item 0 immediately, then a **self-contained duration timer**
  (`item.duration` seconds, default 5 — same field/convention as normal look playlists) schedules
  the next item, looping forever until stopped. Deliberately NOT the OSC-driven advance engine
  normal look playlists use (`scene-take-lbg-playlist.js`) — that engine's `physicalProgramLayer`
  bank-offset formula would map layer 200 on bank B to 300, colliding with the PIP overlay band
  (260-979). Staying off that machinery entirely sidesteps the collision without special-casing it,
  at the cost of no LOADBG-AUTO preload / no crossfade between playlist items (acceptable v1
  tradeoff — a Caspar-level hard cut between items, not a broadcast-grade concern for a background
  audio bed). Preview plays item 0 once with no advance timer, matching the existing convention
  that a previewed look's playlist is "staged, static" (todos27.07.26).
- [`src/state/live-audio-only-look-state.js`](../../src/state/live-audio-only-look-state.js) — a
  **separate** persisted map + WS broadcast path (`scene.liveAudioOnly`, key
  `liveAudioOnlyLooksByChannel`, added to `persistence.js`'s `IMMEDIATE_KEYS`), deliberately not
  reusing `live-scene-state.js`'s single-slot-per-channel `scene.live` map — a channel can have one
  live video look AND one live audio-only look simultaneously, and `live-scene-state.js`'s
  `all[ch] = {...}` overwrite would clobber whichever kind took second.
- [`src/api/routes-scene-take-audio-only.js`](../../src/api/routes-scene-take-audio-only.js) —
  `handleAudioOnlyLookTake`/`handleAudioOnlyLookStop`, split into its own file purely because
  `routes-scene-take.js` was already at 485/500 lines. `handleSceneTake` branches here via
  `isAudioOnlyLook(b.incomingScene)` **before** the existing "layer number must be 10-99" 400
  guard (an audio-only scene's stored layer numbering is irrelevant — only `layers[0]` is read,
  and only ever mapped to the fixed layer 200). New route: `POST /api/scene/audio-only/stop`.

**Client wiring** (deliberately minimal — this is a v1 cut, see Known limitations below):
- `client/lib/scene-state.js`: `setSceneAudioOnly(id, bool)`, mirrors `setSceneName`.
- `client/components/scenes-editor-edit.js`: a 🔊 toggle button in the look editor's edit bar.
- `client/components/scene-list-column.js` /
  `client/styles/06a3-scenes-deck-multi.css`: a small 🔊 corner badge on audio-only look cards
  (same pattern as the existing WO-360 ⚠ missing-media badge, opposite corner).
- `client/lib/audio-mixer-rows.js`: a mixer row per live audio-only look (reads the new
  `scene.liveAudioOnly` WS slice — no extra client wiring needed, `stateStore.applyChange` already
  handles arbitrary paths generically), with `sceneId: null` so it doesn't try to render the
  look cross-screen routing matrix.
- `client/components/audio-mixer-panel-input-layers.js` /
  `client/styles/07b-audio-mixer-modal-shell.css`: a ■ **Stop** button on that row
  (`POST /api/scene/audio-only/stop`) — mute alone isn't enough, since muting an audio-only look
  leaves it occupying layer 200 (blocking a different audio-only look from taking over) instead of
  actually clearing it.

**Known limitations (v1, honestly scoped rather than silently gapped):**
- Only a look's **first** layer plays; additional layers on an "audio only" look are silently
  ignored. Not validated against in the editor — the 🔊 toggle doesn't restrict adding more layers.
- The deck's live/preview ring (`scenes-card--live`/`--preview`) is **not** wired for audio-only
  looks — it reads `resolveBusLookIdsForMain` against `scene.live` only, which an audio-only look
  never enters. An audio-only look's card gives no on-deck indication that it's currently playing;
  the compact mixer's new row (and its 🔊 label) is the only live indicator today. Wiring the deck
  ring needs a second parallel live/preview-id map client-side (`sceneState` currently hard-assumes
  one live scene per channel) — real work, scoped out of this pass.
- No crossfade between playlist items (hard cut via `PLAY`), and no crossfade when one audio-only
  look replaces another on the same screen.
- Not wired into the companion-bridge / look-air-frames broadcast that `live-scene-state.js` calls
  on every `scene.live` change — Companion won't see audio-only look state.

Note for whoever extends this: WO-306 (media-layer cross-channel audio routing — a *different*
per-layer routing feature) was explicitly **rejected by the owner** ("the current way is how
caspar works and is fine"). This feature is not that — it's a dedicated look type, not a routing
toggle on ordinary look layers — worth naming that distinction if it ever comes up.

## Verification (Parts A & B)

- `node tools/ci/run-offline-tests.js`: 2421/2424 pass, 2 skipped (pre-existing, both
  local-server-spawn tests that always skip under `CI=1`), 1 failing
  (`smoke-wo537-look-timeline-starts-where-asked.test.js` — a pre-existing timing flake, off by
  1ms under full-suite load; passes 9/9 in isolation, confirmed unrelated to this change).
- `npm run build:client`: clean, no new errors/warnings (pre-existing chunk-size and
  ineffective-dynamic-import warnings only).
- **Owner-QA owed:** kiosk reload to see the buttons at their new size and confirm the two jpg
  layers drop out of the mixer live, on this show.

## Verification (Part C)

- New smoke test `tools/smoke/smoke-wo572-audio-only-look.test.js` (10 tests, added to the curated
  list in `tools/ci/run-offline-tests.js`): layer-200 exclusion from `isLookPhysicalLayer`, single
  clip take, playlist advance timing, preview-does-not-advance, stop-cancels-pending-timer,
  take/stop touch `liveAudioOnlyLookState`/`scene.liveAudioOnly` and never `liveSceneState`/
  `scene.live`, preview-with-no-preview-bus rejects with 400 and sends no AMCP, and
  `handleSceneTake` branches to the audio-only path before the normal 10-99 layer-numbering guard.
- Caught and fixed a real bug during test-writing: the playlist-advance duration calc had an
  incorrect `Math.max(1, seconds)` floor that silently forced every item to a 1-second minimum
  regardless of its configured duration — found because the test's 60ms wait assertion failed,
  which (before a `try/finally` was added around it) left the infinite playlist-advance timer
  chain running forever in the background and hung the whole `node --test` process. Both the
  production bug and the test-hygiene gap are fixed.
- Full offline suite after adding this file: 2431/2434 (same pre-existing smoke-wo537 timing flake
  as Parts A/B, unrelated).
- `npm run build:client`: clean.
- **Owner-QA owed (nothing live-verified — no kiosk reload / service restart performed, per "on
  show, don't do anything destructive"):** create an audio-only look via the 🔊 toggle, Take it to
  a screen already showing video, confirm the video is untouched and the audio plays; confirm the
  new mixer row appears with a working fader/mute/Stop; confirm a playlist advances and loops;
  confirm Stop actually silences it (not just mutes).

## Files touched (Part A, B, C)

- `client/styles/07c4-audio-mixer-view-matrix-empty-modal.css`
- `client/lib/audio-mixer-rows.js`
- `src/engine/look-layer-ranges.js` (new `AUDIO_ONLY_LOOK_LAYER` constant)
- `src/engine/audio-only-look.js` (new)
- `src/state/live-audio-only-look-state.js` (new)
- `src/api/routes-scene-take-audio-only.js` (new)
- `src/api/routes-scene-take.js` (early branch to the audio-only path)
- `src/api/routes-scene.js` (new `POST /api/scene/audio-only/stop` route)
- `src/utils/persistence.js` (`liveAudioOnlyLooksByChannel` added to `IMMEDIATE_KEYS`)
- `client/lib/scene-state.js` (`setSceneAudioOnly`)
- `client/components/scenes-editor-edit.js` (🔊 toggle button)
- `client/components/scene-list-column.js` (deck card badge)
- `client/styles/06a3-scenes-deck-multi.css` (badge CSS)
- `client/styles/06a1-scenes-deck-toolbar.css` (`.scenes-btn--active`)
- `client/components/audio-mixer-panel-input-layers.js` (Stop button)
- `client/styles/07b-audio-mixer-modal-shell.css` (`.audio-mixer__stop-btn`)
- `tools/smoke/smoke-wo572-audio-only-look.test.js` (new, 10 tests)
- `tools/ci/run-offline-tests.js` (added the new test file to the curated list)
