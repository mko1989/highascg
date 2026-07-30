# WO-388 — Crop counts into the layer's effective size (align/adjust)

**Status: DONE (2026-07-30, offline suite 1719/0 + 7 new targeted tests; owner QA pending on the box)**
**Source:** owner 30.07.26 — "i need the crop to be included in the size of the layer, meaning when
its cropped the layer width and/or height is cropped too, so for instance when i want the layer to
be adjusted to left, it adjusts including the crop."

**Supersedes [WO-238](./238_WO_ADJUST_FILL_IGNORES_CROP.md)** — which read the same owner request
INVERTED and closed it "code correct, no fix required". See §1.

## 1. Investigation

### 1.1 WO-238 got the requirement backwards

todos15.07.26:39 said *"sdjust to doesnt count the crop values in."* WO-238 interpreted that as
"the adjust action must **not** factor crop in", verified the code already did that, and closed as
`Verified — Code Correct`. It even flagged the risk itself: *"(OWNER: correct this WO if the
interpretation is wrong)"*.

The owner's 30.07 message settles it: the complaint was that adjust **fails to count** the crop —
"doesn't count X in" = "X is missing", not "X must be excluded". So WO-238 verified and enshrined
exactly the wrong behavior, and `test/wo-238-adjust-fill-ignores-crop.test.js` locked it in.

Note what that test actually asserts: its "with crop" and "without crop" cases call
`sceneLayerPixelRectForContentFit` with *identical arguments* and then assert the results are equal.
It cannot fail, and it never exercised an align path. It is left in place (content-fit genuinely
does read the uncropped source resolution — that part is correct and unchanged), but it is no
longer evidence about align.

### 1.2 What the align buttons actually did

`patchFillAlign` (client/components/inspector-scene-layer.js:163 pre-change) aligned the layer's
**full, uncropped** fill rect:

```js
if (mode === 'left') nx = 0
else if (mode === 'right') nx = 1 - sx      // sx = the UNCROPPED scaleX
```

A `MIXER CROP` cuts into the layer's fill rect and leaves the rect itself alone (that is the
documented Caspar semantic — client/lib/layer-crop.js header). So for a layer cropped
`left=0.208 right=0.792`, "align left" put the *invisible* left edge at x=0 and the visible content
started 20.8% of the layer width inwards — a gap exactly the width of the cropped-away strip. Same
for right/top/bottom/centre.

The visible rect was already computed elsewhere for this exact reason —
`cropAdjustedFill` / `cropAdjustedFillForLayer` (WO-158 T158.5) is what PIP borders use so they hug
the cropped content. Align simply never consulted it.

### 1.3 Owner's live look (the repro)

`config/.highascg-state.json` → `web_project.scenes.scenes[6]` ("layout"), layer 11,
`source: route://6-1`:

```json
{ "type": "crop", "params": { "left": 0.20833333333333334, "top": 0, "right": 0.7916666666666666, "bottom": 1 } }
```

fill `x: -0.0848, y: 0.2640, scaleX/Y: 0.47196`. 400 px cropped off each side of a 1920-wide layer.
Aligning that left moved the layer to x=0, leaving a 0.208 × 0.472 = **9.8% of canvas width** gap.

## 2. What was done

One shared helper, mirrored ESM/CJS exactly like the rest of the crop math (the parity rule
`smoke-layer-crop.test.js` enforces):

- **client/lib/layer-crop.js** — new `alignFillForCrop(fill, crop, mode)` + `alignFillForLayer(fill, layer, mode)`.
- **src/engine/layer-crop.js** — CJS mirror of both.

The math: the visible rect in fill space has origin `f.x + left*scaleX` and extent
`(right-left)*scaleX`. Align **that** rect to the canvas edge/centre, then subtract the same
`left*scaleX` offset to get back the layer origin `MIXER FILL` needs.

Chosen over the alternatives because:
- *Shrinking `scaleX` to the visible width* would change what Caspar renders (the crop already
  does the cutting; scaling again would double-apply it).
- *Special-casing each align mode at the call site* would drift from the CJS mirror and from the
  PIP-border crop math that already exists.

Identity / absent crop reduces algebraically to the old expression (`left=0, right=1` → offset 0,
extent `scaleX`), so **uncropped layers are bit-identical** — guarded by a test that diffs against
the pre-change formula as an oracle.

- **client/components/inspector-scene-layer.js** — `patchFillAlign` now calls `alignFillForLayer`.

### 2.1 Deliberately NOT changed

- **`contentFit` (Native / Fit canvas / Fill width / Fill height / Stretch)** still computes from
  the uncropped *source* resolution. Those modes answer "how does the media map into the layer",
  which is upstream of the crop; WO-238's finding is correct for them.
- **The compose editor's selection rect / resize handles** still use the full uncropped rect — the
  crop-drag handles (`smoke-scenes-compose-crop-drag.test.js`) need the uncropped box to drag the
  crop edges against. Making that box visible-only would break crop editing.
- ~~**The inspector W/H number inputs**~~ — **owner said yes (30.07), done as §2.2b below.**
- **The timeline-clip align path** (`inspector-panel-timeline-clip.js` → `alignStoredPxRect`) is
  untouched: timeline clips expose no crop effect in that inspector.

### 2.2b WO-388B — the X/Y/W/H boxes now report and accept VISIBLE geometry

Owner answered §5 with **yes, show cropped W/H**. Implemented as the pixel-space inverse of the same
rule:

- **client/lib/layer-crop.js** (+ CJS mirror) — `layerRectFromVisibleRect(visible, crop)`, the exact
  inverse of `cropAdjustedRect`, plus `visibleRectForLayer` / `layerRectFromVisibleRectForLayer`
  conveniences. A collapsed crop (zero visible extent) is floored at `1e-6` instead of dividing by
  zero — a degenerate crop must not put `NaN` geometry on air.
- **client/components/inspector-scene-layer.js** — `pxRect` (what the boxes display) is now the
  visible rect; `patchFillPx` patches in visible space and inverts before writing `fill`.
  Consequence, and the reason it is done in this order: **aspect lock now locks the ratio the
  operator can see**, not the uncropped ratio.
- **client/components/inspector-fill.js** — `syncGeometryInputsFromLayer` and `applyScale` given the
  same treatment. Both had their own `fillToPixelRect` call; leaving either would make the boxes
  disagree with themselves after a content-fit reapply or a scale-%.

`reapplyLayerFrameForContentFit` deliberately still writes the **layer** rect from
`sceneLayerPixelRectForContentFit` — content fit sets the layer frame; the boxes then re-derive the
visible rect from it.

## 3. What was VERIFIED

- **New:** `tools/smoke/smoke-wo388-crop-aware-align.test.js` — 7 tests, all pass. Registered in the
  curated list `tools/ci/run-offline-tests.js`. Covers:
  - uncropped layers reproduce the legacy formula exactly (3 fills × 5 no-crop layer shapes × 7 modes),
  - left/right seat the **visible** edge at 0 / 1 using the owner's real crop numbers,
  - top/bottom/centre-v for a vertical crop,
  - `center` on both axes,
  - scale is never mutated,
  - junk/inverted crop params stay finite,
  - ESM ↔ CJS parity across all 7 modes.
- **Full offline gate:** `node tools/ci/run-offline-tests.js` → **1721 tests, 1719 pass, 0 fail,
  2 skipped** (the 2 skips are the pre-existing `CI=1` server-spawn tests).
- **Client build:** `npm run build:client` clean (only the pre-existing chunk-size / dynamic-import
  warnings).
- **WO-388B adds 5 more tests** (12 total in the file): visible→layer round-trip across 3 rects × 4
  crops, uncropped identity in both directions, the owner's real crop (typing 350 into a 700-wide
  visible box halves the layer to 600 and re-derives to exactly 350 with the visible x preserved —
  i.e. the content does not jump), collapsed-crop finiteness, and ESM/CJS parity of the inverse.
- **Re-run after WO-388B:** full gate **1726 tests, 1724 pass, 0 fail, 2 skip**; 500-line gate 0
  files over; `npm run build:client` clean.
- **Deployed on the box:** owner approved the reload — `DISPLAY=:0 xdotool key F5` sent via XTEST to
  the focused kiosk window (`HIGHASCG-OPERATOR-GUI`, id 23068717); served bundle hash confirmed equal
  to the built one (`main-7oR1ucRA.js`) and the kiosk window verified still present afterwards.
- **Owner QA still owed** (behaviour, not wiring): add a crop to a look layer, check the W/H boxes
  read the cropped size, hit align-left and confirm the visible edge lands on the canvas edge.

## 4. Unrelated pre-existing failure found while running the suite

`tools/smoke/smoke-mixer-effects-catalog.test.js` fails on the `rotation` effect:
`POST /api/mixer/effect` sends `MIXER 2-15 ROTATION 45` where the line builder produces
`MIXER 2-15 ANCHOR 0.5 0.5` first. Not in the curated CI list, so CI is green. Untouched by this WO
(no rotation code changed) — but it suggests **rotation via `/api/mixer/effect` rotates about the
corner instead of the centre**, because the ANCHOR pivot line is dropped. Worth its own WO.

## 5. Answered

*Should the W/H boxes report the cropped size?* — **Owner: yes (30.07).** Implemented as §2.2b
(WO-388B). Note the knock-on recorded there: aspect lock now locks the **visible** ratio.
