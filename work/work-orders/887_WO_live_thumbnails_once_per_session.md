# WO-887 — Live-source thumbnails months old: capture once per session on a non-black frame; no move cursor on Live rows

**Area:** media, godot-client
**Status: DONE (31.10.26 — offline: node 5030/0, smoke 14/14, Godot 24141/0; box after node restart 12:08: ch2/3/4 session captures logged + `fresh`, ch5/6 black → `waiting` retry 10 s, ch7 `no_picture`)**
**Source:** owner 31.10: *"in live tab of sources there are thumbanils for the live sources that are months old. need a good system that will recatch a thumbnail in an apropriete moment (non black frame, but i also dont want a checker running all the time to see if there is non black frame) and do it once, per sesion with only manual recatching available (which is not in the gui). when i hover over live sources i get a pointer change to an arrows cross, like for moving items."*
**Related:** WO-392 (capture-once — superseded here by once-per-session), WO-331 (stable URLs), WO-110 (bus invalidation — removed here), WO-845 (atomic capture), WO-622 (Godot Live tab).

---

## 1. Investigation (31.10)

**What the Live tab shows.** `godot/client/features/live/live_sources_panel.gd:176-184` (before) fetched
`GET /api/thumbnail/live/<ch>` once per channel per reload, for every row with a thumb channel — DeckLink / V4L2 inputs
AND the PGM/PRV bus rows (`live_sources_model.gd:92,100` build `route://<pgm>` / `route://<prv>` rows,
`thumb_channel()` maps them to their channel).

**What the server served (box, 31.10, read-only GETs):**

| ch | role now (channel map) | GET | cache file | content (decoded, 8 px grid) |
|---|---|---|---|---|
| 1 | GUI | 404 | — | — |
| 2 / 3 | PGM 1 / PRV 1 | 404 | — | — |
| 4 | PGM 2 | 200 | `ch-4.png` 30.07.26 | picture (mean luma 229) |
| 5 | PRV 2 | 200 | `ch-5.png` 13.08.26 | picture (mean 61) |
| 6 | DeckLink 1 | 200 | `ch-6.png` 31.10 08:22 | **black, alpha 0** (10 609 B) |
| 7 | Live audio 1 | 200 | `ch-7.png` 30.07.26 | **black, opaque** (audio-only channel) |
| 8 | — | 200 | `ch-8.png` 30.07.26 | picture of a channel that no longer exists |

**Root cause — nothing ever replaces a cached PNG, and black frames are stored:**
1. `src/media/live-thumbnail-input-capture.js:80` (before) — `if (hasCache) return { attempt: false, reason: 'has_cache' }`:
   WO-392 made live thumbs capture-once *for the lifetime of the file on disk*. `data/live-thumbnails/` survives node
   restarts, so "once" meant "once ever".
2. `src/media/live-thumbnail-cache-handlers.js:42-58` (before) — the GET only captured for dedicated **input** channels;
   PGM/PRV (`ch-4`, `ch-5`) were serve-cache-or-404 forever (a guard against "PRINT on every render").
3. The only thing that ever dropped a cache was bus-activity invalidation, `scheduleLiveThumbnailRefresh`
   (`src/media/live-thumbnail-cache-capture.js:49-64`, called from `src/state/live-scene-state.js:184`), which is reached
   only from the legacy web routes `/api/play|stop|clear` (`src/api/routes-amcp.js:183,204,226,265,273,278`). Godot
   takes go through the scene/look paths, so on this box it practically never fired — and when it did (e.g. Visuals tab
   `/api/play`), it *deleted* the PNG and PGM/PRV got a 404 tile instead of a new frame.
4. `captureLiveThumbnailToCache` (`live-thumbnail-cache-capture.js:228-241`, before) stored whatever PRINT produced: the
   DeckLink capture this morning landed on an empty channel → a transparent black `ch-6.png` that capture-once then
   pinned. An audio-only channel (ch 7) can only ever produce black.

**Frame check calibration** (memory "calibrate pixel probes"): pngjs decode + 160-across grid, luma × alpha. On the real
cache: ch-4 mean 229 / bright 98 %, ch-5 61 / 76 %, ch-6 0 / 0 % (alpha 0), ch-7 0 / 0 % (alpha 255). Async decode
20–90 ms per 1080p frame. File size alone would also separate these but misjudges a dark slate with a small logo.

**Cursor:** `live_sources_panel.gd:139` (before) — `panel.mouse_default_cursor_shape = Control.CURSOR_DRAG` (Godot's
move cross). Media rows set no cursor shape.

## 2. What was done

**Server — once per session, lazy, non-black, bounded** (`src/media/live-thumbnail-session.js`, new):
- The first `GET /api/thumbnail/live/:ch` of a node session starts ONE capture for that channel and waits ≤ 5 s for it
  (`decideSessionCapture`: any started session — capturing / waiting / fresh / gave_up — never starts another). No
  startup sweep, no poller: a channel nobody looks at is never PRINTed.
- `captureLiveThumbnailToCache` takes an `accept` veto (`live-thumbnail-cache-capture.js`): the PRINT is checked by
  `src/media/live-thumbnail-frame-check.js` BEFORE it replaces `ch-N.png`; a black frame is discarded (scratch PNG still
  cleaned up) and the previous PNG stays.
- Black / failed → retry on a fixed schedule `SESSION_RETRY_DELAYS_MS = [10 s, 30 s, 60 s, 2 min, 5 min]` (one timer per
  pending channel, `unref`'d), then `gave_up` for the session (log line once). Worst case 6 PRINTs per channel per
  session, ~8.7 min.
- Until the session frame lands the previous session's PNG is served as the placeholder; with none and only black frames
  the GET is a 404 (a black tile is no better than an empty one). PGM/PRV are now captured too — once per session is
  not "PRINT per render", which was WO-392's concern.
- Audio-only channels (live-audio inputs, `audioOnlyChannels`) are never PRINTed (`isAudioOnlyLiveChannel`); a custom
  upload (`meta.isCustom`) is never auto-replaced.
- Response headers: `X-Live-Thumb-Session` (fresh | custom | capturing | waiting | gave_up | idle | no_picture) and,
  while pending, `X-Live-Thumb-Retry-Ms`. ETag/304 + `no-cache` from WO-392 unchanged.

**Manual recapture — API only (no GUI control):** `POST /api/thumbnail/live/recapture` with `{ "channel": N }`,
`{ "channels": [..] }` or `{}` (= every video input + PGM/PRV of the channel map + every channel seen this session).
It restarts the session flow (non-black check + bounded retries) and answers with each channel's phase. The raw
`POST /api/thumbnail/live/capture` / `upload` (and GET `?refresh=1`) still store whatever they get and now mark the
channel fresh, so the session never overrides a manual capture. Registered in `src/api/router.js` next to `/capture`
(exact route — no earlier POST wildcard matches it; checked offline against the registry); API contract regenerated.

**Removed:** bus-activity invalidation (`scheduleLiveThumbnailRefresh`, its call in `live-scene-state.js`, the dead
`invalidateLiveThumbnailCache` export, the `live_thumbnail_refresh_on_bus` / `_delay_ms` defaults) — automatic deletion
contradicts "once per session, only manual". Also the per-GET backoff gate (`ensureInputLiveThumbnail`,
`decideInputThumbnailCapture`, `INPUT_CAPTURE_*`; 3 baseline entries shrunk). `config/general.json` still carries the two
dead keys — live runtime state, not edited; they are ignored.

**Godot client:** `live_sources_panel.gd` — `CURSOR_DRAG` removed (rows keep the arrow; drag forwarding unchanged).
Thumbnails: when the answer carries `X-Live-Thumb-Retry-Ms` the row re-fetches after that delay + 1 s, at most 8 times,
only while the tab is visible, and every row of that channel is updated (`_thumb_rects`); `reload()` (tab shown) bumps
a generation that drops older re-fetches. `live_sources_model.gd` `thumb_retry_ms()` parses the header.

**Reading of "which is not in the gui":** implemented as "manual recapture exists but not as a GUI control". Note the
Godot panel header already listed capture/upload thumbnail as *not ported*, so the owner may have been stating a fact
("manual recapture isn't in the GUI") rather than a constraint; if they want a control, it is a small add on top of the
new endpoint. The legacy web client's ↻ (raw `/capture force`) is untouched.

Files: `src/media/live-thumbnail-session.js` (new), `src/media/live-thumbnail-frame-check.js` (new),
`src/media/live-thumbnail-input-capture.js`, `src/media/live-thumbnail-cache-capture.js`,
`src/media/live-thumbnail-cache-handlers.js`, `src/media/live-thumbnail-cache-store.js`, `src/state/live-scene-state.js`,
`src/config/defaults-core.js`, `src/api/routes-media.js`, `src/api/router.js`, `docs/wiki/api/contract/http.md`,
`docs/wiki/api/state-and-media.md` (route table; the committed `docs/wiki-site` bundle was not rebuilt),
`tools/ci/unwired-exports-baseline.json`, `tools/ci/offline-test-files-2.js`,
`tools/smoke/smoke-wo887-live-thumb-session.test.js` (new), `tools/smoke/smoke-wo331-live-thumb-url-stability.test.js`,
`tools/smoke/smoke-decklink-input-look-thumb.test.js`, `godot/client/features/live/live_sources_panel.gd`,
`godot/client/features/live/live_sources_model.gd`, `godot/client/tests/test_live_sources.gd`.

## 3. What was VERIFIED

Offline (31.10):
- `smoke-wo887-live-thumb-session.test.js` 14/14: frame check (alpha-0 / opaque black / transparent white = black;
  picture, dark slate, small white text = not black; garbage PNG = black, no throw), decide cases, capture-once-per-session,
  black → bounded retries → gave_up with no further PRINTs, black-then-picture → fresh, audio-only / custom / Caspar-down
  never PRINT, wedged PRINT does not block the GET, manual recapture / recapture-all / manual capture cancels a pending
  retry; handler + real capture pipeline with a stub PRINT: old PNG served as placeholder while a black PRINT is
  discarded (and its scratch file removed), recapture replaces it, later GETs do not PRINT; no PNG + black → 404, nothing stored.
- Repointed: `smoke-wo331` (now pins "at most once per session, no setInterval, no TTL recapture"),
  `smoke-decklink-input-look-thumb` (classification + URL cases kept; gate cases moved to the WO-887 smoke).
- Full curated suite `node tools/ci/run-offline-tests.js`: 5030 tests, 5025 pass, 0 fail, 5 skip.
- `check-max-file-lines` 0 over; `check-unwired-exports` no new orphans; `gen-api-contract --check` clean (544 routes);
  prettier gate clean; eslint on the touched files: 1 pre-existing warning left (`routes-media.js` `b`), 2 removed.
- Godot: `run-client.sh --check` boot OK; `--test` 24141 passed, 0 failed (new `test_thumb_session_refetch`, 8/8 when run alone).

Not yet verified (needs the node restart — not done by this session):
- Box: `kill -TERM` the node, open Sources ▸ Live → journal `[live-thumb] chN: session thumbnail captured`; GET
  `/api/thumbnail/live/4` → `X-Live-Thumb-Session: fresh`, `capturedAt` in `data/live-thumbnails/ch-4.json` = today;
  ch 6 (no DeckLink signal) → `waiting` then `gave_up` after ~8.7 min with `ch-6.png` untouched; ch 7 → `no_picture`,
  no PRINT; repeat GETs → no new `capturedAt`.
- `curl -X POST /api/thumbnail/live/recapture -d '{"channel":4}'` on the box (router order proven offline only).
- Hover cursor on a Live row in the running GUI (source check + test only; the GUI was not relaunched).

### Box probe after the node restart (31.10.26 12:08)
`GET /api/thumbnail/live/{2..7}` right after `kill -TERM` of the node:

| ch | X-Live-Thumb-Session | on disk |
|---|---|---|
| 2, 3, 4 | `fresh` — journal `[live-thumb] chN: session thumbnail captured (attempt 1)` | ch-2/3/4.png re-written 31.10 12:08 |
| 5 (PRV 2), 6 (DeckLink, no signal) | `waiting`, `X-Live-Thumb-Retry-Ms: 10000` (black frame refused) | old PNG kept (13.08 / 08:22) |
| 7 (live audio) | `no_picture` — no PRINT | untouched |

The Live-row cursor (no CURSOR_DRAG) is pinned by test_live_sources.gd; the owner's GUI was relaunched with it at 12:09.

