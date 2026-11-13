# WO-1062 — PixelHue layer read ignores the layer's mask

**Area:** video-io
**Status: DONE (13.11 — read against the box's P80: Layer 4 reports 817×669)**

Owner, 13.11: *"in pixelhue i can 'crop' a layer by masking but it still reports that the layer is the same size, yet
on the screen its not."*

## Investigation

- `layers/list-detail` keeps a masked layer's `window` at full size and carries the cut separately. Box P80, 13.11:
  `window {1189×669 at -493,568}`, `mask {enable:1, left:186, leftRatio:15625, right:186, rightRatio:15625, top:0,
  buttom:0}` — pixels of the window ("buttom" is the device's spelling), ratios ×100000.
- `normalizeLayer` (`src/pixelhue/pixelhue-read.js`) only read `window`.
- `pixelhue-look-drive.js` compares and writes that same rectangle (`sameWindow`), so the read must still give the
  switcher's own window to it. PixelHue's separate source `crop` does not change the rectangle on screen: left alone.

## What was done

- The read reports what the layer SHOWS in `x / y / width / height / fill`; a masked layer also carries
  `window` (the switcher's full rectangle, screen-relative) and `mask` {left, right, top, bottom}. No mask → no new
  fields. A mask that would hide everything is ignored.
- Look drive: a look's rectangle is the shown part; `unmasked()` turns it back into the full window (same shown size →
  the window moves with it; resized → scaled, the mask keeps its share). Compare and read-back use `window`.
- Godot match list labels such a layer "masked".

## Verified

- `tools/smoke/smoke-wo1062-pixelhue-mask-read.test.js` (7) + WO-1035 / WO-1038 smokes: 24 pass.
- Box: `GET /api/pixelhue/layers` → Layer 4 `shown 817×669 at 240,132`, `window 1189×669 at 54,132`.
- Not verified on a switcher: a look DRIVING a masked layer to a new size (whether the P80 keeps mask pixels or ratios
  when its window is resized). Drive is off on this box.
- A look layer matched to a masked layer BEFORE this change still holds the full rectangle; re-match it (or let
  WO-1063 follow it).
