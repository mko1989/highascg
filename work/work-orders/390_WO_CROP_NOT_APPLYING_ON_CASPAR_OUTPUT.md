# WO-390 — "Crop didn't apply on the actual Caspar output"

**Status: DONE (06.08.26 — evidence window expired; §4 defect fixed; §3.1 class mitigated. Re-open with the §5 capture on next sighting.)**
**Source:** owner 30.07.26 — "i had a look made with one of the layers with the crop effect. the crop
didnt apply on the actual caspar output."

Related: [WO-158](./158_WO_LOOKS_CROP_VISUAL_HANDLES_PIXELS_AND_BORDER_AWARENESS.md) (crop UX),
[WO-190](./190_WO_MULTIVIEW_TOP_CROP_MISMATCH.md) (MV crop mismatch, awaiting repro),
[WO-218](./218_WO_BANK_DRIFT_SKIPPED_LAYERS_MIXER_STATE.md) (bank drift splits producer/CROP state),
[WO-388](./388_WO_CROP_COUNTS_INTO_LAYER_SIZE_FOR_ALIGN.md) (the sizing half of the same report).

## 1. The look in question

`config/.highascg-state.json` → `web_project.scenes.scenes[6]` ("layout"), **layer 11**, source
**`route://6-1`** (channel 6 layer 1 = a DeckLink 8K Pro input), crop
`left=0.20833 top=0 right=0.79166 bottom=1`.

## 2. What was RULED OUT (with evidence)

### 2.1 The 2.6-dev binary applies CROP correctly — including on route layers

`VERSION` → `2.6.0 253c16c Dev`. Tested live via AMCP on :5250 with before/after `PRINT` frames:

| Test | Target | Result |
|---|---|---|
| Immediate `MIXER 2-10 CROP 0 0.5 1 1 0` on a still image (`glowna.png`, PRV ch2) | image producer | **Renders.** Baseline PNG 3,606,100 B → cropped 2,177,410 B; viewed both frames, bottom half only, in the lower half of the raster. |
| `MIXER 2-10 CROP 0 0.5 1 1 0 DEFER` + `MIXER 2 COMMIT` | image producer | **Applies.** Getter after COMMIT: `0.000000 0.500000 1.000000 1.000000`. |
| Immediate `MIXER 5-10 CROP 0.20833 0 0.79166 1 0` (the owner's exact numbers) | **route producer** (operator-GUI tile) | **Renders.** Viewed both PRINTs — tile visibly narrowed to the middle slice. |

All three restored to `0 0 1 1` and verified by getter. So neither the deferred path nor route
producers are the problem.

Source read confirms why: `image_transform::enable_geometry_modifiers` defaults to **false** (it
gates clip/crop/perspective — `core/frame/frame_transform.h:106`), but `core/producer/stage.cpp:178`
and `:190` set it to `true` on every layer's `foreground1`/`foreground2` before the transform is
pushed, and `routesCb` receives that same frame. `mixer_crop_command`
(`protocol/amcp/AMCPCommandsImpl.cpp:1377`) mutates only the four crop fields on the passed
transform, so mixing immediate and deferred commands on one layer is safe.

### 2.2 The take path emits the correct CROP line

Ran the **real** `buildTakeJobs` offline against the owner's saved scene (no sockets, no live
mutation; probe kept at `/tmp/.../scratchpad/probe-take-crop.js`):

- **Cold take** (nothing on air) → `MIXER 1-11 CROP 0.20833333333333334 0 0.7916666666666666 1 0 DEFER` ✔
- **Re-take with crop newly added** → layer 11 diffs on `["effects"]`, gets a job, same CROP line ✔
- **Re-take when live state ALREADY records the crop** → `jobs: 0`, **no CROP emitted** (all three
  layers skipped as visually-equal)

`layerVisuallyEqual` (`src/engine/scene-transition.js:89`) does compare `effects` via `jsonStable`,
and the phase-A batch orders per-layer `MIXER CLEAR` → LOADBG → mixer lines → `MIXER <ch> COMMIT`
(`scene-take-lbg-amcp-pipeline-batch.js`), i.e. the CLEAR cannot wipe the crop. `validateBatchLine`
passes `MIXER` lines. `coalescePerLayerClearStorm` needs ≥6 teardown lines and this look has 3.

## 3. Leading hypothesis

The third probe case is the only reachable way to get "no CROP on the wire": **live-scene-state
already records the crop while Caspar does not have it**, so the take skips the layer entirely.

Ways that divergence can arise, in order of suspicion:

1. **Caspar restarted (or the layer was re-staged) while the app's live snapshot survived.** The live
   map persists in `config/.highascg-state.json`; Caspar's mixer state resets to default on restart.
   Re-taking the same look then legitimately decides "nothing changed" and sends nothing — the crop
   is never re-asserted. Compare WO-176 (PRV look verify after restart), same shape of bug.
2. **WO-218 bank drift** — producer on one bank, MIXER state on the other. WO-218 is only
   `🟡 Implemented`, and its own smoke test still encodes the split-brain case.
3. A PGM live-edit (WO-272 nudge) applying the crop to Caspar but leaving live state stale, or the
   reverse.

## 4. One real defect found in passing (not yet the cause)

`buildNudgeLinesForLayer` (`src/api/routes-preview-nudge.js:60-81`) emits every line with `DEFER`
**except** the crop, because it delegates to `buildEffectAmcpLines`, which returns a bare
`MIXER <cl> CROP … 0`. The whole point of the nudge's `DEFER` + single `MIXER <ch> COMMIT` is that
the frame applies atomically; the crop therefore lands one frame early during a crop drag. Cosmetic
(a tear/jitter while dragging), not a loss — Caspar's `apply_transforms` builds each new destination
from `tween.dest()`, so the crop survives the subsequent COMMIT. Worth fixing when this WO is
closed.

## 5. To close this WO — the one capture needed

Not done here: 30.07 is a show day (the AskBio European Investigator Summit slide is live on PGM), so
PGM/PRV were deliberately left alone. When a channel can be spared:

1. Take the "layout" look.
2. Read back what Caspar actually holds:
   ```
   MIXER <pgmCh>-11 CROP        # bank A; try -111 for bank B
   INFO <pgmCh>                 # confirm which physical layer holds the route producer
   ```
   - Getter shows `0.208333 0 0.791667 1` → the crop **is** applied; the complaint is then about a
     *downstream* output (multiview / screen route) and folds into WO-190.
   - Getter shows `0 0 1 1` → confirms §3: the line was never sent. Capture the wire with
     `HIGHASCG_AMCP_TRACE=1` (or read `data/amcp-last50.txt` **immediately** — it is a 50-line ring
     and the ch5 operator-GUI FILL heartbeat overwrites it within ~2 minutes).
   - Getter shows the crop on the *other* bank's physical layer → WO-218 bank drift.

`data/amcp-last50.txt` being a 50-line ring that a 60 s heartbeat floods is itself the reason no
after-the-fact evidence existed for this report. Consider a larger/filtered ring.

## 6. Closure (06.08.26, owner "close all open WOs" sweep)

- The §5 capture is no longer obtainable: the active project has changed (6 plain looks, no
  crop effects anywhere, `liveScenesByProgramChannel` empty) and both Caspar and the service
  have restarted many times since 30.07 — nothing of the 30.07 mixer state survives.
- §3.1 (live snapshot survives a Caspar restart) is mitigated in the current tree:
  `live-scene-reconcile` clears persisted scene.live on INFO/content mismatch, so a restart
  produces a cold re-take that re-asserts all MIXER lines including CROP.
- §4 defect FIXED: `buildNudgeLinesForLayer` now defers the crop line like every other nudge
  line (`routes-preview-nudge.js`, via `deferMixerAmcpLine`); `smoke-preview-mixer-nudge` 9/9.
- No crop complaint has recurred since 30.07. If it resurfaces: run the §5 getter capture
  IMMEDIATELY (the amcp-last50 ring floods in ~2 min).
