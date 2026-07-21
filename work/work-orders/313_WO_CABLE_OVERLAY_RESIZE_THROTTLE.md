# WO-313 — rAF-throttle the cable overlay resize handler (small)

**Status: OPEN** (flagged by the 2026-07-21 device-view audit; unmeasured, low confidence)

## Context
device-view-events.js:71 `window.onresize = () => renderCableOverlay(ctx.getCOCtx())` is
unthrottled, while the pointermove handler ~70 lines below is correctly rAF-gated. A live window
resize can re-run the Verlet rope simulation (device-view-cables-physics.js: 200 iterations x 6
substeps per cable, cache keyed on exact pixel coords so a resize invalidates every cable) dozens
of times per second. WO-278's benchmark covered steady-state renders (cache hits), not
resize invalidation — so this is plausible but NOT measured.

## Task
Mirror the pointermove pattern: one pending rAF, coalesce resize bursts. ~6 lines.

## Acceptance
- Resize-drag the window with 6+ cables: overlay redraws once per frame max (add a counter probe
  in dev console to verify), no visual change otherwise.
