# WO-198 — Compose preview: 404-after-etag race, editor-induced latency (settle over-deferral), client recovery

**Status:** Planned
**Priority:** High (preview latency + dead cells on the operator UI)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEW): higher jpeg-preview latency than before; `Image corrupt or truncated 1/2/3.jpg` spam; `GET /api/compose-preview/3.jpg?v=<etag> → 404`.
**Related:** WO-159 (truncation + gates), WO-155 T155.4 (the settle nudge — partially reverted here), WO-144 (blocklist).

---

## 1. Root causes (investigated 2026-07-14, live-probed)

1. **404-after-etag race:** broadcast path (`compose-preview-ffmpeg-jpeg.js:203-237`) only checks `size>32` at broadcast time; if the file is then truncated to 0 (WO-159 blocklist/detach truncation, `compose-preview-consumer.js:75-83`) before the client's GET, the image gate (`compose-preview-cache.js:245-250`) 404s an etag the client was just promised. Firefox logs "Image corrupt or truncated" per failed load. Live: `ch3_companion.jpg` currently 0 bytes; `GET /api/compose-preview/3.jpg` → 404 confirmed.
2. **Latency regression — WO-155's nudge backfired:** `routes-amcp.js:87-91` calls `onAmcpBatchMutation` on EVERY `/api/amcp/batch` (editor pushes fire per drag tick), which `scheduleSettle(ch, 150ms)` (`compose-preview-activity.js:8,209-231`); the ffmpeg broadcast defers while unsettled (`ffmpeg-jpeg.js:221-223`). Continuous editing = perpetually restarted settle window = frames withheld until the operator stops. **The nudge is unnecessary for freshness**: the FILE consumer writes continuously and the 40 ms mtime poll broadcasts changes by itself — the settle gate exists to hide mid-TAKE frames, not editor tweaks.
3. **No client recovery:** `preview-canvas-compose-snapshot.js:52-82` — img.onerror silently fails, no retry, no etag invalidation; meta 404 parks the channel in `_metaUnavailable` (:171-181) and only a future WS push revives it.

## 2. Tasks (haiku-sized)

- [ ] T198.1 **Revert the settle coupling for editor batches:** remove the `onAmcpBatchMutation` call from `routes-amcp.js:87-91` (and the wrapper in `compose-preview-activity.js` if now unused — keep `scheduleSettle`/`onSceneTake` used by takes). Keep WO-155's deck-thumb redraw event (that part is good). Note the partial revert in WO-155's log with the latency math.
- [ ] T198.2 **Close the truncation race:** in `truncateComposePreviewJpg` (consumer), after truncating ALSO (a) bump an internal generation/invalidate the last-broadcast mtime for that channel so the next poll can't treat the old broadcast as current, and (b) push the existing `compose.preview` WS event with an `unavailable`/cleared flag (mirror the blocklist push shape) so clients drop their cached etag immediately. Broadcast path: skip broadcasting any etag whose stat happens after a newer truncation (compare against the generation).
- [ ] T198.3 **Client recovery:** in `loadComposePreviewImage`/onerror — drop the cached etag for that channel and schedule ONE delayed retry (~1 s) via the meta path; any incoming WS frame push MUST clear `_metaUnavailable` for its channel (verify; fix if missing). No tight loops (keep the existing single-flight guard).
- [ ] T198.4 **Smokes:** extend `smoke-compose-preview-defects.test.js`: truncation after broadcast → next poll does not re-broadcast the dead etag + WS cleared-flag fired; batch mutations no longer defer broadcasts (activity untouched by /api/amcp/batch); client-side pure logic (etag drop on error) if extractable. Re-run the full compose-preview smoke family green.
- [ ] T198.5 Verify + WO bookkeeping (checkboxes, dated log; WO-155 log note; manual QA: edit continuously in the looks editor → compose cells keep updating ~live; no 404 spam in console; blocklisted cell shows badge not errors).

## 3. Acceptance criteria

- [ ] A198.1 Editing continuously does not stall compose-preview updates (operator check after restart+reload); latency back to the original ~poll-interval feel.
- [ ] A198.2 No `Image corrupt or truncated` / 404 spam during normal operation; truncated/blocklisted channels show the badge.
- [ ] A198.3 Take-time settle behavior (WO-110/144 era) unchanged; smokes green.

## 4. Work log

- 2026-07-14 — WO created; root causes live-probed (broadcast/serve asymmetry + WO-159 truncation race; WO-155 batch-settle over-deferral with 150 ms restarts per drag tick; client silent-fail).

#### 2026-07-14 — T198.1 + T198.2 + T198.3 + T198.4 implemented

**T198.1 (revert AMCP batch settle coupling):** Removed `notifyComposePreviewActivityAfterBatch`
call from `routes-amcp.js:151` (the /api/amcp/batch handler) and the now-unused wrapper function
(`:87-96`). Removed `onAmcpBatchMutation` from `compose-preview-activity.js` (function `:230-232`,
exports). The continuous 150 ms settle-window restarts per drag tick were an artifact of the fix,
not a feature. Appended reversion note to WO-155's work log.

**T198.2 (truncation generation counter + cleared WS event):** Added per-channel truncation
generation counter (`_truncationGeneration` Map in `compose-preview-consumer.js`). Modified
`truncateComposePreviewJpg` to bump the generation and broadcast a `{ channel, cleared: true }`
WS event so clients drop cached etags immediately. Added `getTruncationGeneration(ch)` export
and updated all truncation call sites to pass ctx for WS broadcast. In `compose-preview-ffmpeg-jpeg.js`,
added generation-tracking at stat time (`_statGenerationAt` Map) and two guards before broadcast:
  1. Check if generation changed since stat-ing — skip broadcast if so
  2. Re-stat and skip if size <= 32 (simpler fallback)
Added generation cleanup to `pruneMtimeState` for routing shrink.

**T198.3 (client recovery):** Modified `loadComposePreviewImage` in
`preview-canvas-compose-snapshot.js` to:
  - Drop cached etag on img.onerror
  - Schedule one delayed retry (~1000ms) via `pollChannelMeta` (single-flight guard)
Added handling of `cleared: true` WS event in `ingestComposePreviewWs` — drops cached etag
and triggers re-poll. Verified WS frame-push already clears `_metaUnavailable` when etag arrives.

**T198.4 (smoke tests):** Rewrote `smoke-amcp-batch-compose-preview-activity.test.js` to assert
the coupling is GONE (3 tests: batch no longer settles MIXER-only edits, PLAY/STOP/CLEAR, and
other paths still settle correctly). Extended `smoke-compose-preview-defects.test.js` with new
WO-198 suite: truncation bumps generation and broadcasts cleared event, generation guards prevent
stale broadcast, generation persists across truncations, reset clears generation, cleared WS event
clears client cache. All new + affected smokes passing.

Verification: `node --check` ✓ on all modified .js files. `eslint --quiet` ✓ (0 warnings).
Test results:
  - `smoke-amcp-batch-compose-preview-activity.test.js` 3/3 pass (batch no longer settles)
  - `smoke-compose-preview-defects.test.js` 20/20 pass (includes WO-198 gen-counter + cleared event tests)
  - `smoke-compose-preview-activity.test.js` 11/11 pass (no regressions)
  - `smoke-preview-snapshot-restart.test.js` 7/7 pass (no regressions)

Ready for operator QA (A198.1-A198.3).
