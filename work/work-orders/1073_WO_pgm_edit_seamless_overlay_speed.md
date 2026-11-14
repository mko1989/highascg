# WO-1073 — PGM edits on air without reloads (PiP border params, clip speed / trim)

**Area:** engine, amcp
**Status: IN PROGRESS (14.11.26 — built; the offline suite proves the AMCP each edit now sends (wo1073 smoke 15/15, 11 of them fail on the pre-change sources); NOTHING proven on a real Caspar yet — no AMCP was sent to the running server, it was not restarted)**

Owner, 14.11.26: *"I changed settings such as the speed of a clip and parameters of a PiP border on pgm2 (screen index 1,
program channel 4, PGM-only) … each change made the clip or the border reload. I'd like whatever possible to show
seamlessly on the screen with no restarts."* The PGM edit is the WO-1044 unlocked look editor.

## Investigation

Every PGM edit goes through `pushEditToPgm` (src/api/routes-scene-pgm-edit-push.js), which uses the PRV push's decision
(`decidePreviewPush`: nudge / overlay / take).

1. **PiP border params reloaded the clips.** At HEAD only `decided === 'nudge'` took the nudge path
   (routes-scene-pgm-edit-push.js:54 at HEAD). An overlay-only change (`'overlay'`, WO-601) fell through to the cut take at
   :76, which LOADBG … SEEK 0 + PLAYs every clip of the look and re-ADDs every overlay. The PRV push already had an
   overlay mode (routes-scene-preview-pip.js `pushPreviewPipOverlays`), but it is bankless. On PGM the overlay slots
   depend on the active bank: slot = 260 + compact(physical layer)·4 + i, so layer 10 → 260 and layer 110 → 620.
2. **Even in overlay mode an OUTSIDE border was re-ADDed.** `buildPipOverlayAmcpLinesAll` updated in place only for
   `!utils.isOutsideSide(cur)` (src/engine/pip-overlay.js:119 at HEAD). An outside border (the default side) of the same
   type got `CG CLEAR` + `MIXER CLEAR` + `CG ADD` + `PLAY` + `UPDATE` (:135). A CG ADD of an HTML template is always a
   new CEF page, so the border blinked on every slider tick, on PRV as well.
3. **A speed / trim edit reloaded every layer of the look, at its start.**
   - Every take path calls `runSceneTakeLbg` with `skipLayerVisualEquality: true` (routes-scene-take.js:215, 285, 399,
     431 at HEAD). So `buildTakeJobs` never keeps an identical layer (scene-take-lbg-jobs.js:159 at HEAD). The only
     exception is the WO-956 relative-start keep.
   - The PGM-only call (:431) also runs with `takeOpts.currentScene = null` (:146). It compares against nothing, so
     currentMap.size is 0.
   - The clip starts where `resolvePlaySeekFramesForSceneLayer` says (scene-take-lbg-jobs.js:237 at HEAD): the clip
     start, or the in-point.
4. **Speed and playhead.** WO-973 applies speed as `VF setpts=(PTS-STARTPTS)/x+STARTPTS` + `AF atempo` at LOADBG; IN/SEEK
   are in clip time. Caspar's OSC `file/time` is the pts of the frame leaving the filter graph
   (av_producer.cpp:1194 `frame.pts = … frame.video->pts`). The setpts re-times it from the first frame decoded after
   the last seek or loop, a keyframe K at or before the seek. Clip time = K + x·(time − K), and K is not reported.
   - At 1x, OSC time **is** the clip position. The WO-582 projection (`projectRelativeSeekFrames`, the same one relative
     starts use) lands frame-accurately.
   - At any other speed there is **no reliable clip playhead** from this build.
5. **The PRV edit (WO-598 / WO-955) has the same problem.** Its take fallback (routes-scene-preview-push.js:156 at HEAD,
   `target: 'preview', forceCut: true`) reloads every layer of the staged look, and its overlay push re-ADDs outside
   borders (2.).
6. **Stacking inversion if a layer is simply kept on PGM.** A kept layer stays on the old bank until the post-teardown
   WO-218 SWAP (scene-take-lbg-bank-finalize.js:50-51). For example, a changed L10 PLAYs on 110 above a kept L11 still on
   11. Until the teardown, the background covers the PiP. The SWAP also never moved the PIP overlay slots of a kept
   layer: its border stayed on the old bank's slot, and the next take's sweep of that slot cleared it.

Latent issues found on the way, **not fixed here** (normal takes must stay unchanged):

- **PGM-only cut takes sweep the on-air look before the PLAY.** `currentScene: null` (routes-scene-take.js:146 at HEAD,
  passed at :431) leaves currentMap empty. The WO-814 on-air exemption (scene-take-lbg.js:224) then protects nothing, and
  the WO-160b pgmOnly sweep (scene-take-lbg.js:219) sends `CG 1-10 CLEAR`, `STOP 1-10`, `MIXER 1-10 CLEAR`, … ahead of
  the LOADBG batch (seen in the smoke's normal-take trace).
  - That is most likely a black gap on every operator cut on a PGM-only screen (pgm2), and WO-956 can never keep a layer
    there either.
  - Unproven on air; wants its own WO and a box A/B.
- Inside-overlay `CG UPDATE` on a pgm/prv take whose previous look had the same inside overlay on that layer addresses
  the new bank's slot, which is empty.
- `dest.take` (dest-actions.js) carries neither `editOnAir` nor `previewExchange`.
- An edit-take re-registers the live entry, so `updatedAt` (clip clocks / timers) resets. Changing that needs
  routes-scene-take.js, which is at 500 lines.

## What was done

- **src/engine/scene-take-edit-on-air.js** (new): the edit rule.
  - `editLayerKeepsPlaying`: strict stable-JSON equality of the on-air and edited layer. It ignores the take-time
    `playSeekFrames`, compares media names canonically (media ≡ file, project-relative ids expanded), and never keeps a
    playlist.
  - `editTimelineStays`.
  - `editResumeSeekFrames`: same file + on-air at 1x → the projected OSC playhead, fitted inside the edited in/out.
    Otherwise it returns null and logs the reason (`on air at 1.5x — Caspar reports filter-output time …`).
  - `attachEditSwapsToPlayBatch` / `keptLayerSwapLines` / `vacatedOverlayClearLines`: the SWAP of a kept layer **and its
    overlay slots**, sent inside the PLAY batch.
  - `canonValue` was moved here from routes-scene-pgm-edit-push.js (same rule; still re-exported there).
- **src/engine/scene-take-lbg-jobs.js**: `editOnAir` option (default false).
  - An unchanged layer becomes a WO-218 skipped layer even under `skipLayerVisualEquality`.
  - An unchanged timeline is not restarted.
  - A reloaded same-file layer gets the resume seek, read from the on-air bank's physical layer.
- **src/engine/scene-take-lbg.js**: passes `editOnAir` through, and for banked, non-merge edit takes attaches the kept
  layers' SWAPs to the first PLAY job.
- **src/engine/scene-take-lbg-amcp-pipeline.js**: `sendPhasedTakePlays` sends `job.swapBeforePlay` ahead of the PLAY
  plan, in the same atomic batch (WO-259).
- **src/engine/scene-take-lbg-bank-finalize.js**: skips layers already swapped. The WO-218 SWAP now also SWAPs the
  overlay slots of a kept layer and clears the vacated slots.
  - **This touches normal takes too** (WO-956 relative keeps). It adds lines only for kept layers that carry PIP
    overlays, and fixes their orphaned borders. No clip restarts.
- **src/engine/pip-overlay.js**: `opts.outsideInPlace` lets an outside overlay of the same type/side be CG UPDATEd in
  place. Only the edit pushes pass it; takes keep the ADD path.
- **src/api/routes-scene-take-edit.js** (new): `editOnAirFor`, evaluated inside the per-channel take chain.
  - Same look still on the channel → edit mode.
  - PGM with another look on air → 409 `not_on_air`, nothing sent, never a re-take.
  - PRV with another look staged → a plain staging take, as before.
- **src/api/routes-scene-take.js**: computes `editOnAir` and passes it on the PRV, PGM+PRV and PGM-only calls. The
  PGM-only call also gets the live `currentScene`, **only in edit mode**.
- **src/api/routes-scene-take-look.js**: carries `editOnAir` to the take and through a cluster relay.
- **src/api/routes-scene-pgm-edit-push.js**: `'overlay'` → the PGM nudge + `pushPgmPipOverlays`, then the live entry is
  updated in place. A failed overlay push → 409 `not_on_air`. The content take carries `editOnAir: true`, and its 409
  maps to mode `not_on_air`.
- **src/api/routes-scene-preview-pip.js**:
  - `buildPreviewPipLines` takes `physOf` and uses `outsideInPlace`.
  - New `pushPgmPipOverlays` runs on the program channel's take chain, re-checks the live look, reads the ACTIVE bank
    there, and sends the overlay lines for those slots.
- **src/api/routes-scene-preview-push.js**: the PRV take fallback passes `editOnAir: true` when the staged look is the
  one being edited.

Why this over alternatives:

- Gating on an explicit `editOnAir` instead of dropping `skipLayerVisualEquality` keeps every operator take's
  restart-everything contract (and replication / mirror takes) untouched.
- SWAP inside the PLAY batch rather than keeping kept layers on the old bank avoids the stacking inversion without
  re-planning the bank layout.

## AMCP, before → after (from the smoke, look L1 = L10 `bg.mov` + L11 `pip.mov` with an outside border, PGM ch 1 bank A)

**Speed 1 → 1.5 on L10, PGM-only screen.**

Before (the normal take, which was what an edit did):

1. Sweep: `CG 1-10 CLEAR`, `STOP 1-10`, `MIXER 1-10 CLEAR`, `CG 1-260..263 CLEAR`, `CG 1-11 CLEAR`, `STOP 1-11`, … ,
   `MIXER 1 COMMIT`.
2. Batch: `LOADBG 1-110 BG IN 0 SEEK 0 VF …` + `LOADBG 1-111 PIP IN 0 SEEK 0` + mixer + `CG 1-624 CLEAR`, `CG 1-624 ADD 0
   "pip_border" …`, `CG 1-624 PLAY 0`, `CG 1-624 UPDATE …`.
3. Batch: `PLAY 1-110`, `PLAY 1-111`.

After (`editOnAir`):

1. Batch: `MIXER 1-110 CLEAR`, `LOADBG 1-110 BG IN 0 SEEK 519 VF "setpts=(PTS-STARTPTS)/1.5+STARTPTS" AF "atempo=1.5"` +
   L10 mixer. SEEK 519 = OSC frame 500 + 385 ms at 50 fps; it is SEEK 0 when there is no OSC playhead.
2. `MIXER 1 COMMIT`.
3. Batch: `SWAP 1-11 1-111 TRANSFORMS`, `SWAP 1-264 1-624 TRANSFORMS`, `PLAY 1-110`.
4. Teardown: `CG 1-10 CLEAR`, `STOP 1-10`, `MIXER 1-10 CLEAR`, `MIXER 1-11 CLEAR`, `CG 1-264 CLEAR`, `MIXER 1-264 CLEAR`.

The same lines are sent on a screen with PRV (previewExchange false).

**Outside border width 8 → 14, PGM bank B.**

- Before: the full take above.
- After (one batch, no take): `CG 1-624 UPDATE 0 "{…width 14…}"`, `MIXER 1-624 FILL …`, `KEYER 0`, `OPACITY 1`,
  `ANCHOR`, `ROTATION`. On bank A it is slot 264.

**Same border edit on PRV ch 2.**

- Before: `CG 2-264 CLEAR`, `MIXER 2-264 CLEAR`, `CG 2-264 ADD 0 "pip_border" 1 …`, `CG 2-264 PLAY 0`,
  `CG 2-264 UPDATE …`, `MIXER 2-264 FILL …`.
- After: `CG 2-264 UPDATE …`, `MIXER 2-264 FILL …` (no CLEAR/ADD).

**PRV edit take (speed on L10).**

- Before: LOADBG + PLAY of 2-10 and 2-11, and the border re-ADDed.
- After: `MIXER 2-10 CLEAR`, `LOADBG 2-10 BG IN 0 SEEK 0 VF …` + L10 mixer, `MIXER 2 COMMIT`, `PLAY 2-10`. L11 and its
  border are untouched.

## What still reloads, and why

- **The edited layer itself** on a speed / trim / loop / audio / file change. WO-973 speed and trim are LOADBG
  parameters; there is no in-place AMCP for them on this build.
- **Resume after a speed change only works from 1x.** When the layer is on air at ≠1x, the reloaded clip starts at its
  own start (SEEK = the in-point) and the log says why.
  - Making this seamless needs a Caspar-side clip-time OSC field: either the decoder pts before the filter, or K
    exported.
- **Any change to a layer reloads that layer** (fill/crop changes alone are a nudge, never a take). Playlists always
  reload. An overlay type/side/order change re-ADDs the template (a new CEF page).
- **PRV:** the reloaded layer's Phase A `MIXER 2-10 CLEAR` resets its deferred mixer state until the Phase B COMMIT. On
  the reloaded layer only, this is roughly the 80–350 ms prebuffer window. It has always been this way and is unchanged.

## Verified

- `node --test tools/smoke/smoke-wo1073-pgm-edit-seamless.test.js` → **15 pass, 0 fail**.
  - Run against a scratch copy of `src/` with the 10 modified files taken from HEAD (the new modules present): **11
    fail, 4 pass**. The 4 that pass are the guards that pin unchanged behaviour (normal take reloads all; normal take
    SEEK 0; PRV with another look staged = plain take; the pure compare helper).
- Repointed to the new contract (strengthened, not weakened):
  - smoke-wo1044-pgm-edit-push.test.js:58: the content take now also carries `editOnAir: true`.
  - smoke-wo955-trim-restages-prv.test.js:85: same, for the PRV trim take of the staged look.
- `node tools/ci/run-offline-tests.js` → **6255 tests, 6247 pass, 0 fail, 3 todo** (WO-983 ⚠ todo entries). That is
  6232 before + 15 new.
- Other gates:
  - `check-max-file-lines` → 0 files over 500. routes-scene-take.js and scene-take-lbg-amcp-pipeline.js are at exactly
    500.
  - `check-unwired-exports` → no new orphans.
  - `npm run -s lint` → 0 errors (176 warnings; the one in a touched file, routes-scene-pgm-edit-push.js:42 `b`, predates
    this WO).
  - `format:check` → clean.
  - `node index.js --no-http` → exits cleanly, no errors.
- **Not proven:** anything on a real Caspar. Open items:
  - SWAP of a CG slot inside a batch with PLAY.
  - That a CG UPDATE of the outside border with the new MIXER FILL renders without a blink.
  - The SEEK 519 landing frame-accurately on a 1x → 1.5x edit.
  - That the PGM-only screen shows no gap.

  Next: an A/B on the box's PGM-only screen. Edit the border width and the clip speed of the look on air, watch the
  :6250 OSC frames and a screen capture, and check the AMCP ring for the lines above.
