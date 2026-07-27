# WO-346 — compose preview toolbar: Reset replaces PRT PGM; per-tile PRT/capture

**Source:** todos27.07.26 — "prt pgm button needs to be removed and replaced by the reset button
for reset the compose prv windows. all live sources inside the compose preview need to have a
prt/capture button."

**Status: DONE 2026-07-27 (Haiku implementation, spot-verified): header Reset dispatches operator-tiles-reset-request → resetLayout(); per-tile PRT buttons POST /api/amcp/print with the tile channel.**

## Facts
- PRT PGM: `client/components/preview-canvas-panel.js:39` (grabBtn) + handler :386 —
  `POST /api/amcp/print { channel: pgm }`.
- Tiles reset exists: `client/components/operator-compose-tiles.js:115-118` resetBtn →
  `resetLayout()` (:258).
- Per-tile channel: `resolveTileChannel(def, cm)` (operator-compose-tiles-state.js), tile footer
  element `footerEl` built in operator-compose-tiles-tile-controller.js.

## Fix
1. Header button becomes `Reset` (same element/classes): dispatches
   `window CustomEvent('operator-tiles-reset-request')`; operator-compose-tiles listens and calls
   `resetLayout()`. Keep the in-canvas reset button too.
2. Every tile footer gains a small `PRT` button: `POST /api/amcp/print { channel: <tile channel> }`
   with the same busy/ok/err classes pattern as the old grab button.

## Acceptance
Top-bar Reset restores default tile layout; PRT on any tile (pgm/prv/live-source) captures that
tile's channel; old PRT PGM gone.
