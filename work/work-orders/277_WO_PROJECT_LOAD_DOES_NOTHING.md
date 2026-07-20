# WO-277 — Loading a project doesn't actually load anything

**Source:** todos19.07.26 — "loading a project doesnt realy load anything."

## Problem
Selecting/loading a project appears to succeed but the running system does not adopt it. What
"loading" must mean is the open question this WO has to answer first: which state is expected to
change (looks/scenes, media library, screen destinations, device graph, timers, streaming
credentials, Caspar config?) and which of those actually change today.

## Investigate first
1. Map the project model end to end: what a project owns on disk (`projects/` layout, the project
   envelope loaded by `src/engine/project-scenes-load.js` and friends), the API that switches the
   active project, and every consumer that caches project-derived state.
2. Trace one load from the UI click to the server and back. Record what is re-read, what is
   broadcast over the WebSocket, and what keeps serving stale data because it cached at boot.
3. Distinguish these failure shapes and say which is real:
   - the switch never persists (active-project pointer not written),
   - it persists but nothing re-reads it until a restart,
   - it re-reads server-side but the client never re-renders,
   - it loads scenes but not the surrounding config (destinations, graph, media roots).
4. Check whether the recently added boot-time work (`restagePersistedPreviewLooks`,
   `warmLookDeckThumbnails` in `src/config/routing-setup.js`) should also run on a project switch —
   a newly loaded project's PRV/thumbs would otherwise stay on the previous project's content.

## Requirements
- Loading a project must leave the running system in the same state a restart with that project
  selected would produce, without requiring a restart.
- Anything that genuinely cannot be hot-swapped (e.g. a Caspar channel layout change needing a
  Caspar restart) must be reported to the operator explicitly rather than silently ignored.
- The load must be atomic from the operator's point of view: no half-loaded state where scenes
  come from project B while destinations still come from project A.

## Acceptance
- A written root cause naming exactly what did not reload, with file:line evidence.
- Loading a project updates the live state; state that requires a restart is surfaced in the UI.
- Offline smoke test covering the reload path (pure logic / stubbed ctx — no live Caspar).
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.

## Constraints
- Do NOT restart the highascg service, do NOT run `npm run build:client` (the main session does).
- Do NOT switch the active project on this live box as a test — exercise the code paths offline.
