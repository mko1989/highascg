# WO-392 — Live-input thumbnails: kill the periodic (TTL-window) refresh

**Status: DONE (2026-07-30 — offline suite 1734/0/2 + live box probes below; owner visual QA: watch a live tile for >30 s, it must not blink)**
**Source:** `work/work-orders/todos30.07.26` §"i can see the gui is refreshing thumbnails of live inputs periodicaly which shouldnt happen really."
**Related:** WO-331 (fixed per-render `Date.now()` busting — its diagnosis stands; this WO removes the *remaining, intentional* 30 s refresh it kept), WO-110 (bus-activity invalidation), WO-309/319 (input-capture backoff).

---

## 1. Investigation (2026-07-30)

The owner-visible periodic refresh is **by design**, end to end:

- Client mints a new URL once per 30 s TTL window:
  - `client/components/sources-panel-live-render.js:133` — `getLiveThumbnailUrl(ch, liveThumbnailCacheBustWindow())`
  - `client/components/scenes-editor-deck-thumb.js:100` — same window bust for deck canvases, **plus** `armLiveInputRefresh()` (:138-150) arms a timer that invalidates the canvas image cache and repaints exactly at every window rollover.
- Server, on a GET for a dedicated input channel with meta older than TTL, **runs a real Caspar PRINT**:
  `src/media/live-thumbnail-cache-handlers.js:48-63` → `ensureInputLiveThumbnail` →
  `decideInputThumbnailCapture` (`src/media/live-thumbnail-input-capture.js:76-83`) returns
  `{ attempt: true, reason: 'stale_cache' }` when `hasCache && stale`.

Net effect while any live-input thumb is on screen: a PRINT on the input channel + a full image
refetch + a visible tile change **every 30 s**. WO-331 only removed the *per-render* churn.

Ruled out: `scenes-compose-layer-thumb.js:138` `Date.now()` bust (triage suspect) — it is inside
the explicit ↻-click handler, a deliberate refresh; not periodic.

Load-bearing constraints found:
- Bus-activity invalidation (`scheduleLiveThumbnailRefresh`, WO-110) **deletes** the cached PNG
  (`invalidateLiveThumbnailCache`, live-thumbnail-cache-store.js:77-89). So a "capture only when
  no cache exists" gate still recaptures after bus activity — event-driven refresh survives.
- Client canvas cache invalidation is substring-based (`preview-canvas-draw-base.js:380-388`), so
  un-busted stable URLs are invalidated *more* reliably by the existing explicit-refresh paths.
- The fresh-path response header was `max-age=86400` — with stable (un-busted) URLs that would
  pin a day-old image in the browser cache; the serve path must move to `no-cache` + ETag/304.
- Smoke guards pin the old mechanism: `smoke-wo331-live-thumb-url-stability.test.js` (source-text
  regex on the TTL-window bust) and `smoke-decklink-input-look-thumb.test.js`
  (`decideInputThumbnailCapture` stale semantics + `liveThumbnailCacheBustWindow` unit tests) —
  repointed, not weakened (they now pin the *absence* of periodic refresh).
- `check-unwired-exports` is a shrink-only CI gate → `liveThumbnailCacheBustWindow` and
  `LIVE_THUMBNAIL_TTL_MS` must be **deleted**, not left exported-and-unused.

## 2. What was done

Target behavior: a live-input thumbnail is captured **once** (lazily, when no cached PNG exists),
then only changes on explicit ↻/capture/upload or bus-activity invalidation. No time-driven
PRINT, no time-driven refetch, no 30 s tile blink.

- `src/media/live-thumbnail-input-capture.js` — `decideInputThumbnailCapture`: any existing cache
  now refuses capture (`reason: 'has_cache'`); the `stale` input is gone. `ensureInputLiveThumbnail`
  no longer takes/forwards `stale`.
- `src/media/live-thumbnail-cache-handlers.js` — GET no longer computes staleness; serve path
  answers `If-None-Match` with 304 and sends `Cache-Control: private, no-cache` + ETag (stable
  URLs revalidate cheaply and pick up recaptures immediately); `X-Live-Thumb-Stale` removed.
- `client/lib/thumbnail-url.js` — `liveThumbnailCacheBustWindow` + `LIVE_THUMBNAIL_TTL_MS` deleted.
- `client/components/sources-panel-live-render.js` — passive render uses the stable un-busted URL.
- `client/components/scenes-editor-deck-thumb.js` — window bust, `armLiveInputRefresh` timer and
  its state deleted; deck canvases paint the cached image until an explicit refresh invalidates it.
- Tests repointed: `smoke-wo331-live-thumb-url-stability.test.js` now guards "no periodic bust
  anywhere in the live-thumb client paths" (still guards explicit `Date.now()` refreshes);
  `smoke-decklink-input-look-thumb.test.js` decide-cases updated (`has_cache` never captures).

## 3. What was VERIFIED

Offline (2026-07-30): full suite **1736 tests, 1734 pass / 0 fail / 2 skip**;
`check-unwired-exports` clean (no new orphans after deleting the two exports);
`check-max-file-lines` 0 over. Client rebuilt (`npm run build:client` OK).

Live on the box (2026-07-30, after `kill -TERM` service restart + kiosk F5):
- `GET /api/thumbnail/live/4` → 200, `Cache-Control: private, no-cache`, `ETag: W/"1785330617020-1330962"`.
- Same GET with `If-None-Match` → **304** (router threads the header through query).
- Repeated GETs left `data/live-thumbnails/ch-4.json` `capturedAt` untouched
  (`2026-07-29T13:10:17Z` day-old cache served as-is) → **no PRINT while a cache exists**.
- `POST /api/thumbnail/live/capture {channel:4, force:true}` → ok, new `capturedAt`
  `2026-07-30T14:22:01Z`, new sha → explicit-refresh pipeline intact.

Owner QA: watch a Sources→Live tile and a deck card with a DeckLink layer for >30 s — no blink,
no image change; ↻ still refreshes.
