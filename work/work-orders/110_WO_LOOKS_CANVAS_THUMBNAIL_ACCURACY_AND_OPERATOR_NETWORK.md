# Work Order 110: Looks canvas thumbnail accuracy + operator stick network (review follow-up)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress — Part A T110.1/T110.3/T110.5–T110.7 landed 2026-07-03  
**Priority:** **High** (looks editor thumbs misrepresent on-air output; stick IP config is operator-blocking in the field)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on / touches:**
- [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) — Caspar FILE consumer → `media/highascg_preview/ch{N}.jpg`
- [63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md](./63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md) — deck cards use compose snapshot when on air
- [42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md](./42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md) — Caspar `PRINT` → live PNG cache
- [71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md](./71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md) — event-driven PGM still cache (complementary; do not duplicate)
- [94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md](./94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md) — link-local when DHCP absent
- [95_WO_EXFAT_NETWORK_CONFIG_FILE.md](./95_WO_EXFAT_NETWORK_CONFIG_FILE.md) — stick `network/network.conf` at boot
- `src/preview/compose-preview-ffmpeg-args.js` — ffmpeg filter chain (Companion square hijack)
- `src/preview/compose-preview-companion-thumb.js` — Companion thumb copy path
- `src/media/live-thumbnail-cache.js` — PRINT still cache
- `src/preview/compose-preview-activity.js` — settle timing (currently test-only)
- `client/components/preview-canvas-draw-stacks.js` — canvas layer thumb draw
- `client/components/scenes-compose.js` — DOM layer thumb draw (`object-fit: contain`)
- `tools/runtime/highascg-network-apply.sh` — WO-59 NM apply helper

---

## 1. Problem statement (from 2026-07-03 review)

Operators editing **Looks** in the canvas compose editor report two classes of thumbnail bugs:

### 1.1 Wrong aspect ratio vs on-air output

1. **Companion square filter hijacks the main compose JPG.** When `composePreview.companionThumbEnabled` is true (default in `src/config/defaults-core.js`), `buildComposeFfmpegFilterChain()` applies a **144×144 square pad** to the Caspar FILE consumer output. The looks editor, compose preview panel, and on-air deck cards all read `/api/compose-preview/{ch}.jpg` — so they show a **square** image letterboxed into a 16:9 cell, not channel aspect. **Confirmed on dev box:** all `media/highascg_preview/ch*.jpg` files are 144×144 while channel output is 16:9.
2. **UI cell aspect ≠ program aspect** in dual PRV/PGM layout — preview cells are flex-sized, not locked to `programResolutions` aspect; `drawComposeSnapshotCell` contain-fits into arbitrary cell pixels.
3. **DOM vs canvas draw mismatch** for `native` / `fill-canvas` — DOM uses `object-fit: contain`; canvas compose stack **stretches** thumb to layer rect (`preview-canvas-draw-stacks.js`); timeline stack uses **contain**. After free edge-resize (non-uniform layer box), the three surfaces diverge.
4. **CG look thumbs** are cropped to graphic bounding box (`cg-look-thumb-render.js`) then stretched into full-frame layer rects.

### 1.2 Wrong composition vs what is on screen

1. **Live PRINT stills never auto-refresh.** `captureLiveThumbnailToCache` skips re-capture when cache file exists (`force !== true`). GET `/api/thumbnail/live/:channel` does not lazy-capture. Layer thumbs for route/live/NDI show a **stale** full-channel still until manual ↻.
2. **Continuous ffmpeg capture during transitions.** FILE consumer writes at up to 25 fps; `compose-preview-activity.js` `shouldCaptureOnTick()` / settle delays exist but are **only wired in tests** — production serves mid-transition frames.
3. **Media thumbs at seekSec=0** in looks editor (`scenes-editor.js`) vs default server seek **2 s** — video layers show first frame, not current playback frame.
4. **Preview push lag** — 16 ms debounce + AMCP round-trip; canvas layout reflects project state before Caspar catches up.
5. **Canvas resolution source split** — `applyNativeFillForSource` uses `sceneState.getCanvasForScreen(activeScreenIndex)` while rendering uses `getResolutionForScreen(mainIdx, …)` (live `channelMap.programResolutions`). Mismatched aspect shifts layer rects between edit and preview.

### 1.3 Operator stick network (same review)

- **Stick easy config** ([WO-95](./95_WO_EXFAT_NETWORK_CONFIG_FILE.md)): fully specified as `exfat/network/network.conf` but **zero implementation** — no parser, systemd unit, or seed layout. Operators can change IP only via Device View / API (WO-59).
- **Link-local fallback** ([WO-94](./94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md)): egg **systemd-networkd** config has `LinkLocalAddressing=ipv4`; WO-59 `highascg-network-apply.sh` sets NM `ipv4.method auto` **without** `ipv4.link-local`. On boxes where NM owns the NIC, no-DHCP direct cable gets no 169.254.x.x. **This dev box** uses networkd on `eno2` (NM `unmanaged`) — link-local works via networkd, but UI apply via `nmcli` would not affect `eno2`.

---

## 2. Goals (normative)

### Part A — Looks canvas / thumbnail accuracy

1. **Compose preview JPG preserves channel aspect** — main FILE consumer always uses `resolutionScale` (half/75/full), never the Companion square filter.
2. **Companion Stream Deck thumb remains square** — derived **server-side** from the main JPG (resize/pad in `compose-preview-companion-thumb.js` or parallel `_companion.jpg` write), not by switching the shared ffmpeg filter.
3. **Live PRINT stills refresh on meaningful bus/scene changes** — TTL and/or event hooks on take, preview push complete, and explicit channel invalidation; avoid infinite stale cache.
4. **Compose snapshot respects settle** — wire `compose-preview-activity.js` so client etag updates prefer post-settle frames (or gate FILE consumer pause/resume around transitions if simpler).
5. **One draw semantic for layer thumbs** — canvas compose, DOM compose, and timeline preview agree on `native` / `fill-canvas` / `horizontal` / `vertical` (match Caspar `MIXER FILL` behavior documented in `scene-take.js`).
6. **Single canvas resolution source** for fill math and preview draw — `getResolutionForScreen` / channel map wins; deprecate divergent `getCanvasForScreen` for compose when they disagree (log once).

### Part B — Operator stick network (implements / unblocks WO-94 + WO-95)

7. **exFAT `network/network.conf` applied at boot** — parser + oneshot systemd unit after exFAT mount (WO-95 T95.1–T95.3).
8. **Link-local on DHCP path** — `ipv4.link-local 2` in NM apply; networkd path documented; WO-95 `mode=dhcp` + no server → link-local (WO-94).
9. **Apply helper detects stack** — `highascg-network-apply.sh` (or exfat wrapper) uses **networkd** when NM reports interface `unmanaged`, not blind `nmcli` (field boxes vary).

---

## 3. Recommended approach

### 3.1 Decouple Companion thumb from main consumer (highest value, small diff)

In `compose-preview-ffmpeg-args.js`:

- Remove `companionThumbEnabled` branch from `buildComposeFfmpegFilterChain()` — main consumer always uses `buildScaleFilter(resolutionScale)`.
- In `compose-preview-companion-thumb.js` `processCompanionPreviewFrame()`: read main JPG bytes, ffmpeg/sharp resize to square `companionThumbSize`, write `ch{N}_companion.jpg` (path already exists).

Default `companionThumbEnabled: true` can remain — behavior changes, not the setting name.

### 3.2 Live PRINT cache freshness

- Add config `liveThumbnail.ttlMs` (default e.g. 30000) or invalidate on `onSceneTake` / `onProgramMutation` for channels in `resolveMonitoredChannels`.
- Optional: background capture after preview push settles (debounced) for edit-bus channel only.
- Keep manual ↻; surface “stale” tooltip when cache age &gt; TTL.

### 3.3 Settle gating for compose JPG

Option A (preferred): on `compose.preview` broadcast, skip etag update while `compose-preview-activity` reports “not settled” (reuse existing settle schedule from `onProgramMutation` / `onSceneTake`).

Option B: pause FILE consumer during transition window (`pauseConsumerWhenIdle` already exists in settings).

### 3.4 Unify thumb draw semantics

- For `native` and `fill-canvas`: use `drawImageContainInRect` in `drawSceneComposeStack` (match timeline + DOM).
- Document that **stretch** mode matches forced non-native aspect after edge resize.
- Add smoke or visual test matrix in `tools/smoke/` for one layer, each contentFit.

### 3.5 Canvas resolution alignment

- `createApplyNativeFillForSource`: pass `getResolutionForScreen(resolveMainIndexForScene(...))` instead of `getCanvasForScreen(activeScreenIndex)`.
- Warn in dev tools when persisted canvas ≠ channel map resolution.

### 3.6 Stick network (delegate to WO-94/95 with concrete tasks below)

Follow DeckLink exFAT pattern (`highascg-decklink-install.service`). Extend `highascg-network-apply.sh` for networkd + link-local before exfat parser calls it.

---

## 4. Tasks

### Part A — Thumbnail accuracy

- [x] **T110.1** Decouple Companion square filter from main FILE consumer (`compose-preview-ffmpeg-args.js`); square thumb generated in `compose-preview-companion-thumb.js` from main JPG.
- [ ] **T110.2** Verify `media/highascg_preview/ch{N}.jpg` dimensions match `resolutionScale` × channel size on air; update WO-58 docs if filter chain comment is wrong.
- [x] **T110.3** Live PRINT cache: TTL + invalidation on take / program mutation / preview-push complete (`live-thumbnail-cache.js`, hooks from `scene-take.js` or preview runtime).
- [x] **T110.4** Wire `compose-preview-activity` settle gate into `compose-preview-ffmpeg-jpeg.js` etag broadcast (or document Option B pause consumer).
- [x] **T110.5** Unify `drawSceneComposeStack` native/fill-canvas to `drawImageContainInRect`; align with DOM `object-fit: contain` and Caspar FILL semantics.
- [x] **T110.6** `applyNativeFillForSource` uses same resolution as `getResolutionForScreen` for the edited look's main index.
- [x] **T110.7** Smoke: compose JPG aspect (not square when companion enabled); live thumb refresh after take; optional visual/contentFit matrix test.
- [ ] **T110.8** (Optional) CG deck thumb: preserve aspect when drawing cropped PNG into layer rect (WO-60 follow-up).

### Part B — Operator network (WO-94 / WO-95)

- [x] **T110.9** Implement WO-94: `ipv4.link-local 2` in `highascg-network-apply.sh` dhcp branch; networkd path note in docs.
- [x] **T110.10** Implement WO-95 T95.1–T95.3: parser, `highascg-exfat-network-apply.service`, seed `network/network.conf` sample.
- [x] **T110.11** Network apply detects networkd-managed interfaces — skip/fallback when NM `unmanaged` (use `networkctl reconfigure` or documented manual path).
- [ ] **T110.12** Stick boot QA: extend `tools/startup/stick-boot-test` with optional `network.conf` module (WO-77 follow-up).

---

## 5. Acceptance criteria

### Thumbnail accuracy

1. With default settings, `ch1.jpg` (and siblings) are **not** 144×144; aspect matches channel (e.g. half of 1920×1080 → 960×540). `ch1_companion.jpg` remains square for Stream Deck.
2. Looks editor compose preview (snapshot mode) shows the same framing as PGM output (no square letterbox in cell).
3. After a take, live/route layer thumbs on the edit bus refresh within **TTL** without manual ↻ (or show stale indicator).
4. Compose preview etag does not advance on obvious mid-transition frames during a 500 ms MIX (manual QA).
5. `native` layer thumb in canvas compose matches DOM compose and on-air PGM for a 16:9 media file on a 16:9 channel.
6. Ultrawide / non-default channel resolution: layer fill rects computed with channel map resolution, not stale 1920×1080 default.

### Operator network

7. `exfat/network/network.conf` with `mode=static` applies before `highascg.service` on reboot; idempotent on unchanged file.
8. `mode=dhcp` with no DHCP server → host gets 169.254.x.x (networkd or NM per stack).
9. Device View network apply succeeds on networkd-managed `eno*` interfaces on egg images.

---

## 6. Rollout / risk notes

- **T110.1** changes default compose JPG size (larger files, slightly more disk IO) — acceptable; Companion path unchanged visually.
- Live thumb auto-capture increases PRINT load — debounce per channel; respect `_captureLocks`.
- WO-95 network apply on wrong interface can lock operator out — keep WO-95 fail-safe (invalid file → skip, log, keep previous config).
- Coordinate with [71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md](./71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md) — idle deck thumbs vs live compose; no duplicate capture timers.

---

## 7. Out of scope

- Replacing `canvas` compose mode with `ffmpeg_jpeg` as default (operator setting).
- Per-layer Caspar grab (no `GRAB` command in codebase; PRINT is full-channel only).
- Tailscale / hostname keys in stick network file (WO-95 reserved).
- Full removal of `sceneState.getCanvasForScreen` persistence (only compose path alignment here).

---

## Work Log

### 2026-07-03 — Initial WO (from looks canvas + stick network review)

- Captured findings from full review: Companion square filter hijacking main compose JPG (confirmed 144×144 on disk), stale live PRINT cache, unsettled compose capture, DOM/canvas draw mismatch, canvas resolution split, WO-95/94 implementation gap, networkd vs NM on egg images.
- **Instructions for Next Agent:** Start with **T110.1** (small server diff, fixes aspect ratio for all snapshot consumers). Then **T110.3** (stale live thumbs). WO-95/94 (**T110.9–T110.11**) can land in parallel if networking is priority — unblocks field static IP without Web UI.

### 2026-07-03 — WO-110 Part A implementation (agent)

**Server**
- `compose-preview-ffmpeg-args.js`: main FILE consumer always uses `resolutionScale` filter; Companion square no longer hijacks `ch{N}.jpg`.
- `compose-preview-companion-thumb.js`: square Stream Deck thumb derived via ffmpeg from main JPG (`resizePreviewToSquareJpegBuffer`).
- `live-thumbnail-cache.js`: 30 s TTL (`live_thumbnail_ttl_ms`), stale cache re-captures; `scheduleLiveThumbnailRefresh` on scene take + program mutation.
- `scene-take.js`, `live-scene-state.js`: bus-activity hooks schedule debounced PRINT refresh.
- `defaults-core.js`: `live_thumbnail_ttl_ms`, `live_thumbnail_refresh_on_bus`, `live_thumbnail_refresh_delay_ms`.

**Client**
- `preview-canvas-draw-stacks.js`: `native` / `fill-canvas` use `drawImageContainInRect` (matches DOM + timeline).
- `scenes-compose.js` / `scenes-editor.js`: `applyNativeFillForSource` uses `getResolutionForScreen` for the edited look's main index.

**Tests:** `smoke-compose-preview-ffmpeg-args.test.js` (companion decoupling); `smoke-live-thumbnail-ttl.test.js`.

**Deferred:** T110.2 live verify on air; T110.4 compose settle gate; T110.8 CG thumb aspect; Part B stick network (WO-94/95).

**Instructions for Next Agent:** Restart Caspar/highascg so FILE consumers re-attach with new filter (or toggle compose preview mode). Confirm `ch1.jpg` is ~960×540 not 144×144. Then T110.4 settle gate or Part B networking.

### 2026-07-03 — WO-110 Part A/B follow-up (agent)

**Settle gate (T110.4)**
- `compose-preview-activity.js`: exported `isComposePreviewSettled()`.
- `compose-preview-ffmpeg-jpeg.js`: defers `compose.preview` WS broadcast while channel is settling; flushes deferred mtime when settled.

**Operator network (T110.9–T110.11)**
- `highascg-network-apply.sh`: NM dhcp uses `ipv4.link-local 2`; when NM reports `unmanaged` and networkd owns the iface, applies via `80-highascg-operator.network` drop-in + `networkctl reconfigure` (egg/networkd boxes like this dev host).
- WO-95 exFAT parser + systemd unit already present from earlier session (`highascg-exfat-network-apply.sh`).

**Tests:** `smoke-compose-preview-activity.test.js` — settle + `isComposePreviewSettled`.

**Deferred:** T110.2 live JPG verify; T110.8 CG thumb; T110.12 stick QA module; T95.4–T95.6 API/docs/QA.

**Instructions for Next Agent:** Run `sudo bash scripts/runtime/install-network-apply.sh` and `sudo bash scripts/exfat/install-exfat-systemd-units.sh` on field box; QA exFAT `network/network.conf` static + dhcp. Restart highascg for compose consumer recycle.
