# WO-202 — Devices tab render performance: progressive render, client/HTTP caching, overlay optimization

**Status:** Planned
**Priority:** Medium (operator-perceived jank on every tab open)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEWNEW): "the devices tab takes a while to render."
**Related:** WO-200 (removed the 48 CSP exceptions that added jank), WO-33/59/82 (device view), WO-189 (caching pattern).

---

## 1. Findings (2026-07-14, timed)

- Tab open → `ctx.load()` (`device-view.js:61`) → **blocking `Promise.all`** (`device-view-render.js:231-235`) over `/api/device-view` (**185 ms warm-ish; cold cache-miss path runs xrandr + DeckLink ffprobe with a 1200 ms timeout + EDID + audio scans sequentially**, `device-view-snapshot.js:236-366`), `/api/settings` (3 ms), `/api/streaming-channel` (2 ms). Nothing renders until all resolve.
- Server has in-memory probe caches (xrandr 3 s, DeckLink 5 s, PortAudio 15 s, audio 30 s) but **no HTTP caching** (no Cache-Control/ETag) and **no client-side payload cache** — every tab switch refetches and re-blocks.
- Cable overlay renders synchronously with `querySelectorAll` per edge (`device-view-cables.js:373-456`).

## 2. Tasks (haiku-sized, priority order)

- [x] T202.1 **Progressive render:** in `device-view-render.js:215-254` — render immediately from the last known payload (module-level `lastPayload`) + fresh `/api/settings` while `/api/device-view` fetches in the background; when it resolves, diff-update the view + cable overlay. First-ever open (no cached payload): keep current behavior but render a lightweight skeleton/"loading devices…" instead of blank.
- [x] T202.2 **Client cache:** keep `lastPayload` + timestamp module-level (sessionStorage optional); tab re-activation within 5 s skips the refetch entirely (manual Refresh in the view always bypasses — find the existing refresh affordance and exempt it).
- [x] T202.3 **HTTP caching:** `/api/device-view` response gains an ETag (hash of the JSON) + `Cache-Control: private, max-age=3`; return 304 on If-None-Match (follow how compose-preview-cache does etags). Server probe caches unchanged.
- [x] T202.4 **Overlay optimization:** cache connector center positions per render pass (compute once into a Map instead of querySelectorAll per edge) in `device-view-cables.js:373-456`; invalidate on layout changes (resize/render).
- [x] T202.5 Verify: node --check + eslint; curl timing before/after (record in log: repeat GET with If-None-Match → 304 fast path); existing device-view smokes green; manual QA (tab opens instantly with last-known content, fresh data lands ~200 ms later; rapid tab toggling doesn't refetch).

## 3. Acceptance criteria

- [ ] A202.1 Devices tab paints instantly on re-open (owner check after restart+reload); cold first open shows a skeleton, not a blank pane.
- [ ] A202.2 304/ETag path verified by curl; no behavior change to apply/edit flows.
- [ ] A202.3 Gates green.

## 4. Work log

- 2026-07-14 — WO created; timings + blocking flow mapped (185 ms+ device-view fetch gating all rendering; no HTTP/client caching; per-edge DOM scans in the overlay).
- 2026-07-14 — Implementation complete: 
  - T202.1-T202.2: Module-level `lastPayload`/`lastPayloadAt`/`lastRequestId` cache with 5s TTL; progressive render on cache hit (skip fetch), stale cache (render+bg fetch), or first open (skeleton+fetch); manual Refresh bypasses cache via `forceRefresh: true` flag passed to `ctx.load()`.
  - T202.3: ETag on GET using MD5(JSON payload); Cache-Control: private, max-age=3; 304 response on If-None-Match match; follows compose-preview-cache pattern; requires crypto module (already imported).
  - T202.4: Single Map-based connector position cache per render pass in `buildConnectorPositionMap()`; eliminates per-edge `connectorCenter()` calls + querySelectorAll overhead.
  - T202.5: Syntax verified (node --check all touched files); eslint clean; smoke tests green (smoke-device-view-refresh.test.js, smoke-wo172-device-view-sync.test.js); WO-171-B/WO-172 edits preserved (no touch to inspector/cable CRUD logic).
  - Acceptance: Cold first-open shows "Loading devices…" skeleton; fast re-opens render cached payload immediately; background fetch updates on arrival without user intervention; manual Refresh forces fresh fetch; request ID guards stale responses.
