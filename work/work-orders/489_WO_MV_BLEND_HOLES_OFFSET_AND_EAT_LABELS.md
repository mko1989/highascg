# WO-489 — Multiview editor blend holes sit 18 px low and eat the label strips

**Status: DONE (12.08, measured on the box before/after from a screen capture; smokes 99/99 + hole-rect 5/5, eslint 0 errors)**

Owner 12.08: *"the rects in multiview layout editor are all too low and overlap the labels of the
multiview windows. it seems the space to move them is making the gap. the moving should be done by
grabbing the labels."*

## 1. Investigation

### 1.1 The editor's drawn geometry is NOT the bug

First hypothesis (client/server geometry drift) was **disproved**. Fetched the live applied fills
from `/api/multiview/debug` and recomputed the client side by hand from the persisted cells
(`projects/sdgdfhjd.json`, canvas 1920×1080) for all five cells. They agree to 6 decimal places:

| cell | source | client `getContainedVideoRect` | server MIXER FILL |
|---|---|---|---|
| Program 1 | `route://1` 6144×1536 | vx 149.78 vy 74.0 vw 844.0 vh 211.0 | 0.078012 0.068519 0.439583 0.19537 → identical |
| Program 2 | `route://3` 1920×1080 | vx 1150.49 vy 39.0 vw 551.1 vh 310.0 | 0.599209 0.036111 0.287037 0.287037 → identical |
| Preview 1 | `route://2` 6144×1536 | vy 411.815 vh 172.72 | 0.381311 / 0.159923 → identical |
| DeckLink 3/4 | `route://6-3`, `route://7-4` | matches | matches |

`multiview-editor-canvas-layout.js` and `src/engine/multiview-layout-helper.js` are in sync. The
canvas-drawn frames and label bars are in the right place.

### 1.2 What is actually offset: the per-cell operator-GUI holes

The editor dock runs in operator-GUI BLEND mode — one shaped-window hole per cell, each routing that
cell's own source channel, with the canvas-drawn chrome (border / label strip) meant to stay
**outside** every hole. Holes are click-dead *and* paint-dead (see [WO-410 notes], operator-GUI
shaped-video pipeline WO-255/WO-263), so anything inside a hole is neither painted nor grabbable.

`client/components/multiview-editor.js` built each hole from the **cell box** inset by

```js
const MV_BLEND_INSETS = { top: 20, right: 6, bottom: 6, left: 6 }
```

Two consequences, both exactly what the owner reported:

1. **`top: 20`** reserved a 20 viewport-px grab strip at the top of every cell — that is the
   "space to move them". It pushed the live video down by 20 px minus the ~2 px border, i.e. the
   **+18 px gap** measured below.
2. **`bottom: 6`** is far less than the label strip's height (`labelSize·scale` ≈ 17–24 px), so the
   hole's bottom edge landed *inside* the label bar and punched most of it out.

The hole also came from the cell box, not the aspect-fitted picture rect, so the routed preview was
stretched across the whole cell instead of matching the 4:1 / 16:9 picture the real multiview shows.

### 1.3 Measurement (screen capture, native pixels)

Captured the operator GUI, mapped the dashed stage border (stage x 20–1347, y 25.5–771.5 in the crop
→ `scale` = 1327/1920 = 0.6911) and profiled each cell column, classifying editor background
`#131a22` vs content:

| cell | drawn video rect | drawn label bar | live content **before** |
|---|---|---|---|
| DeckLink 4 | 478.0–653.9 | 656.0–675.4 | **496**–676 |
| DeckLink 3 | 362.0–546.2 | 548.5–568.0 | **380**–569 |
| Program 1 | 76.6–222.5 | 224.5–241.1 | **95**–241 |
| Program 2 | 52.5–266.7 | 268.8–293.0 | **70**–293 |

A uniform **+18 px** offset on every cell — constant in *viewport* px, independent of cell size and
of `labelSize` (24/28/35 across these cells), which is the signature of a fixed viewport-px inset
rather than a stage-geometry error. `20 − 3·scale ≈ 18` ✓.

Colour probe through DeckLink 4's label band confirmed the second half: rows 650–669 were near-black
live video, and only rows **670–674** carried the label fill `#2563eb` — ~5 px of a ~19 px strip
survived; the rest was punched out.

## 2. What was done

`client/components/multiview-editor.js`:

- `MV_BLEND_INSETS` → `{ top: 6, right: 6, bottom: 6, left: 6 }`. The asymmetric top strip is gone;
  a symmetric inset is all the 3-canvas-px centred border stroke needs.
- `reportMvRect()` now derives each hole from `getContainedVideoRect(c, cm)` — the aspect-fitted
  picture rect the server MIXER FILLs that source into — instead of the raw cell box. Added
  `getContainedVideoRect` to the existing `multiview-editor-canvas.js` barrel import.

Because the label strip is drawn *below* the picture rect, deriving the hole from that rect keeps the
whole strip outside every hole by construction — it is painted and clickable again, which is what
makes the owner's requested "move by grabbing the label" work. The upper part of the strip is beyond
`getResizeHandle`'s 8 px edge tolerance, so it reads as *move*; the bottom edge stays `s`-resize.

Not changed: the drawn geometry (§1.1 — it was already correct), the BLEND/FULL-OUTPUT toggle, and
the mid-drag hole suppression.

## 3. What was VERIFIED

- **Live, on the box, before/after the same measurement** (`npm run build:client` + kiosk F5):

  | cell | gap above video: before → after | label strip painted: before → after |
  |---|---|---|
  | DeckLink 4 | 18 px → **4 px** | 5 of 19 px → **653–676, all of it** |
  | DeckLink 3 | 18 px → **4 px** | partial → **545–569, all of it** |
  | Program 1 | 18 px → **4 px** | partial → **221–241, all of it** |
  | Program 2 | 17.5 px → **4 px** | partial → **265–293, all of it** |

  Residual 4 px is the intended 6 px inset less the ~2 px border — video now sits inside its frame.
  Visual check: every cell reads its full label (`Program 1 (6144x1536 50p)`, `Preview 1 (…)`,
  `DeckLink 3/4`, incl. the 🔊 audio-active marker).
- `node --test tools/smoke/smoke-multiview-*.test.js tools/smoke/smoke-operator-gui-*.test.js
  tools/smoke/smoke-wo243-*.test.js` → **99 pass / 0 fail**.
- `node --test tools/smoke/smoke-hole-rect.test.js` → **5 pass / 0 fail**. That test asserts the
  *helper's* math against its own local constant and that the call site still imports/uses
  `holeRectFromOuter`; it does not pin the editor's inset values, so it is unaffected by design.
- `npx eslint client/components/multiview-editor.js` → 0 errors (2 pre-existing warnings on
  lines 105/111, untouched).

**Owner QA owed:** confirm dragging a cell by its label strip feels right in the shaped operator GUI
(the measurement proves the strip is painted and outside the hole; the drag ergonomics are a feel
call). Not pushed — push when ready so CI runs.
