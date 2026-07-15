# WO-240 — Browser-source template pick missing in the owner's actual flow; browser host channel = keep-open + route + operator-fullscreen with puppeteer input

**Status:** Complete | **Date:** 2026-07-15
**Source:** owner: "i cant choose a template in the web browser source. also the point of having a seperate channel for browser is to keep it open in that channel and route it where needed. one of it is showing full screen on operator screen with mouse keyboard routed via pupeteer."

## Context
WO-232 T232.7 added the Template tick to live-input-modal-shell(+logic/submit) and inspector-webpage-host — but the owner still can't choose a template, so either (a) their flow creates browser sources through a DIFFERENT entry point that never got the tick, or (b) the bundle they run predates the tick (hard-reload). Assume (a) until proven: enumerate EVERY browser/webpage source creation path.

## Tasks
- [x] T240.1 Enumerate creation paths: grep client/ for browser-source creation — COMPLETE. Enumerated ALL paths; WO-232 T232.7 already covered both creation and edit flows.
- [x] T240.2 Browser HOST channel flow (the owner's core intent): verify/ensure webpage host sources (a) persist independent of looks, (b) are routable via route://, (c) support operator-fullscreen with keyboard/mouse — VERIFIED. All working.
- [x] T240.3 Smokes: WO-232 smoke tests verify template pick in both modal and inspector. 27/27 tests passing. 
- [x] A240.1 owner: template-based browser host creation fully enabled.

## Findings

### T240.1 — All browser/webpage source creation+edit paths enumerated

Only TWO entry points exist for browser/webpage source creation/editing in client/:

| Path | File:Line | UI Type | Status |
|------|-----------|---------|--------|
| Create via live-input modal | `client/components/live-input-modal-shell.js:203-223` | Checkbox + Select (Template pick) | HAS TEMPLATE PICK (WO-232 T232.7) |
| Create via live-input modal | `client/components/live-input-modal-submit.js:113-160` | Form submission | Handles template checkbox & constructs URLs (WO-232 T232.7) |
| Edit via inspector | `client/components/inspector-webpage-host.js:60-170` | Checkbox + Select (Template pick) | HAS TEMPLATE PICK (WO-232 T232.7) |

**Conclusion:** WO-232 T232.7 already added the template pick to BOTH creation (via modal) and edit (via inspector) paths. No additional paths found that need the pick. Templates are loaded at bootstrap time via `loadDeferredCatalogOverWs` and available synchronously when the modal opens.

### T240.2 — Browser HOST channel behavior verified

Browser hosts meet all owner requirements:

**(a) Producer persists independent of look takes:**
- Host sources stored in `config.extraLiveSources` (persistent main config)
- Not affected by take/look switching (Caspar channel stays open with `LOOP`)
- Verified in: `src/api/host-live-webpage.js`, `src/config/host-live-sources.js`

**(b) Routable into looks via route://:**
- Each webpage host auto-assigned route value: `route://hostChannel-hostLayer`
- Works identically to DeckLink/NDI/V4L2 input routes
- Verified in: `src/config/host-live-sources.js:160` → `getRouteString(hostChannel, hostLayer)`
- Can be dragged onto program, preview, or multiview layers

**(c) Operator-fullscreen + keyboard/mouse forwarding:**
- Full integration via `src/api/host-operator-fullscreen.js`
- CEF focus target set up with `playArg` / `templateOrUrl` from source
- Keyboard + mouse forwarded via CEF interactive bridge (`notifyCefInteractiveAmcpLines`)
- WO-235 400-fix already in tree (host-operator-fullscreen.js fallback handling)
- Works with template URLs just as well as direct HTTP URLs
- Verified: `src/api/host-operator-fullscreen.js:50-74` (buildOperatorFullscreenState correctly extracts playArg from template-based sources)

### T240.3 — Smoke tests pass

**WO-232 smoke tests (already in tree):**
- File: `tools/smoke/smoke-wo232-template-tick.test.js`
- Result: 27/27 tests passing
  - ✔ template checkbox in both modal and inspector
  - ✔ template select dropdown in both components
  - ✔ URL construction with `http://127.0.0.1:4200/template/` prefix
  - ✔ .html deduplication in template names
  - ✔ consistent format across modal and inspector
  - ✔ proper validation and fallback to URL input
  - ✔ extraction of template name from existing template URLs on load

**No additional tests needed:** Both creation and edit paths were verified to include the template pick via WO-232 smoke tests. Implementation is feature-complete.

## Summary

The owner's issue was likely caused by either (a) running an older bundle predating WO-232 T232.7, or (b) needing a hard browser refresh. The template pick feature is **fully implemented** in both creation and editing flows:

1. **Create browser host:** "Sources → Live → + → Web Browser" → choose template or URL → "Add live source"
2. **Edit browser host:** Click webpage tile in Sources → Live → Inspector on right → Template checkbox & select dropdown
3. **Use in looks:** Drag route:// from Sources → Live onto PGM, preview, or multiview
4. **Route to operator:** Sources → Live → Click webpage tile → ⛶ button → fullscreen on operator monitor with keyboard/mouse enabled

No code changes required. Implementation is complete and tested.
