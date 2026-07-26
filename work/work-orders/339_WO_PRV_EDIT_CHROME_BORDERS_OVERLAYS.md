# WO-339 — look editing on the real PRV channel with layer borders + editing overlays

**Source:** owner request 2026-07-26 — "implement editing looks on actual prv channel from caspar with layer borderers and overlays for editing."

**Status: surveyed 2026-07-26; core staging EXISTS, editing chrome to build.**

## What already exists (do not rebuild)

Editing a look already drives the real PRV Caspar channel end-to-end: `client/lib/scenes-preview-push-scene.js:75` (`pushSceneToPreviewImpl` — incremental per-layer PLAY/MIXER batch, DEFER + single COMMIT), 90 ms geometry nudge (`client/components/scenes-preview-runtime-mixer-nudge.js` → `POST /api/preview/mixer-nudge`), single-flight queue (`scenes-preview-runtime.js:93-115`), channel resolution `resolveLookStackChannelForBus(..., 'edit')` (`client/lib/look-stack-amcp-channel.js:35-52`), boot restage (`src/config/routing-setup.js:222`). Border/overlay rendering on a channel is also production-grade: PIP overlay stack (`pip_border`/`pip_shadow`/… templates, layers 260–979, `client/lib/pip-overlay-amcp.js`) and the global border (996/998, PRV mirror 997, multi-rect `slices[]`, `src/engine/global-border.js`).

## What to build

1. **Editing chrome layer(s):** a non-persisted decoration rendered ONLY while editing on PRV — per-layer selection border, layer index/name badge, optionally safe-area/thirds. Carve the band **980–995** (all other bands are allocated per `src/engine/look-layer-ranges.js`); one CG layer (e.g. 990) with a new multi-rect template is preferred over N layers.
2. **Template `template/edit_chrome.html`:** CG UPDATE-driven, JSON `{ rects: [{x,y,w,h,label,selected}], canvas: {w,h} }` — draw all layer outlines + labels in one pass (crib the multi-rect pattern from `global-border.js:56-66` slices and the CSS-var approach of `pip_border.html`).
3. **Client builder + splice:** `client/lib/scenes-preview-edit-chrome.js` building the CG ADD/UPDATE lines; splice into `pushSceneToPreviewImpl` beside the global-border block (`scenes-preview-push-scene.js:379-410`) before the COMMIT — same batch, zero extra round-trips. Fast path: extend the 90 ms nudge to CG UPDATE the chrome rect for the dragged layer.
4. **Lifecycle:** arm on `editingChange` (`client/lib/scene-state.js:352`), refresh on layer-select; tear down in `exitLookEditor` (`client/components/scenes-editor.js:59-119`) and `clearPreviewBusForMain`; boot sweep beside `restagePersistedPreviewLooks` so a crash never leaves chrome on a bus. Chrome must never enter the saved look (`buildIncomingScenePayload`) and must be stripped before any preview→PGM promotion.
5. **Make the video visible while dragging (the key UX blocker):** `client/lib/operator-gui-interaction-suppress.js:33` blanks ALL holes on pointerdown inside `.preview-panel__compose-cell` / `.preview-panel__canvas` — so today the operator sees the HTML canvas, not Caspar, exactly while editing. Exempt the looks-editor compose cell the same way `.operator-compose-tiles` is exempted (`:27-32`); the on-channel chrome then replaces the canvas chrome visually.
6. **Guard rails:** hard-gate on `editOnPgm !== true` (chrome must NEVER reach an on-air channel — reuse the `inspector-pip-overlay.js:50` pattern), and `isPreviewBusAvailable` (no chrome on PGM-only mains).
7. **Optional (owner to confirm):** a real PRV monitor output — `preview_screen_consumer` is declared (`src/config/defaults-caspar-server.js:53`) but read by NOTHING; wiring it into `config-generator-consumer-attach-screen.js` would give a physical preview screen.

## Acceptance

- Entering look edit shows the look live on the PRV channel with every layer outlined + labelled, selected layer highlighted; dragging tracks via the nudge (≤ ~100 ms).
- Chrome never appears on PGM (incl. edit-on-PGM sessions, take/cut promotion, restarts).
- Exiting the editor / taking the look leaves the PRV bus chrome-free; node restart sweeps stale chrome.
- Editing with the mouse keeps the hole open — the operator watches real Caspar video, not the canvas fallback.
- Smokes: new offline tests for the line builder + band allocation; existing preview/take smokes pass.

## Constraints

- Layer band 980–995 must be reserved in `look-layer-ranges.js` with a comment, not hard-coded at call sites.
- Respect the WALKTHROUGH rule: no client-emitted look-stack AMCP to PGM (`work/WALKTHROUGH_client-agent-pgm-look-take.md`).
- Client edits: `npm run build:client` + kiosk reload; keep files under 500 lines.
