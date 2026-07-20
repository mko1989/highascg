# WO-280 — Caspar JPEG compose preview: backpressure and error handling

**Source:** todos19.07.26 — "there is something wrong with the caspar jpeg compose preview. it
started as default on my laptop and after a while the operator server gui started lagging because
i had the tab open in the background on my laptop, creating probably something wrong with
thumbnail creation for an ever changing jpeg, this needs to be error handled better."

## Problem
With the compose preview in its Caspar-JPEG mode, a browser tab left open **in the background**
(laptop, secondary client) kept requesting/refreshing an ever-changing JPEG. Over time the
operator server GUI lagged. Symptoms point at unbounded work on the server: a refresh loop with
no backpressure, overlapping generations of the same frame, and/or failures that are retried
immediately instead of backed off. On this box the deck thumbs use the `canvas` mode
(`config/general.json` → `composePreview.mode`), so the JPEG path is a secondary mode that is
clearly less hardened.

## Investigate first (write findings before changing code)
1. Locate the JPEG compose-preview pipeline: producer (Caspar-side capture / ffmpeg / PRINT),
   the server route that serves it, and the client refresh loop. Grep `composePreview`,
   `compose-preview`, `ffmpeg_jpeg` under `src/` and `client/`.
2. Establish what actually accumulates: concurrent generations, timers that never clear, a cache
   that grows, sockets kept open, or an error path that retries hot.
3. Confirm whether a **hidden** tab keeps the loop running at full rate (Page Visibility API is
   the natural guard) and whether multiple clients multiply the server-side work.

## Requirements
1. **Single-flight on the server**: one generation per source at a time; concurrent requests join
   the in-flight generation instead of starting another. (`src/api/routes-media.js` already has a
   WO-184 in-flight guard for thumbnails — reuse that pattern rather than inventing one.)
2. **Backpressure on the client**: pause/greatly slow the refresh when the document is hidden
   (`document.visibilityState`), and never queue a new request while one is outstanding.
3. **Error handling with backoff**: a failed generation must back off (exponential, capped) and
   log once per state change — never a hot retry loop, never a per-frame error line.
4. **Bounded work regardless of client count**: N background tabs must not mean N× server work.

## Acceptance
- With a client tab hidden, server-side generation rate drops sharply; no unbounded growth in
  timers/handles/cache entries over a long run.
- Failure injection produces backed-off retries and a single state-change log line, not a flood.
- Offline smoke test covering the single-flight join and the backoff schedule (pure functions;
  no real ffmpeg or Caspar).
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.

## Constraints
- Do NOT restart the highascg service and do NOT run `npm run build:client` — the main session
  handles build/restart.
- Do not change the default `composePreview.mode` on this box.
