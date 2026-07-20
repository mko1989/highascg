# WO-289 — Looks editor canvas needs a visible alpha-checkerboard background

**Source:** todos19.07.26 — "the canvas (background) in the looks editor is not visibly different
than the rest of the div. the bg in looks (empty) should be 'alpha checkerboard' with low
opacity."

## Problem
In the looks editor the compose canvas — the area representing the actual output raster — is
visually indistinguishable from the surrounding panel, so the operator cannot tell where the
frame begins and ends, nor which regions are empty/transparent.

## Scope
1. Style the compose canvas background in the looks editor as a low-opacity alpha checkerboard
   (the standard transparency pattern), so empty areas read as "nothing here" and the canvas
   bounds are obvious. Use a pure CSS pattern (`repeating-conic-gradient` or two `linear-gradient`
   layers) — no image asset, no external request (artifacts/kiosk are offline).
2. Keep it subtle: low opacity, must not compete with layer content or the selection/grab
   affordances added for border-grab resizing.
3. It must respect the existing theme tokens in `client/styles/` (dark UI) rather than hardcoding
   white/grey if tokens exist.
4. The canvas in question is the looks-editor compose surface
   (`client/components/scenes-compose*.js` + `client/styles/07a-scenes-compose-canvas.css`).
   Do NOT restyle the operator-GUI compose tiles — those are holes punched for live video and
   must stay fully transparent/empty (WO-263); a checkerboard there would be drawn over video.

## Acceptance
- Looks editor canvas is clearly delimited with a low-opacity checkerboard; layer content and
  resize bands remain fully legible.
- Operator-GUI tile holes unchanged (verify `smoke-wo256-operator-compose-tiles.test.js` and the
  shaped-overlay tests still pass).
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
