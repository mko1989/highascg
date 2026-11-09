# WO-1005 — Previs: Pixel Strobe cells lit all the time in 15 Ch (a non-light channel counted as "driven")
**Area:** lighting, godot-client
**Status: DONE (09.11 — smoke 2/2 + fixture smokes 33/33, sweep of all 226 imported type×mode pairs, live API on Narvil: 840 → 0 lit cells at rest, programmer Dimmer lights the head)**

Owner, 09.11: "pixel strobe heads are lit all the time and dont react to the programmer."

## Investigation

- Narvil patches 12 × Pixel Strobe (type `0db39dd819da`) in mode **15 Ch**. In that mode every channel sits on the
  ForeGround, Background or Head geometry:
  - Dimmer, Shutter and RGBW on both ForeGround and Background;
  - Macro on ForeGround;
  - DimmerMode on Head.
- The rig: Yoke → Head → Beam → Pixelmap1 / Pixelmap2 → 70 GeometryReferences (Section A ×10, Section B ×60), each a
  Beam. ForeGround is a Beam under `Beam`, beside the pixel maps. Background is a plain Geometry.
- So each cell's scope (`gdtf-visual.js` `compileVisual`, its ancestors' channels) was only `Head_DimmerMode`.
- `decodeVisual` lit a beam when `b.scope.length` was non-zero. With no dimmer in scope it took `dim = 1` and white,
  so all 70 cells were at full whatever DMX said.
  - Live before: `GET /api/tracking/fixtures` showed 840 lit beams on the 12 heads with an empty programmer.
- In 12 Ch / 44Ch / 4Ch modes the cells are reached by Beam-level dimmer / colour channels and were already right.

## What was done

- `src/fixtures/gdtf-visual.js`: `compileVisual` marks a beam `lit` only if a light channel is in its scope. A light
  channel is a Dimmer, a Shutter, an additive emitter, a subtractive filter or a colour wheel.
- `decodeVisual` uses `lit` where it used `scope.length`.
- The rule that "a beam no channel reaches stays dark" (Pulse Panel 3CH, WO-784) now reads "no *light* channel".
- In 15 Ch, the ForeGround beam (lens + 120° cone) now carries the head's level and colour.
- The 70 cells stay dark in that mode. The GDTF gives no link from them to the ForeGround / Background masters. Use
  12 Ch, 44Ch or 244Ch for per-cell looks.

## What was verified

- New smoke `tools/smoke/smoke-wo1005-pixel-strobe-cells-dark.test.js` (curated list), 2/2:
  - a cell reached only by DimmerMode stays dark at any DMX;
  - ForeGround follows its dimmer and colour.
- With the WO-784, WO-615 visual / visualise / programmer and WO-700 smokes: 33/33.
- Sweep of every imported GDTF in `projects/_gdtf` (226 type × mode pairs), counting lit beams at all-0 and all-255
  DMX, old against new decoder: only Pixel Strobe 15 Ch changed (zero-lit 70 → 0, full-lit 71 → 1).
- Live, after a node restart:
  - 0 lit beams on the 12 strobes at rest;
  - `POST /api/fixtures/program` Dimmer 1 on one head gave `ForeGround {i:1, c:[1,1,1]}`;
  - that value was released again afterwards.
