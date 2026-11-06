# WO-970 — A layer leaving PGM cut instead of fading when the rest of the look kept playing (image and video)

**Area:** engine
**Status: DONE (06.11.26 — A/B on PGM ch2: old gate STOPs the leaving layer 20–43 ms after the take with opacity never moving; fixed gate ramps it 1→0 over the take's 25 / 100 frames, then STOP; still and clip, PRINT frames show the dissolve; reverse + content change unchanged; smoke 5/5) — owner QA**

Owner show notes 06.11: *"Looks with image producers doesn't do a fade out when going out of the pgm. when switching
looks from one that has image on a layer back to one that doesnt have the image, the image doesnt fade out like it
should but rather cuts out. possibly wrong amcp. not only image, video clips too."*

Related: [WO-956](./956_WO_shared_loop_across_looks_reloads_every_take.md) (05.11: an unchanged "relative" layer keeps
playing across takes — the trigger), [WO-541](./541_WO_TIMELINE_ONLY_LOOK_NEVER_FADES_IN.md) (the same gate, timeline-only
looks), [WO-814](./814_WO_take_order_and_amcp_batch_play_last.md) (take order / PLAY batch),
[WO-828](./828_WO_timeline_in_look_take_and_play_verification.md) (D4: teardown reference layer).

## Investigation

**Shape of the show.** The owner's looks share layer 10 (a background loop, start "relative to previous", WO-956) and
put a bumper / image on layer 11. Going back to the bare background look = look B is look A minus layer 11, and layer 10
is unchanged.

**Code path.** Every PGM take funnels through `runSceneTakeLbg` (`src/engine/scene-take-lbg.js`); the Godot client
(`POST /api/scene/take-look`) and the web client (`/api/scene/take`) both reach it via `handleSceneTake`
(`src/api/routes-scene-take.js:384-395`, `skipLayerVisualEquality: true, keepRelativeLayers: true`).

1. `buildTakeJobs` (`src/engine/scene-take-lbg-jobs.js:156-170`): layer 10 → `relativeLayerKeepsPlaying` → skipped,
   no take job. Layer 11 is gone from B → nothing. **`takeJobs = []`**, `exitMedia = [layer 11]`.
2. `shouldRunBankCrossfade = true` (MIX 25, a look on air), so `sendExitAndTimelineFadeLines`
   (`scene-take-lbg-exit-fade.js:52-57`) leaves the exit fade to the bank-crossfade batch.
3. That batch lives inside `runSceneTakeLbgAmcpPipeline`'s outer gate (`scene-take-lbg-amcp-pipeline.js:187`), which
   only opened for `takeJobs.length > 0 || mergeMixerExtras.length > 0 || (crossfade && incoming timeline)`
   (WO-541 widened it for timeline-only looks). With no job the whole block — including the "layers only in the
   leaving look: fade out on the active bank" loop (`:229-244`) — was skipped. No `MIXER … OPACITY 0 25`, and
   `fadeClockRef.start` stayed `null`.
4. `runSceneTakeLbgTeardown` (`scene-take-lbg-teardown.js:68-71`): `fadeClockStart == null` → `teardownWait = 0`, the
   WO-540 opacity verify is skipped too (`:117`), so `CG 2-111 CLEAR / STOP 2-111 / MIXER 2-111 CLEAR` went out at once
   — **a cut**, whatever the producer (image or clip: the path never looks at the source type).

**Proof from the owner's journal (06.11, ch2 = PGM Dioda).** 40+ takes into the background look `960fc4c0`
(*modern-abstract-gradient…*) from a 2-layer look have this signature, e.g. 16:07:18:

```
16:07:18.633 [scene-take-lbg] merge=false shouldRunBankCrossfade=true fadeDur=25 currentMapSize=2
16:07:18.634 [buildTakeJobs] layer 10 keeps playing (relative start, unchanged)
16:07:18.655 [scene-take-lbg] merge=false shouldRunBankCrossfade=false fadeDur=0 currentMapSize=0   ← already the PRV exchange
```

The PGM take finished in **22 ms** (a MIX 25 @ 50 fps must hold ≥ 500 ms for the fade) and logged no
`timing ch2 … play-acked` line — that line is written only inside the gated block. Every take with a job that day
(`layer 11 changed`) logged `timing ch2 … jobs=1` and ran the fade. (Teardown STOP/CLEAR lines are QUIET_CMDS — not in
the journal; they are in the offline capture below.)

**Offline capture** (`runSceneTakeLbg` with the API's flags, recording AMCP; bank B on air):

| A → B | AMCP before the fix |
|---|---|
| {10 bg relative, 11 clip} → {10 bg relative} | `CG 1-111 CLEAR`, `STOP 1-111`, `MIXER 1-111 CLEAR` at +0 ms — no OPACITY ramp |
| {10 bg "beginning", 11 clip} → {10 bg} | bg re-staged (job) → `MIXER 1-110 OPACITY 0 25`, `MIXER 1-111 OPACITY 0 25`, PLAY, STOP after 1 s ✔ |

So the AMCP is not "wrong" when it is sent — it is simply never sent for an exit-only take. The cut is specific to a
take with no incoming job, which since WO-956 (05.11) is the normal case for "the same loop under every look".

## What was done

- `src/engine/scene-take-lbg-amcp-pipeline.js:187` — the outer gate also opens for
  `shouldRunBankCrossfade && exitMedia.length > 0`. The block's existing `takeJobs.length === 0` branch ("Timeline-only
  / exit-only crossfade") then sends `MIXER <ch>-<phys> OPACITY 0 <dur> <tween>` for every leaving layer + COMMIT and
  starts the fade clock; the teardown then waits the fade (+ the WO-540 opacity verify) before
  `CG CLEAR / STOP / MIXER CLEAR` — the MIXER CLEAR resets the layer's opacity, so the next look on that slot is not
  invisible. Chosen over a second fade path in `sendExitAndTimelineFadeLines` because the crossfade block already owns
  "layers only in the leaving look" (incl. the WO-828 D4 hold-outgoing rule, multi-screen `playSync.arrive()`, the
  PGM→PRV exchange hook) — one exit-fade implementation, not two. CUT takes are unchanged (`fadeDur = 0` →
  `shouldRunBankCrossfade = false`).
- `tools/smoke/smoke-wo970-exit-only-take-fades.test.js` (new, curated in `tools/ci/offline-test-files-3.js`): exit-only
  take for a clip and for a still → OPACITY 0 over the take duration before the STOP, MIXER CLEAR after, the shared layer
  untouched; CUT stays a cut; reverse direction fades the incoming layer in; a content change still crossfades.
  2 of the 5 fail on the old gate (verified by flipping it back).

## What was VERIFIED

- Offline: new smoke 5/5 (2/5 fail with the old gate). Offline suite: 5364 tests, 5341 pass, 18 fail — the same 17
  failures with and without this change in the affected files (WO-973's in-progress `normalizeSpeed` in
  `routes-scene-preview-push.js:75`, WO-971's deck-scroll smoke), +1 stale INDEX (coordinator). Godot `--test`: 26040
  passed, 0 failed. 500-line check: 0 files over.
- **Box A/B (PGM ch2, Dioda 2560×640 @ 50, under `box2.lock`).** No project edits: synthetic looks posted to
  `/api/scene/take` (`useServerLive`), built from the show's own layers — `bg` = layer 10 of *modern-abstract-gradient…*
  with start "relative to previous"; `still` = bg + `wss_logo_statyk.png` on 11 (centred box); `clip` = bg +
  `wss-badowski.mp4` on 11. Sequence still → bg (exit) → still (enter) → clip (change) → bg (exit), MIX 25 and MIX 100.
  Probes: `MIXER 2-<L> OPACITY` polled at ~50 Hz (Caspar returns the live tweened value), `data/amcp-last50.txt`
  copied after each take, `tools/test-agent/caspar print 2 --crop 700,0,1160,640` during the MIX 100 fades.
  Scripts + data: scratchpad `wo970/` (`seq.sh`, `oppoll.py`, `mklooks.py`, `*.poll`, `*.amcp50`, `prints-*`).
  - **Before** (gate temporarily reverted to the old line + node restart, then put back): exit take at 21:44:24.877Z →
    `CG 2-11 CLEAR` .897, `STOP 2-11` / `MIXER 2-11 CLEAR` .920 (+43 ms), no OPACITY line; the poll shows layer 11 at
    opacity 1 throughout — a cut. Same for the clip exit (`STOP 2-11` +22 ms). (This run's layer 11 was a playlist
    item, i.e. a video; the PRINTs of this run were covered by the startup LED test card on 2-999 and are not used. The
    still variant is proven by the code path being source-agnostic + the smoke.)
  - **After** (fixed gate, node 22:48:33): still exit → `MIXER 2-11 OPACITY 0 25 linear` at 21:50:23.887, opacity
    0.96 → 0.80 → 0.56 → 0.28 → 0.04, `STOP 2-11` at +508 ms; clip exit identical (`OPACITY 0 25` 21:50:34.492, STOP
    +510 ms). MIX 100 PRINT crop luma, still exit 41.6 → 38.6 → 35.8 → 34.1 → 33.2, clip exit 65.1 → 57.7 → 50.2 →
    43.0 → 34.7 → 33.8 (bg-only ≈ 33); the frames show the logo / the clip dissolving into the background
    (`after2-exit-still-strip.png`, `after100-exit-clip-strip.png`).
  - Reverse (bg → still, layer enters): incoming 2-111 preset 0 then 0.04 → 0.92 → 1 over the take (as before).
    Content change (still → clip): outgoing 2-111 ramps 1 → 0 over the incoming clip on 2-11 (as before; the PRINT dip
    is the clip's dark intro frames, `after2-change-clip-strip.png`).
- Box restored: FTB screen 0 (PGM ch2 empty as found), the stored PRV look `4b0fb166` re-staged on ch3, the startup LED
  test card (brought back by node restarts) switched off. A client autosave afterwards stored `previewSceneIdByMain`
  as all-null (`previewSceneId` still `4b0fb166`).
- Not proven: the multi-screen (`playSync`) variant of an exit-only take, and a PGM-only (no PRV) screen — same
  function and branch, not driven on the box.
