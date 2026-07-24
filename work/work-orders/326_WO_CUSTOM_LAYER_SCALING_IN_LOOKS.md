# WO-326 — Custom scaling of layers in looks

**Source:** todos24.07.26 — "No custom scaling of layers in looks."
**Status: OPEN.** Written 2026-07-24 from a read-only code survey. The one-line todo is
ambiguous — the FIRST task at pickup is a 10-minute live check with the owner (below).

## Verified current state (2026-07-24, source read)

- Look layer model (`client/lib/scene-state-helpers.js` ~67-99, `defaultLayerConfig()`):
  `fill { x, y, scaleX, scaleY }` (normalized 0-1), `rotation`, `contentFit`
  ('native' | 'fill-canvas' | 'horizontal' | 'vertical' | 'stretch'), `aspectLocked`,
  `opacity`. There is NO independent scale/zoom field — scale IS the fill geometry.
- Looks editor inspector DOES expose geometry: `client/components/inspector-scene-layer.js`
  imports `appendSceneLayerFillGroup` from `inspector-fill.js`; X/Y/W/H pixel inputs,
  alignment presets, aspect lock, content-fit dropdown all exist and patch `layer.fill`
  via `pixelRectToFill` (inspector-scene-layer.js ~129-182).
- Server side: `src/engine/scene-take-lbg-jobs.js` (~164, ~249-253) resolves the fill
  (`getResolvedFillForSceneLayer` in `src/engine/scene-native-fill.js` ~288-370 — accounts
  for media resolution + contentFit + rotation anchor) and emits
  `MIXER <ch>-<layer> FILL x y sx sy` (`src/caspar/amcp-mixer.js` ~162-169).

So "scaling by resizing the layer rect" nominally exists end-to-end. What does NOT exist:
- An independent content zoom/scale factor inside the layer rect (no pan-scan/crop-zoom —
  you cannot say "1.5× the content, keep the rect"; CLIP/CROP mixer commands are unused
  for look layers).
- A scale-anchor / scale-from-center control (only rotation has an anchor).

## Verify at pickup (with the owner, ~10 min)

Reproduce what the owner means on the box: open a look, select a media layer, change W/H
in the inspector, take it. Three possible outcomes decide the scope:
1. **Geometry edits don't stick / don't reach air for look layers** → this is a BUG in the
   fill patch → take path; fix that, done.
2. **Geometry works but the owner wants content zoom inside the rect** (crop/pan-scan) →
   implement Part B below.
3. **Owner wants a plain scale % control instead of pixel W/H** → thin UI sugar over the
   existing fill (Part A).

## Fix direction

Part A (UI sugar, cheap): add a "Scale %" control to the look layer inspector that
multiplies the current rect around its center (aspect-locked), writing through the existing
`pixelRectToFill` path. No engine change, no new model field.

Part B (content zoom, real feature): new optional layer field `contentZoom` (default 1)
+ optional `contentAnchor`. Resolve it in `getResolvedFillForSceneLayer` by scaling the
content rect inside the layer rect and clipping overflow with `MIXER CLIP` (or CROP on
Caspar 2.6+) so the layer rect stays authoritative for composition. Must ride the same
A/B bank take path and mixer-line batch as FILL (scene-take-lbg-jobs.js) so it crossfades,
not pops. Live preview (looks editor canvas) must show the zoom too — check the canvas
painter reads the same resolved fill.

## Acceptance
- Whatever scope option 1-3 turns out to be: a layer scaled in the looks editor previews
  identically on the editor canvas, the compose preview, and PGM after a take.
- Take/crossfade between two looks where the same layer has different scale animates
  smoothly (no snap, no full-frame flash).
- `contentFit` modes and `aspectLocked` still behave exactly as today for untouched layers.
- Offline tests: fill math round-trip (scale% ↔ rect, zoom+clip resolution table) in
  tools/smoke/; `npm run test:ci` → 0 fail; client rebuilt (`npm run build:client`) +
  kiosk reload for any inspector change.

## Constraints
- Do not add a second source of truth for geometry — everything must reduce to the
  existing `fill` (+ optional `contentZoom`) so saved projects stay loadable both ways.
- Old projects without the new field must render pixel-identical to today.
