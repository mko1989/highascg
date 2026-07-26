# WO-344 — better look-deck thumbnails for shader looks (crop the content, kill the alpha void)

**Source:** owner 2026-07-26 — "better thumbnail capture system for shaders as in most cases it
shows some borders and a lot of alpha empty space ... in the looks list in looks buttons."

**Status: OPEN.**

## Problem
Look-deck button thumbnails for shader/template layers capture the raw template snapshot: mostly
transparent canvas with a small rendered region → the deck button shows borders + empty space.

## Fix direction
1. Locate the look-thumb pipeline: `warmLookDeckThumbnails` (src/config/routing-setup.js:293
   area) + `src/media/cg-look-thumb-render.js` (headless-chrome template snapshot) and the deck
   painter `client/components/scenes-editor-deck-thumb.js`.
2. In the headless capture path: render the shader template at a real 16:9 viewport, WAIT for
   first non-empty frame (shaders animate from black — capture at t≈1s, and for audio-reactive
   shaders inject a synthetic audio texture so meters/bars show content), then
   **content-aware crop**: compute the alpha/luma bounding box of the rendered frame and crop to
   it (padded ~4%), falling back to full frame when coverage > 60%.
3. Composite per-layer thumbs with the layer's FILL rect over the look canvas (the deck thumb
   should approximate the LOOK, not the raw template) — check whether the deck painter already
   composites fills for media and merely lacks the template case.
4. Cache-bust only on shader save (shader-store export already has the hook).

## Acceptance
Shader looks in the deck show a filled, content-centered thumb (no dominant transparency); media
look thumbs unchanged; thumb refresh on shader re-save; no per-render cost on the deck paint path.
