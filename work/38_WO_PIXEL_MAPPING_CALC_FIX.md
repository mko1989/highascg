# Work Order 38: Pixel Mapping Output Calculation Fix

## Goal
Fix the incorrect `MIXER FILL` coordinate calculation when a screen destination is routed through a **Pixel Mapping** node to a DeckLink output.

## Problem Description
When a large destination canvas (e.g., 3072x1024) is sliced across multiple 1080p outputs via a Pixel Mapping node, the `scene-native-fill.js` logic currently treats the mapping as a "standard scene" and applies "contain" scaling to fit the whole canvas into the output while maintaining aspect ratio.

This results in:
1.  **Incorrect Scale**: `scaleX` and `scaleY` are boosted or reduced to "fit" the output.
2.  **Incorrect Offset**: Centering logic (`ox`, `oy`) shifts the content away from the expected pixel-perfect alignment.
3.  **Inconsistent Height**: The `y` scale doesn't match the pixel ratio (e.g., `1024/1080`).

### Evidence (Logs)
**Expected for Out 2 (Decklink 7):**
`MIXER 7-1 FILL -1 0 1.6 0.9481481481481482 0 DEFER`

**Actual (Incorrect):**
`MIXER 7-1 FILL -1.0827118644067797 -0.02708124373119358 2.0827118644067797 1.0270812437311936`

## Root Cause
The function `mapProgramPixelRectToTargetOutput` in `src/engine/scene-native-fill.js` calculates a scale factor `k` and offsets `ox/oy` to center the "program" on the "output":

```javascript
const k = Math.min(ow / pw, oh / ph)
const ox = (ow - pw * k) / 2
const oy = (oh - ph * k) / 2
```

For Pixel Mapping, we need **Pixel Perfect** mode where `k = 1` (or rather, the scale is derived purely from the authoring resolution vs target resolution without aspect correction) and `ox = 0, oy = 0`.

## Proposed Fix
1.  **Context Detection**: Ensure the playout engine (specifically `runSceneTakeLbg` and its helpers) knows when it is rendering a slice for a Pixel Mapping node.
2.  **Toggle Aspect Correction**: Update `resolveSceneLayerFill` to accept a `pixelPerfect` flag.
3.  **Bypass Centering**: If `pixelPerfect` is true, set `k = 1` and `ox = 0, oy = 0` in the coordinate mapping.

## Tasks
- [ ] **T38.1** Audit `src/engine/scene-native-fill.js` to add `pixelPerfect` mode support.
- [ ] **T38.2** Verify that `getResolvedFillForSceneLayer` correctly identifies Pixel Mapping outputs via the `deviceGraph` or `tandemTopology`.
- [ ] **T38.3** Update `runSceneTakeLbg` to pass the `pixelPerfect` requirement when calculating layer fills for mapping nodes.
- [ ] **T38.4** Verify fix against the user's provided log values.

## Verification
- Monitor AMCP logs for `MIXER FILL` commands on DeckLink channels 6 and 7.
- Confirm Out 1 has `x=0, y=0, scaleX=1.6, scaleY=0.948...`.
- Confirm Out 2 has `x=-1, y=0, scaleX=1.6, scaleY=0.948...`.

---
*Work Order created: 2026-05-03 | Related: WO-18*
