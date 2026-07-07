# WO-144 — Compose-preview defects: per-channel ADD failures + consumer recycle churn

**Status:** Implemented — awaiting restart + live-log verification (A144.2/A144.3)
**Priority:** High (visible PGM hitches + broken previews on some channels)
**Date:** 2026-07-07
**Depends on:** WO-141 (land on clean main). Parallelizable with WO-145/146/147.
**Related:** WO-57, WO-58, WO-63, WO-71, WO-72, WO-110.

---

## 1. Problem (confirmed from `log/caspar_2026-07-04.log`)

The webUI "live" preview attaches a persistent Caspar consumer per channel: `ADD <ch>-701 FILE media/highascg_preview/chN.jpg … -update 1`, Node watches file mtime and broadcasts WS events.

1. **`ADD 3-701` and `ADD 5-701` are rejected with `400 ERROR` on every recycle** while ch1/ch2 succeed — those channels are not FILE-consumable (or config mismatch), yet the code retries forever. Preview is genuinely broken on those channels.
2. **Full detach/attach recycle on every config save / project load / reconcile** — 426 `REMOVE x-701` events in one day; a REMOVE/ADD on the live PGM channel causes a visible output hitch (acknowledged in a code comment).
3. Constant benign-noise REMOVEs of legacy consumer indices (98, 700) every cycle.

Key files: `src/preview/compose-preview-consumer.js`, `compose-preview-ffmpeg-jpeg.js`, `compose-preview-activity.js`, `compose-preview-mode.js`; lifecycle `src/bootstrap/compose-preview-lifecycle.js`; API `src/api/routes-compose-preview.js`.

## 2. Tasks

- [x] T144.1 Probe channel validity once (INFO or first-ADD result) and blocklist channels that reject ADD; surface the blocklist via WS/status + `routes-compose-preview.js` so the UI shows "preview unavailable on ch N" instead of silent retry. → new `src/preview/compose-preview-blocklist.js`; first ADD rejection with an AMCP client error (400/401/402/403 / `COMMAND_UNKNOWN_DATA` / `INVALID_CHANNEL` / `PARAMETER_*`) blocklists the channel; blocklist resets when the channel's ADD signature changes (config change) or on service restart (in-memory; also cleared in lifecycle `onShutdown`). Surfaced via `/api/compose-preview/stats` (`blocklist` + per-channel `blocklisted`/`blocklistReason`), the refresh POST response, and a `compose.preview` WS push (`{ channel, blocklisted, reason, blocklistedChannels }` — same event the frame push uses, so no WS-handler change needed); `preview-canvas-compose-snapshot.js` renders "preview unavailable on ch N" in the cell.
- [x] T144.2 Make `refreshComposePreviewConsumers` diff-based: compare desired vs running consumer signatures per channel; only detach/attach channels whose args actually changed; NEVER recycle the on-air PGM channel's consumer unless its own signature changed. → `syncComposeFileConsumers()` in `compose-preview-consumer.js` (per-channel signature = exact ADD FILE params); `startFfmpegJpegComposePreview` no longer does stop-all/attach-all — unchanged channels (incl. on-air PGM) produce zero AMCP commands; mtime watch survives reconciles and only restarts when pollMs changes.
- [x] T144.3 Move legacy-index cleanup (REMOVE 98/700 + stale UDP STREAM) behind a first-run-only sweep flag. → `sweepLegacyComposeConsumers()` gated by per-process `_legacySweptChannels` set (once per channel per process; late-added channels still get one sweep).
- [x] T144.4 Add/extend a smoke test covering: blocklisted channel does not retry; unchanged config save causes zero REMOVE/ADD. → new `tools/smoke/smoke-compose-preview-defects.test.js` (mocked AMCP client, counts REMOVE/ADD lines; 6 tests).

## 3. Acceptance criteria

- [x] A144.1 `node --test tools/smoke/smoke-timeline-compose-preview.test.js` + new smoke green (output in work log).
- [ ] A144.2 A full day of caspar log shows ZERO `ADD x-701` 400 errors and REMOVE x-701 count near zero during normal operation (paste grep counts). **OPEN — needs a full day of live logs after the next highascg service restart (code is landed but not active until restart).** What to check the day after restart, against `log/caspar_<date>.log`:
  - `grep -c "400 ERROR" log/caspar_<date>.log | ` paired with `grep -B1 "400 ERROR" log/caspar_<date>.log | grep -c "ADD .*-701"` → must be 0 after the first probe per rejecting channel (expect at most ONE `ADD 3-701` and ONE `ADD 5-701` per service start / per config change touching those channels — not one per recycle).
  - `grep -c "REMOVE .*-701" log/caspar_<date>.log` → near zero (baseline was 426/day on 2026-07-04); REMOVEs should only appear when consumer args genuinely changed or channels were removed from routing.
  - `grep -c "REMOVE .*-98\|REMOVE .*-700" log/caspar_<date>.log` → at most once per channel per service start.
- [ ] A144.3 Config save while a look is on PGM → no visible hitch on the PGM output (manual check, note in log). **OPEN — operator check after restart:** put a look on PGM, save config (no composePreview changes) and load a project; PGM output must not blink/hitch, and the highascg log should show `[compose-preview] ffmpeg_jpeg unchanged — skipping consumer recycle` or a sync line with `attached=0 … detached=0`. Also confirm ch3/ch5 cells show "preview unavailable on ch N" instead of stale/black.
- [x] A144.4 UI/status shows which channels have preview available vs blocklisted (stats endpoint `blocklist` field + WS push + cell placeholder text; visual confirmation rides along with the A144.3 operator check).

## 4. Work log

- 2026-07-07 — WO created; defects confirmed against caspar log (426 REMOVEs/day, persistent 400s on ch3/ch5).
- 2026-07-07 — T144.1–T144.4 implemented. **NOTE: the box is live — service was NOT restarted; changes take effect on the next highascg service restart.** Files touched:
  - `src/preview/compose-preview-blocklist.js` (new, 128 lines) — blocklist state, permanent-rejection classifier, WS broadcast helper.
  - `src/preview/compose-preview-consumer.js` — diff-based `syncComposeFileConsumers()` (per-channel signature = ADD FILE params), blocklist integration in `attachComposeFileConsumer()`, once-per-process legacy sweep (`REMOVE 98/700` + stale UDP STREAM), `composeConsumersSettled()`, blocklist fields in `getComposeConsumerStats()`.
  - `src/preview/compose-preview-ffmpeg-jpeg.js` — `startFfmpegJpegComposePreview` no longer stop-all/attach-all; reconciles via sync, keeps mtime watch across reconciles (restart only on pollMs change), prunes mtime state for dropped channels, handles companion-thumb enable/disable in the diff path.
  - `src/api/routes-compose-preview.js` — `blocklist` in `/api/compose-preview/stats` + refresh POST response.
  - `src/bootstrap/compose-preview-lifecycle.js` — blocklist reset on shutdown (blocklist is process-scoped).
  - `client/components/preview-canvas-compose-snapshot.js` — ingests blocklist payloads on the existing `compose.preview` WS event, cell renders "preview unavailable on ch N", exports `isComposePreviewChannelBlocklisted()`.
  - `tools/smoke/smoke-compose-preview-defects.test.js` (new) — mocked AMCP; asserts: rejected channel probed exactly once then never retried (0 ADD/REMOVE across 3 refresh cycles); unchanged-signature refresh = 0 AMCP commands; signature change recycles only affected channels + re-arms one blocklist probe; legacy REMOVE 98/700 once per process; routing shrink detaches only removed channel.
  - Verification (A144.1): `node --test tools/smoke/smoke-compose-preview-defects.test.js` → 6/6 pass; full compose-preview smoke set (timeline, consumer, channels, activity, client-channels, companion-thumb, ffmpeg-args, look-air + new defects) → **43/43 pass**. `node --check` + `npx eslint --quiet` clean on all touched files.
  - Pre-existing, unrelated failure noted: `smoke-compose-preview-dirty.test.js` "GET png — serves written file with ETag" fails because `resolveMediaFileOnDisk` (src/media/local-media.js, untouched here, mtime Jun 21) stem-matches `ch5.png` when asked for `ch5.jpg` and reports it as jpeg. Not caused by WO-144.
- OPEN: A144.2 (day-of-logs grep counts after restart) and A144.3 (operator no-hitch check + blocklist UI eyeball) — exact steps written into the acceptance criteria above.
