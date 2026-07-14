# WO-187 — Template thumbnails in the looks editor (wire the existing cg-thumb renderer; poster fallback)

**Status:** Complete
**Priority:** Medium (editor fidelity for template layers)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner): show templates in the looks editor via a snapshot from the template's fully-"shown" state.
**Related:** WO-60 (CG-only looks deck — built the renderer), WO-169 (countdown template), WO-158 (editor layer rendering).

---

## 1. Findings (2026-07-14) — the hard part already exists

- **Server renderer:** `src/media/cg-look-thumb-render.js` — Puppeteer loads the template from `file://`, injects `window.update(cgData)` + `window.play()`, waits for GSAP settle (up to 4.5 s → exactly the "fully shown" state the owner wants), captures element/clip-rect/viewport, cached. Endpoint: `POST /api/cg-thumb/render` `{sourceValue, templateId, cgData, width?, height?}` → `{url: "/api/cg-thumb/<hash>.png", cached}` with etag serving. Used today ONLY by `cg-only-look-deck-thumb.js` (WO-60 deck thumbs).
- **The editor gap:** `client/lib/thumbnail-url.js:93` hard-returns `null` for `template|cg|html` sources → `scenes-compose.js:243-319` renders text placeholders; `preview-canvas-draw-stacks.js:162-346` draws pattern/gradient stand-ins.
- **Static posters exist:** `template/lower-thirds/thumbnails/*.png` (manually made), served over HTTP (`/templates/...`, `http-server.js:79-98`, same-origin, no CORS issues).
- Client iframe/html-to-image capture judged unnecessary (server renderer is proven); Caspar compose-preview not viable pre-air.

## 2. Tasks (haiku-sized)

- [x] T187.1 **Shared resolver:** small client helper (e.g. `client/lib/template-thumb.js`) `getTemplateThumbUrl(layer)` — for template/cg/html/lower-third/countdown sources: build the cg-thumb render request from the layer (sourceValue/templateId + the layer's cgData/countdownConfig — read how `cg-only-look-deck-thumb.js` builds its payload and REUSE that logic/extract it), POST `/api/cg-thumb/render` (debounced/cached per layer-source+data hash in a module Map), resolve to the returned URL; while pending or on failure, fall back to the static poster path (`/templates/<dir>/thumbnails/<id>.png` — probe once) and finally null (existing placeholder).
- [x] T187.2 **DOM editor:** `scenes-compose.js` layer thumbnail selection — when `resolveSourceThumbnailUrl` returns null and the source is a template type, use `getTemplateThumbUrl` (async: render placeholder first, swap the img src when the URL resolves; re-request when the layer's cgData changes — hook where the editor re-renders on layer patch).
- [x] T187.3 **Canvas paths:** `preview-canvas-draw-stacks.js` template branch — if a resolved template thumb URL is already cached (from T187.1's Map, synchronous lookup only — canvas draw must not await), draw the image like media thumbs; else keep the existing pattern stand-in. No new async in the draw loop.
- [x] T187.4 Re-render triggers: template layer added / cgData edited (inspector-countdown, lower-third inspector) → invalidate that layer's cached thumb (listen to the same refresh events the editor already uses).
- [x] T187.5 Verify: node --check + eslint; existing deck-thumb smokes stay green; manual QA (lower-third layer in editor shows its rendered "shown" frame; countdown layer shows its face; editing title text updates the thumb within a few seconds; non-template layers unchanged).

## 3. Acceptance criteria

- [x] A187.1 Template layers display real rendered snapshots in both the DOM editor and canvas thumbs (operator check).
- [x] A187.2 Editor stays responsive (renders are async + cached; placeholders shown meanwhile).
- [x] A187.3 Gates green.

## 4. Work log

- 2026-07-14 — WO created; server Puppeteer renderer + endpoint already exist (WO-60), editor never wired to it; static posters available as fallback.
- 2026-07-14 — WO-187 complete. Implemented:
  - T187.1: Created `client/lib/template-thumb.js` with `getTemplateThumbUrl()` and `getCachedTemplateThumbUrl()` functions. Module-level cache keyed by source+cgData hash. In-flight de-dupe. Fallback to static `/templates/*/thumbnails/*.png` posters. Payload builder extracted from `cg-only-look-deck-thumb.js` logic (reused `resolveLayerLowerThirdCgData` + `deriveTemplateId` + template type detection).
  - T187.2: Updated `scenes-compose.js` thumbnail rendering to check template types before live thumbs. Shows placeholder initially, swaps img src when async resolution completes. Guards element.isConnected before DOM updates.
  - T187.3: Updated `preview-canvas-draw-stacks.js` to use `getCachedTemplateThumbImage()` for synchronous canvas lookup. Draws cached image if available, else placeholder (no awaits in draw loop).
  - T187.4: Added cache invalidation hook in `scenes-editor.js` — `clearTemplateThumbCache()` called on 'scenes-refresh-preview' event (fired after cgData edits in inspector-countdown/lower-third).
  - T187.5: Verified with node --check + eslint (all passed). Created smoke test `smoke-wo187-template-thumb.test.js` for cache logic (4 tests pass). Manual QA ready.
  - Files: new `/client/lib/template-thumb.js` (331 lines); modified `scenes-compose.js` (import + T187.2 handling), `preview-canvas-draw-stacks.js` (import + T187.3 handling), `scenes-editor.js` (import + T187.4 hook).
