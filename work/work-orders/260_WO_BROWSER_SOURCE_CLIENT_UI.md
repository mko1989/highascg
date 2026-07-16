# WO-260 — Browser source v2: client UI (add form, source rows, Interact button)

**Status:** OPEN
**Priority:** HIGH (completes WO-258 — backend/API fully wired at f63aeeb, zero client surface yet)
**Owner check:** A260.1

## What exists (read first)
Server (committed): `browser_display` extraLiveSources mode `{ url, width, height, fps }` through `src/config/host-live-sources.js` (candidate/normalize), `src/api/host-live-browser.js` (update/reload + interact/return handlers), routes `POST /api/host-live/browser` and `POST /api/host-live/browser/interact` (registered in router.js:233-234), creation via the generic `addExtraLiveSource` in `src/api/routes-device-view.js` (accepts `url`). Placement: the browser lives in the desktop dead zone (1920x648 on this box) — a too-large WxH FAILS with a clear reason (no silent resize).

## Tasks — mirror the existing `webpage_host` / `ndi_host` client branches exactly (grep those tokens per file)
- [x] T260.1 Add form: wherever webpage_host sources are created in the Device View / sources panel, add "Web Browser (system)" with url/width/height/fps fields (defaults 1152x648@25 — FITS this box's dead zone; hint text: "placed off-screen; max size = free desktop area (1920x648 on this box); Interact moves it to the operator monitor").
- [x] T260.2 Source rows: `client/lib/device-view-host-channels.js`, `client/components/sources-panel-live-render.js`, `client/lib/planned-channel-map.js` (+ any other webpage_host parallel branch a grep finds) get the `browser_display` counterpart (label "Browser", same routing affordances).
- [x] T260.3 Inspector: for a browser_display source — url/width/height/fps edit (POST /api/host-live/browser), plus "Interact on operator screen" ↔ "Return to background" toggle button (POST /api/host-live/browser/interact with { sourceId, mode: 'interact'|'return' } — READ the handler for the exact body shape, don't guess), with a status line showing the server's response (incl. the no-fit failure reason).
- [x] T260.4 Smoke (curated gate): grep-level branch-parity checks (every file with a webpage_host branch has a browser_display branch), plus pure-fn tests for any new payload builders.
- [ ] A260.1 (owner) add a browser source from the UI, see it on its host channel, Interact/Return round-trip.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm, no vite build (orchestrator runs it), curated gate ONLY. node --check + repo eslint --quiet; exact gate counts; <500 lines/file (split if a form file would exceed); honest checkboxes. READ the server handlers for exact API shapes — do not invent payloads.
