# WO-331 — Live-input thumbnails re-fetch on every sources-panel render

**Source:** todos24.07.26 — "Live input seems to periodically refresh it's thumbnail."
**Status: DONE — implemented 2026-07-24 (commit ecd23c0: passive renders use liveThumbnailCacheBustWindow; force-refresh kept for explicit capture). Status line was stale ("OPEN") until the 2026-07-26 audit.**
in source). Small, well-bounded client fix.

## Verified current state (2026-07-24, source read)

Server side is sane and NOT the problem:
- Live thumbs cached with TTL 30 s (`live_thumbnail_ttl_ms`, `src/media/live-thumbnail-cache-store.js:14`,
  default in `src/config/defaults-core.js:106`), bus-activity invalidation debounced 600 ms
  (`live-thumbnail-cache-capture.js` ~33-48), DeckLink capture with 3 s→2 min backoff
  (`live-thumbnail-input-capture.js` ~22-26), proper Cache-Control headers
  (`live-thumbnail-cache-handlers.js` ~74-82).

Client side has TWO consumers with DIFFERENT cache-bust strategies:
- **Deck thumbnails (correct):** `client/components/scenes-editor-deck-thumb.js:100` uses
  `liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS)` (`client/lib/thumbnail-url.js:19-23`)
  — the bust value is quantized to the 30 s TTL window, so the URL is stable within a
  window and the browser cache holds.
- **Sources panel Live tab (the bug, confirmed):**
  `client/components/sources-panel-live-render.js:131` builds
  `getLiveThumbnailUrl(ch, Date.now())` — a FRESH bust value on EVERY render — and the
  panel re-renders on any state change (`sources-panel.js` ~314-326 subscribes to
  `decklinkInputsStatus` and a debounced `'*'`). Every OSC/status tick therefore mints a
  new URL → browser refetches → visible flicker/reload of the live tiles.
  Lines 185/232 of sources-panel-live-render.js do the same `Date.now()` bust in the
  refresh handlers.
- File-media thumbs don't flicker because they use a bust-free stable URL
  (`sources-panel-media.js:195`).

## Fix direction

1. In `sources-panel-live-render.js`, replace all three `Date.now()` busts with
   `liveThumbnailCacheBustWindow(LIVE_THUMBNAIL_TTL_MS)` (import from
   `../lib/thumbnail-url.js`), exactly like the deck thumb does.
2. Keep a true force-refresh escape hatch: the explicit per-tile refresh action (if one is
   user-triggered) may keep `Date.now()`, but passive re-renders must not.
3. Optional polish (same file): only swap `img.src` when the URL actually changed, so a
   re-render inside one TTL window is a no-op for the DOM.

## Acceptance
- With the sources panel open on the Live tab and the show idle: network tab shows at most
  ONE live-thumbnail fetch per input per 30 s window (plus bus-invalidation refreshes),
  instead of one per state tick. No visible tile flicker while OSC meters stream.
- Deck thumbnails and file-media thumbnails unchanged.
- Offline test: URL-stability check (two calls within one TTL window → identical URL;
  across windows → different) in tools/smoke/; `npm run test:ci` → 0 fail.
- Client-only: `npm run build:client` + kiosk reload to verify.

## Constraints
- Do not lengthen or shorten the server TTL/invalIdation behavior in this WO — the 600 ms
  bus-refresh debounce is deliberate (fresh thumb shortly after a take).
