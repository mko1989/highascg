**Status: IMPLEMENTED (2026-09-10, offline suite 2413/0/2, client build clean, syntax-checked, prettier pre-existing-only on touched files, new files prettier-clean) — needs `highascg` service restart + client rebuild/kiosk reload + owner on-hardware confirmation**

## Investigation

Owner request (this session, not from a `todos*` file): "i need a way in the inspector to
pause/play a selected media in a look as well as set trim in and trim out points. it needs a
small progress bar that a user can jump around with."

Surveyed the existing per-layer Look inspector
([inspector-scene-layer.js](../../client/components/inspector-scene-layer.js)) and playback
engine before building anything (see conversation for the full research pass). Summary of what
already existed vs. what needed building:

- **PAUSE/RESUME AMCP**: already wired (`src/caspar/amcp-basic.js`, `/api/pause`/`/api/resume` in
  [routes-amcp.js](../../src/api/routes-amcp.js)) but only ever called from the timeline
  transport — never from a look/scene-take path, and neither route updated the playback-position
  tracker.
- **SEEK AMCP**: used server-side for scene-layer takes
  ([scene-play-seek.js](../../src/engine/scene-play-seek.js)) but had no client-reachable route —
  `CALL {ch-l} SEEK {frame}` is generic AMCP `amcp.call()`, unused by any HTTP route.
- **Trim/LENGTH AMCP**: `LENGTH` is fully wired at the AMCP command-serialization layer
  ([amcp-command-plan.js](../../src/caspar/amcp-command-plan.js)) but `loadOpts.length` was never
  actually SET anywhere in [scene-take-lbg-jobs.js](../../src/engine/scene-take-lbg-jobs.js) —
  dead code.
- **Persisted trim state**: did not exist on a scene layer at all (only the separate TIMELINE
  clip object has an `inPoint`, and no `outPoint` even there).
- **Live position feed**: `state.playback.matrix` (server: `src/state/playback-tracker.js`,
  client-reachable via WS) already gives `{channel, layer, startedAt, durationMs, playing, loop}`
  per physical channel-layer — but nothing updated it across PAUSE/RESUME/SEEK, so a scrub bar
  built on it would drift or jump the instant the operator touched pause/seek.
- **Progress-bar UI / physical-channel resolution for a live-push from this inspector**: no
  progress-bar component existed anywhere in the app. A precedent for "is this scene layer
  currently live, and what's its physical Caspar channel" DID exist —
  `scheduleLivePipOverlayPush` in
  [inspector-pip-overlay.js](../../client/components/inspector-pip-overlay.js) — reused as the
  model (see "What was done").
- **Media duration lookup**: solved (`client/lib/media-duration.js`).

Two design decisions were owner-confirmed before building (see conversation):
1. Trim in/out persist on the layer (like the timeline clip's `inPoint`) — every future take uses
   them, not a one-off live cue.
2. Transport is **live-only** — pause/scrub act on the real Caspar layer via AMCP, enabled only
   while this look is actually on program or preview. No local/pre-air scrubbing (would need a
   separate video-element preview pipeline — out of scope).

## What was done

### Server

- **[playback-tracker.js](../../src/state/playback-tracker.js)** — added `recordPause`,
  `recordResume`, `recordSeek`. PAUSE freezes the tracked elapsed time (`pausedElapsedMs`) so the
  `Date.now() - startedAt` math other code already does (`scene-play-seek.js`'s
  `getLivePlayheadFrames`) doesn't keep advancing while the layer is actually frozen; RESUME
  rebases `startedAt` to resume exactly there; SEEK rebases whichever of the two is active to an
  arbitrary `positionMs`. All three are no-ops for an untracked channel-layer (never fabricate a
  matrix cell).
- **[routes-amcp.js](../../src/api/routes-amcp.js)** — `/api/pause` and `/api/resume` now also
  call the new tracker functions (previously they only sent AMCP, the tracker was never told).
  Added `/api/seek` (`{channel, layer, frame, positionMs}`): sends `CALL {ch-l} SEEK {frame}` via
  `amcp.call()` (no new AMCP-layer plumbing needed) and calls `recordSeek(ctx, ch, l, positionMs)`.
  No router registration needed — bare `/api/*` exact paths already fall through to
  `routesAmcp.handlePost` via the legacy dispatcher in `router-dispatch.js`, same as
  `/api/pause`/`/api/call`.
- **[scene-play-seek.js](../../src/engine/scene-play-seek.js)** —
  `resolvePlaySeekFramesForSceneLayer`'s `sb === 'beginning'` branch now starts at
  `layer.trimInMs` (converted to frames via the take's fps) instead of a hardcoded frame 0, when
  set. The timeline-clip-driven branch above it (`clip && timelineCtx`) is untouched — that's a
  different inPoint mechanism (timeline clips), out of scope here.
- **[scene-take-lbg-jobs.js](../../src/engine/scene-take-lbg-jobs.js)** — after the existing
  `loadOpts.seek = seekFrames` line, added `loadOpts.length` from `layer.trimOutMs`, computed
  **relative to wherever the take actually starts** (`seekFrames`, which may be later than
  trimIn — e.g. "relativeToPrevious"/continue), not naively from trimIn. A trim-out at or before
  the resolved start yields no LENGTH at all (never emits a non-positive value).

### Client

- **New [inspector-media-transport.js](../../client/components/inspector-media-transport.js)**
  — `appendMediaTransportGroup(root, {sceneId, layerIndex, layer, scene, sceneState, stateStore})`,
  wired into `inspector-scene-layer.js` right after the playlist group. Gated on
  `mediaDurationMs(layer.source?.value) > 0` (excludes images/live/route/template sources for
  free — no explicit type whitelist needed) and `layer.sourceMode !== 'list'` (playlist-mode trim
  is out of scope for this pass — noted as a residual gap below).
  - **Physical target resolution**: `resolveMainIndexForScene` + checks BOTH
    `sceneState.liveSceneIdByMain[mainIdx]` (→ PGM channel via `resolveLookStackChannelForBus`)
    and `sceneState.previewSceneIdByMain[mainIdx]` (→ PRV channel) — unlike
    `scheduleLivePipOverlayPush`'s PIP-overlay precedent this does NOT exclude
    `editingSceneId === sceneId`; that exclusion exists there specifically to stop a DRAFT param
    edit from leaking onto program before Take, and pause/seek has no such draft/applied split to
    leak (documented in the file header). Physical layer = `layer.layerNumber` directly, same
    simplification the PIP-overlay precedent already uses (no bank-A/B offset resolution) — kept
    consistent with that established, shipped behavior rather than reinventing it.
  - **Transport row**: play/pause button + scrub `<input type=range>` + `m:ss / m:ss` label.
    Polls `stateStore` every 200ms (self-terminating on the next tick once its DOM node is
    detached — no external unmount hook needed, matches the vanilla-JS
    `root.innerHTML = ''`-on-rerender pattern this inspector already uses everywhere). Dragging
    the scrub bar debounce-SEEKs (60ms) and suppresses the poll's own position writes until
    release, so the tick loop can't fight an in-progress drag.
  - **Trim in/out**: two `createDragInput({slider:true})` fields (seconds, 0–duration), same
    reusable primitive the rest of this inspector already uses for numeric+slider fields.
    Patches `sceneState.patchLayer(sceneId, layerIndex, {trimInMs|trimOutMs})` — a fully generic
    `Object.assign`-based patch (`scene-state-layer-logic.js`), so no schema/migration change was
    needed for the new fields to persist. "Set in/out ← playhead" convenience buttons capture the
    live position.
- **CSS**: appended ~25 lines to
  [05d-inspector-fields.css](../../client/styles/05d-inspector-fields.css) (417→~445 lines, well
  under the 500 cap) — flex layout only; the scrub `<input type=range>` automatically inherits the
  panel's existing `max-width:150px` cap and wheel-over-unfocused-slider→panel-scroll behavior
  (both already generic, panel-wide rules — matches the owner's "small progress bar" ask for free).

## What was verified

- New `tools/smoke/smoke-wo570-look-media-transport.test.js` (7 tests, added to the curated CI
  list in `tools/ci/run-offline-tests.js`): `recordPause`/`recordResume` freeze-and-rebase
  correctly including a pause-while-already-paused no-op; `recordSeek` rebases both a playing and
  a paused cell to the same target position; all three are no-ops on an untracked channel-layer;
  `POST /api/seek` sends the exact `CALL {ch-l} SEEK {frame}` line and rebases the tracker, and
  rejects a missing/invalid frame without touching AMCP; `resolvePlaySeekFramesForSceneLayer`
  trim-in math; `buildTakeJobs` LENGTH wiring including the "relative to actual start, not raw
  trimIn" case and the degenerate (trimOut ≤ start) no-LENGTH case.
- `node tools/ci/run-offline-tests.js` — **2413 pass / 0 fail / 2 skip** (full suite; up from
  2406 pre-change by exactly the 7 new tests). Two transient failures during this session
  (`ERR_ASSERTION … 12001 !== 12000` / `12005/12006`, a `Date.now()`-based wall-clock timing test
  in an UNRELATED pre-existing file, `smoke-wo537-look-timeline-starts-where-asked.test.js`) were
  confirmed pre-existing and environmental — reproduced identically with this session's changes
  stashed out, and pass cleanly 3/3 when run in isolation; both later full-suite reruns were clean.
- `npm run build:client` — clean build, no new errors/warnings (pre-existing chunk-size and
  ineffective-dynamic-import warnings, unrelated to these files).
- `node --check` on all six touched/new `.js` files — syntactically valid.
- `check-max-file-lines.js` — no touched/new file near the 500-line cap; the one file over
  (`scene-take-lbg.js`, 522) is pre-existing and unrelated.
- `prettier --check` — the two brand-new files (`inspector-media-transport.js`,
  `smoke-wo570-look-media-transport.test.js`) are prettier-clean; the six existing files touched
  warn, confirmed **pre-existing** by stashing this session's changes and re-running (identical
  warnings before them).
- Not yet verified live: no service restart / client rebuild+kiosk-reload performed this session.
  Owner should `npm run build:client` + kiosk reload (XTEST F5) + `kill -TERM
  $(systemctl show -p MainPID --value highascg)`, then on a look with a media layer on
  program/preview: confirm pause/resume actually freezes/resumes the real Caspar layer, the scrub
  bar tracks position and jumping to a new spot actually seeks, and a trim in/out set on a layer
  with "Start from beginning" is honored on the NEXT take (not the currently-playing instance —
  that's by design, see the in-app hint text).

## Update 2026-09-11: owner couldn't find it — silent-hide gating was the real bug

Owner: "i dont see the new settings in the clips inspector. where are they?"

Confirmed the built `dist-web/` bundle already contained the new code (`grep`'d "Media transport"
into the fresh `main-*.js`), so this wasn't an un-built/un-reloaded client — it was a **UX bug in
the gating itself**: `appendMediaTransportGroup` originally returned with NO output at all
whenever `mediaDurationMs()` couldn't resolve a trustworthy duration for the layer's source
(untrustworthy/contradictory catalog entries, or a file the media scanner hasn't probed yet — see
`media-duration.js`'s own documented refusal-to-guess behavior) — the entire group vanished with
zero indication why, which is indistinguishable from "the feature doesn't exist" to an operator.

Fixed in [inspector-media-transport.js](../../client/components/inspector-media-transport.js):
split the single silent-return gate into three cases —
1. `looksLikeVideoMedia(layer.source)` false (route/live/template/CG/image/no source at all) →
   still silently skip. This is the correct behavior for the majority of layers in a look, which
   genuinely aren't video media — showing an inert "Media transport" box on every template/live/CG
   layer would be worse noise than the bug being fixed.
2. `sourceMode === 'list'` (playlist mode, the documented residual gap below) → now renders the
   group with an explanatory hint instead of nothing.
3. Duration lookup fails on what otherwise looks like real video media → now renders the group
   with `Clip duration unknown for "<value>" — play/pause/trim need a known length (check the
   media scan / Sources tab).` instead of nothing.

Verified: `node --check`, `npm run build:client` (clean), `prettier --check` (clean, own file),
full offline suite unaffected (no test exercises this file's DOM output; the touched gating logic
has no server-side counterpart). Owner should reload the page/kiosk and re-check: if the group now
shows the duration-unknown hint, the real root cause was an unprobed/ambiguous media file, not a
stale build.

## Update 2026-09-11 (same day, follow-up): duration-unknown was a real race, not bad data

Owner: "i see the clip duration unknown, but that is not true, because in the media browser the
duration is displayed correctly." Plus a styling note: the hint text was "too big, and white"
— didn't follow the inspector's other hint-paragraph style.

**Styling**: confirmed `.inspector-field--hint` carries no CSS rule anywhere in
`client/styles/` — every other hint paragraph in this codebase sets `font-size`/`color` inline
at each call site (e.g. `inspector-scene-layer.js`'s `startHint`), and my new
`appendHintOnlyGroup` message was the one place in this file that forgot to. Fixed by extracting
a `makeHintParagraph()` helper used by all three hint paragraphs in this file now, so they can't
drift from each other again.

**Duration-unknown**: pulled the LIVE media catalog (`GET /api/media`) and the LIVE project
(`GET /api/project`) off the box and ran the actual `mediaDurationMs()` lookup against them
directly in Node for the owner's two real video layers
(`Spoty_Ptt_2026 MichaÅ.mp4` → catalog `durationMs: 379300`,
`Nagranie Ministra Zdrowia Jolanta SobieraÅska-Grenda.MP4` → catalog `durationMs: 51840`,
both containing a genuine mis-decoded Polish "ł"/"ń" that turned out to be byte-identical between
the project and the catalog, not a mismatch) — **both resolved correctly**. The matching logic
itself was never broken.

The real bug: `appendMediaTransportGroup` called `mediaDurationMs()` exactly ONCE, synchronously,
at render time. The client's media catalog (`state.media`) populates over WebSocket a beat after
page load — reload the page, click into a layer fast enough, and the catalog isn't there yet, so
the ONE lookup legitimately returns null. Nothing ever re-checked afterward, so the hint text
just stayed on "unknown" forever even once the catalog arrived moments later — the owner's
page-reload (requested for the earlier gating fix) walked straight into this.

Fixed: `appendMediaTransportGroup` now retries the duration lookup every 400ms for ~10s
(self-terminating once its placeholder DOM node is removed, matching the file's existing
tick-timer idiom) while showing "checking media scan…"; the moment `mediaDurationMs()` resolves,
the placeholder is replaced in-place with the full transport controls. Only after ~10s of genuine
failure does it settle on the permanent "duration unknown" message.

Verified: `node --check`, `prettier --check` (clean), `npm run build:client` (clean),
`smoke-wo570-look-media-transport.test.js` still 7/7 (unaffected — this fix is pure client
reactivity, no server-side counterpart). No test exercises the DOM/timer behavior directly (would
need a DOM test harness this repo doesn't have for client components); the fix was validated by
reproducing the exact race by hand (fetched the live catalog+project, confirmed the lookup
resolves correctly once the catalog is present) rather than a synthetic timing test.

## Update 2026-09-11 (same day, second follow-up): the real root cause — probed data never reached global state

Owner: "nope, still duration unknown after checking for 10s." The retry loop was correct but
couldn't help — this wasn't a race, it was a permanent gap.

Traced how `state.media` (the only thing `media-duration.js` ever read) gets populated: it's the
raw WS-pushed CINF snapshot. The CORRECT ffprobe-merged catalog (`GET /api/media`) is fetched
independently by [sources-panel.js](../../client/components/sources-panel.js) into its own
module-local `mediaWithProbe` variable, merged ONLY for that panel's own rendering via
`mergeMediaProbeOverlay` ([sources-panel-helpers.js](../../client/components/sources-panel-helpers.js))
— never written back to the shared `stateStore`. For a file whose only WS/CINF row fails the
existing fps<1 sanity check (documented in this file's own header as the exact trap it exists to
survive) with no probed counterpart ever reaching global state, `mediaDurationMs()` returns null
**forever**, not transiently — which is exactly what the owner's two real files hit (confirmed
live: `GET /api/media` has `Spoty_Ptt_2026 MichaÅ.mp4` → `durationMs: 379300`, but that row only
ever existed in the Sources panel's private cache).

This is a pre-existing gap in WO-370's `media-duration.js`, unrelated to WO-570's UI — it would
have silently affected playlist-row duration display too, just as a blank label rather than a
whole disabled feature, which is presumably why nobody had reported it before now.

**Fix**: [media-duration.js](../../client/lib/media-duration.js) now fetches `GET /api/media`
itself, once, at `initMediaDurationIndex()` time, and merges the result into the same
`rebuild()` candidate pool `state.media` already feeds — reusing the existing `candidateOf`/`pick`
tie-break logic rather than duplicating the Sources panel's own folder-scoped merge (that merge
solves a different problem, deduping a rendered file/folder LIST; duration lookup only needs the
candidate pool, not dedup). Every `mediaDurationMs()` caller benefits now, not just whichever
panel happens to have been opened — including the pre-existing WO-370 playlist rows.

Verified: two new tests in `tools/smoke/smoke-wo370-playlist-media-durations.test.js` reproduce
the exact bug (a file `state.media` alone cannot resolve, rescued once a probed overlay is
supplied) and pin that `initMediaDurationIndex` actually fetches `/api/media`. Full existing
WO-370 suite (9 tests) still passes unchanged — `_setMediaForTest`'s new second (optional)
parameter defaults to `[]`, byte-identical to the old always-empty-probe behavior for every
existing call site. `node --check`, `prettier --check`, `npm run build:client` all clean; full
offline suite **2415 pass / 0 fail / 2 skip** (up from 2413 by exactly these 2 new tests).
Confirmed the built `dist-web/main-*.js` contains both the fetch call and the new retry-loop
message text.

## Update 2026-09-11 (same day, third follow-up): trim points never reached the server at all

Owner: "the new options appear now, but the set in out points are not saved thus do not work when
the look is played."

Traced the actual take path client-side: `sceneState.patchLayer()` sets `trimInMs`/`trimOutMs` on
the live in-memory layer object correctly (confirmed — no bug there), and the client sends the
**full current layer state** on every take/stage via
[buildIncomingScenePayload()](../../client/components/scenes-shared.js) (not a `sceneId` the
server re-reads from its own persisted copy) — so this was never actually a persistence-timing
problem despite how the owner (reasonably) read the symptom.

The real bug: `buildIncomingScenePayload()`'s per-layer `row` object is an explicit field
**whitelist** for the wire payload (~20 named fields — `layerNumber`, `source`, `loop`, `fill`,
`opacity`, `playlist`, etc.) — and `trimInMs`/`trimOutMs` were never added to it. The values sat
correctly on the client's own scene-state object the whole time; they just never left the browser.
The server-side engine pieces added earlier this WO (`scene-play-seek.js`'s trim-in,
`scene-take-lbg-jobs.js`'s LENGTH) were correct and already covered by tests — those tests just
never exercised the actual wire-serialization step, which is a separate function entirely.

**Fix**: added `trimInMs`/`trimOutMs` to the `row` literal in `buildIncomingScenePayload()` (only
when set, matching how other optional fields like `effects`/`pipOverlays` are conditionally
added). This single function is the shared builder for both program-take and preview-stage
payloads, so both paths are fixed by the one change.

**Adjacent finding, NOT fixed (out of scope, flagged for a separate look)**: the plain string
`startBehaviour` has the same structural gap — it's read from the ORIGINAL scene layer client-side
only to precompute a `playSeekFrames` frame number (attached to the row separately), but the
string value itself is never included in the row either. Since the server's
`resolveEffectiveStartBehaviour()` falls back to `'beginning'` when the field is absent and no
timeline clip is active, a non-timeline layer's "Relative to timeline (layer)" dropdown choice may
already be silently ineffective on take — this predates WO-570 and is unrelated to trim, so it
wasn't touched here, but is worth its own investigation.

Verified: new test in `smoke-wo570-look-media-transport.test.js` pins the `row` literal directly
(matching this exact function's existing test precedent in
`smoke-wo531-authoring-canvas-follows-target.test.js`, which also greps source rather than
invoking the function — it's tightly coupled to the `sceneState` singleton). Confirmed the test
actually catches the bug: stashed the one-line fix out and reran — the test fails with the exact
"must carry trimInMs" message; restored, it passes. Full offline suite **2416 pass / 0 fail / 2
skip** (up from 2415 by this one new test). `node --check`, `prettier --check` (pre-existing
warning on `scenes-shared.js`, confirmed via the same stash comparison this WO has used
throughout), `npm run build:client` clean, confirmed `trimInMs` present in the rebuilt
`dist-web/assets/main-*.js`.

## Residual gaps (out of scope this pass, noted for a follow-up if wanted)

- **Playlist-mode layers** (`sourceMode: 'list'`) get no transport group at all — trim/scrub for
  an individual playlist item would need its own per-item state and was out of scope for "a
  selected media in a look" (singular).
- **Bank A/B crossfade physical-layer resolution** is simplified (no offset applied), matching
  the existing PIP-overlay precedent this was built on — correct for the common case, same known
  limitation as everything else built on that pattern.
- Trim-in only takes effect when the layer's "Start behaviour" is "Start from beginning" (matches
  how the timeline clip's own `inPoint` already behaves) — the in-app hint text says so, but
  there's no UI nudge to actually SET that behaviour together with a trim point.
