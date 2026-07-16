# WO-254 — Operator GUI route holes: aspect-ratio fit + rect re-report after restarts

**Status:** OPEN
**Priority:** HIGH (owner-reported, blocks daily use of the operator GUI)
**Owner check:** A254.1

## Owner reports (verbatim)
1. "the compose preview with live casparcg ... fits the layer to the size of the window this screen gets (pgm1 for instance) instead of keeping its aspect ratio and filling as much as it can while keeping the ratio."
2. "now the live caspar does not appear in the operator gui, after a restart."

## Root causes
1. `computeOperatorGuiCellPlan` (src/system/operator-gui-channel.js) emits `MIXER FILL` with the raw cell rect — CasparCG FILL stretches the routed channel to that rect, ignoring the source channel's aspect.
2. Route layers are only (re-)applied when the client POSTs cell rects, and the client only POSTs on ResizeObserver/layout changes (client/lib/cef-operator-mode.js). After a Caspar or highascg restart the server's route layers are gone but the CEF page's layout hasn't changed → no report → black holes until a window resize.

## Tasks

**T254.1 — aspect-fit route fills (server)**
In `computeOperatorGuiCellPlan`: for each cell, resolve the SOURCE channel's raster dims (the plan already resolves the source channel via `resolveCellSourceChannel`; dims via `getModeDimensions(screenModeString(...))` — mirror how `hostChannelVideoSize` does it in src/system/cef-interactive-forward.js:72-83, or reuse an existing helper). Compute the largest rect INSIDE the cell rect that preserves the source aspect (letterbox/pillarbox, centered), in the GUI channel's normalized coords — mind that cell rects are viewport fractions of the GUI channel raster, so aspect math must use ABSOLUTE pixels (cellRect × guiChannel dims) before normalizing back. Emit MIXER FILL with the fitted rect. Cells whose source dims can't resolve keep today's behavior. Pure function + unit-test the math (16:9 source in a 1:1 cell → pillarbox; 16:9 in 32:9 → letterbox; exact-fit unchanged).

**T254.2 — rect re-report (client + server nudge)**
- Client (`client/lib/cef-operator-mode.js`): re-POST the last-known rects (cache them) on (a) WS reconnect (hook the existing ws client reconnect event — see client/lib/ws-client usage patterns), (b) a new WS broadcast `operator-gui-rects-wanted`, (c) a 60s heartbeat while mode is active. All still hard-gated on cefOperator mode.
- Server: `ensureOperatorGuiCefLayer` (src/system/operator-gui-channel.js) broadcasts `operator-gui-rects-wanted` via `ctx._wsBroadcast?.('change', { path: 'operatorGuiRectsWanted', value: Date.now() })` after re-PLAYing the CEF layer (Caspar reconnect path) — mirror how other server→client nudges are broadcast; check what event shape cef-operator-mode can actually receive from the ws client and use that.

**T254.3 — smoke** (extend `tools/smoke/smoke-wo243-operator-gui.test.js`)
- Aspect-fit math unit tests (the 3 cases above + degenerate zero-size guard).
- Grep-level: ensureOperatorGuiCefLayer broadcasts the rects-wanted nudge; cef-operator-mode handles it + has the reconnect + heartbeat paths.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP to :4200/:5250, no vite build (orchestrator runs it), curated gate ONLY, never the full suite. node --check + repo eslint --quiet on touched files; exact gate counts; <500 lines/file; honest checkboxes. NOTE: src/system/operator-gui-channel.js was modified today (auto-arm + bridge self-heal) — read its CURRENT state first.

- [ ] T254.1 aspect-fit fills + unit tests
- [ ] T254.2 re-report on reconnect/nudge/heartbeat
- [ ] T254.3 smoke additions
- [ ] A254.1 (owner) restart → holes show live video with correct aspect, and reappear after Caspar restart without touching the window
