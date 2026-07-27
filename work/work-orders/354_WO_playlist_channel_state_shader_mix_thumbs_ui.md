# WO-354 — Channel-scoped playlist state, shader MIX hops back, shader thumb eligibility, 2 UI fixes

**Status: DONE (2026-07-27)** · Source: todos27.07.26 batch 4 (owner, five items).

## 1. "Preview played the old version" — playlist runtime state was channel-less (ROOT CAUSE)

`playlistActiveIndices` / `playlistImageTimers` / `playlistOscPrevPlayingPath` were all keyed
`${sceneId}-${layerNumber}` — NO channel. The same look live on PGM and recalled on PRV shared
one timer/index/prev-path slot: the OSC pass over the stale PRV entry stole the hop timer and
re-armed it with ITS (pre-edit) scene closure → preview visibly played the pre-edit playlist,
and PGM advancement could stall (timer theft). All runtime keys are now
`${channel}:${sceneId}-${layerNumber}` (`playlistRuntimeKey`, exported from
scene-take-lbg-playlist.js; used by scene-take-lbg-jobs.js and routes-playlist.js).
`playlistStartIndices` (WO-347 pre-playout start item) deliberately stays channel-less.
smoke-wo224 repointed to the scoped keys (3/3).

## 2. Shader-to-shader playlist hops MIX again

The 2026-07-27 "keep shaders CG-hosted" hop (cgAdd) traded away the crossfade — owner wants the
mix back. Hops now honor the configured playlist transition: non-CUT → LOADBG/PLAY of the html
file (mixes like any media); CUT → CG ADD host (unchanged). The resulting plain html producer
403s on CG UPDATE, so the Shader Live editor now detects the 403 (which rides an HTTP 200 body —
the old catch never fired) and RE-HOSTS once via CG ADD + retries the update: one visible shader
restart at edit time, crossfades preserved on air. Instances carry `cgName` for the re-host.

## 3. Shader deck thumbs "only worked for one look"

The "shaders are media" reclassification (red border) made `isCgTemplateLayer` false for
shaders — which also knocked every shader look out of `isCgOnlyLook`, the deck-thumb
eligibility gate, so no server-side CG render was requested any more (the one working look was
cache). New `isCgRenderableLayer` (= cg template OR shader) is the thumb-eligibility predicate;
`isCgTemplateLayer` remains the styling/border predicate. Playlist disqualification uses the
renderable predicate too.

## 4/5. UI

- Current-item name under each compose-preview screen window: 9px → 12px
  (10b-operator-compose-tiles.css playback-timer rows).
- ▶/CUT global take buttons sit LEFT (right after the screen pills) —
  `.scenes-toolbar__global-take--right` margin-left auto → 0; the transition group owns the
  right edge since WO-350.

## Verification

test:ci 1532/0 (wo224 repointed), lint 0, 500-line gate 0, client built, service restarted,
kiosk reloaded. Owner checks: playlist edit → take → recall to preview shows the NEW list;
shader playlist with MIX transition crossfades; editing a playlist-hosted shader restarts it
once then edits live; every pure-shader look gets a rendered thumb.
