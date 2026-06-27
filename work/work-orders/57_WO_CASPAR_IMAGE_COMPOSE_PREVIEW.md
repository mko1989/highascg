# Work Order 57: Caspar ADD IMAGE compose preview (tick) — low-footprint live preview

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** Draft  
**Priority:** Medium (operator UX / resource efficiency)  
**Related:** [21_WO_TIMELINE_INSPECTOR_WAVEFORM.md](./21_WO_TIMELINE_INSPECTOR_WAVEFORM.md) (canvas compose stack), [42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md](./42_WO_SOURCES_LIVE_THUMBNAILS_AND_MEDIA_THUMB_FOLDER.md) (`PRINT` — **on-demand only**, not compose tick)

**Out of scope for this WO:** WebRTC / go2rtc preview stream ([05_WO_LIVE_PREVIEW_SETTINGS.md](./05_WO_LIVE_PREVIEW_SETTINGS.md)) — removed from server, client path not production-ready; **do not** spike or re-enable as part of WO-57.

**Superseded for production default by:** [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) — `caspar_image` remains as fallback; prefer `ffmpeg_jpeg` once WO-58 is validated.

---

## 1. Goal

Replace (or supplement) the **custom canvas compose preview** in the web UI — timeline stack drawing, scene layer thumbnails, placeholder fills — with **actual Caspar channel output** captured on a server **tick**, served as **stable static URLs** to the browser.

**Capture mechanism (only option for this WO):**

```text
ADD [channel] IMAGE [basename]     # fixed basename — overwrites same PNG under media folder (no extension in basename)
# e.g. ADD 1 IMAGE highascg_preview/ch1   → media/highascg_preview/ch1.png (overwrite each capture)
```

Each preview target (PRV, PGM, MV cell, …) gets **one fixed basename** per channel/role. The HTTP layer serves that path (or a stable alias) with `ETag` / `Last-Modified` from file mtime so the browser refreshes only when the file changes.

**Why not `PRINT`?**

Caspar `PRINT` writes a **new timestamped PNG** on every call (`live-thumbnail-cache.js` copies it into `data/live-thumbnails/` then deletes the media copy). That is fine for **on-demand** live source thumbs, but **unsuitable for compose tick preview**:

- No stable filename → cannot serve as a static URL without rename/copy every frame.
- High tick rate would **accumulate millions of PNGs** unless aggressively scavenged.
- Extra copy/delete I/O per capture vs in-place overwrite with `ADD IMAGE`.

**Why not WebRTC / stream?**

Preview UDP + go2rtc was **intentionally removed** (`caspar-ffmpeg-setup.js`). The client WebRTC path is **not ready** for compose preview. Permanent ffmpeg encode also conflicts with the **smallest server footprint** goal. Revisit only under a separate WO after streaming infra is stable.

**Product priorities (in order):**

1. **Sub-second latency** from output change → visible in compose preview (target ≤500 ms typical; hard cap ~1 s on busy machines).
2. **Smallest possible server footprint** — no ffmpeg preview pipelines; modest tick rate + dirty skip only.
3. **Quality and scale are secondary** — 320–480 px wide, low PNG compression, optional downscale inside Caspar if supported, is acceptable.

**Hard safety requirements (user-mandated):**

1. **Do not break the current system.** Phase 1 must **comment out / bypass** the legacy canvas compose draw behind a **feature flag**, not delete it. Default **off** until validated on hardware.
2. **Never issue `ADD IMAGE` for a channel that has not changed since the last successful capture** for that channel. Unchanged channels must be **skipped** on every tick.

---

## 2. Current state (baseline)

| Area | Today | Notes |
|------|--------|--------|
| **Scenes compose preview** | `drawSceneComposeStack()` in `client/components/preview-canvas-draw-stacks.js` | Thumbnails + fill rects + layer chrome; optional WebRTC `<video>` when `shouldShowLiveVideo()` — **not** a substitute for this WO |
| **Timeline compose preview** | `drawTimelineStack()` same file | Interpolated clip rects + ffmpeg thumbs; audio-only upper layers recently hidden |
| **Preview panel shell** | `client/components/preview-canvas-panel.js` | Dual PRV/PGM cells; canvas under optional WebRTC video |
| **Caspar → browser stream** | `src/streaming/caspar-ffmpeg-setup.js` | Preview UDP/WebRTC **removed** — not in scope |
| **Channel still capture (`PRINT`)** | `src/media/live-thumbnail-cache.js` | On-demand only; **timestamped** PNG names — keep for source browser / manual refresh, **not** compose tick |
| **AMCP** | `src/caspar/amcp-basic.js` | `print()` exists for live thumbs; **add `addImage(channel, basename)`** for compose preview |

**Implication:** Compose preview is **100% client canvas** today (unless legacy WebRTC happens to be up). Operators see an approximation, not the mixed Caspar frame.

---

## 3. Architecture — tick + `ADD IMAGE` (fixed filename)

```text
HighAsCG tick loop (e.g. 5–15 Hz, configurable)
  → for each preview target channel (PRV/PGM/MV from channelMap)
      → if channelDirty[ch] === false → SKIP (no AMCP)
      → else ADD ch IMAGE highascg_preview/ch{N}   # overwrites same file
      → wait for file mtime/size stable (fs.watch or poll)
      → optional: hash compare — if identical to last, still clear dirty
      → optional REMOVE consumer if Caspar leaves IMAGE consumer attached
  → GET /api/compose-preview/ch{N}.png  (stable URL; ETag = mtime or content hash)
  → client <img> or drawImage() in preview panel (replaces canvas stack when flag on)
```

| Pros | Cons / open questions |
|------|------------------------|
| Fixed path — **static serve**, no file explosion | Disk I/O on dirty ticks |
| No ffmpeg encode process | `ADD IMAGE` semantics vary by build — Phase 0 confirms one-shot vs persistent consumer |
| True Caspar mix (not reconstructed canvas) | Must implement robust **dirty** detection (see §4) |
| Works without go2rtc | Concurrent `ADD` on many channels needs queue / back-pressure |
| Overwrite in place — minimal media folder growth | IMAGE consumer cleanup if build leaves consumers attached |

**Rejected alternatives (do not implement under WO-57):**

| Alternative | Reason |
|-------------|--------|
| **`PRINT` tick** | Timestamped filenames; cannot serve stable static URL; millions of files at tick rate |
| **WebRTC / MJPEG / STREAM preview** | Not ready; wrong fit at prior attempt; permanent encode cost |

---

## 4. Dirty-channel detection (critical — do not skip)

**Requirement:** Between ticks, maintain `lastCaptureGeneration[channel]` and `channelDirty[channel]`. **Only** channels with `channelDirty === true` may receive `ADD IMAGE`.

### 4.1 Signals that MUST set dirty

| Source | When |
|--------|------|
| **Timeline playback** | `timeline.tick` / transport play/pause/seek/scrub on a channel that timeline `sendTo` routes to |
| **Scene take / preview push** | `scene-take.js`, preview push, layer PLAY/LOAD/STOP on PRV/PGM channels |
| **Mixer** | MASTERVOLUME / layer volume / opacity / route changes (OSC or AMCP echo) |
| **Multiview layout** | Cell geometry / source changes |
| **Config reload** | Channel map or consumer attach changed |
| **Manual** | Operator “refresh preview” button (forces all visible channels dirty once) |

### 4.2 Signals that must NOT spam capture

| Case | Behaviour |
|------|-----------|
| **Idle PGM** (static graphic, no animation) | After first capture, **clear dirty** → **no further ADD** until something changes |
| **Unchanged timeline tick** | Playing timeline but no clip/keyframe/mixer delta affecting that channel → **skip** |
| **Duplicate WS events** | Coalesce dirty marks within tick window (e.g. 50 ms) |
| **Same frame hash** | Optional: after capture, compare PNG hash to previous; if identical, still clear dirty but log at debug only |

### 4.3 Implementation sketch

```javascript
// src/preview/compose-preview-dirty.js (new, ≤300 lines)
/** @typedef {{ generation: number, dirty: boolean, lastHash?: string, lastCaptureAt?: number }} ChannelPreviewState */

// bumpDirty(channel, reason)   — called from playback tracker hooks
// clearDirty(channel, hash?)   — after successful capture
// shouldCapture(channel)        — dirty && !captureInFlight && rateLimitOk
```

**Reuse:** `src/state/playback-tracker.js`, OSC callbacks, timeline engine `tick`/`playback` events, scene transition diffs — **extend**, do not duplicate AMCP polling every 40 ms.

### 4.4 Anti-patterns (explicitly forbidden)

- Blind `ADD IMAGE` on all program/preview channels every tick regardless of activity.
- Using `PRINT` for compose tick preview (timestamped files).
- Parsing full `INFO` XML for all channels on every tick as the **only** dirty signal (too heavy); use as **fallback** on missed events only.
- Leaving hundreds of `IMAGE` consumers attached without `REMOVE` / fixed consumer index cleanup.

---

## 5. Non-destructive rollout (comment-out first)

### 5.1 Feature flag

Add to `config/defaults.js` + Settings (Preview pane):

```javascript
composePreview: {
  mode: 'canvas' | 'caspar_image',   // default: 'canvas'
  tickHz: 8,                          // 5–15 range
  basenamePrefix: 'highascg_preview', // under media folder
  maxWidth: 480,                      // if Caspar supports scale on IMAGE consumer
  channels: 'compose_visible',        // or explicit list
}
```

### 5.2 Client switch (Phase 2)

In `preview-canvas-panel.js` draw path:

```javascript
// if (composePreview.mode === 'caspar_image') {
//   drawComposeSnapshotImage(ctx, ...)  // new — stable /api/compose-preview/… URLs
//   return
// }
// --- legacy canvas compose (keep until WO-57 sign-off) ---
drawTimelineStack(...) / drawSceneComposeStack(...)
```

**Do not delete** `preview-canvas-draw-stacks.js` logic until WO-57 acceptance.

### 5.3 Server switch

New module behind same flag; when `mode === 'canvas'`, module loaded but **tick scheduler not started**.

---

## 6. Code map (planned)

| Concern | File / area |
|---------|-------------|
| Feature flag + defaults | `src/config/defaults.js`, `client/components/settings-modal*.js` |
| Tick scheduler + dirty registry | `src/preview/compose-preview-tick.js`, `src/preview/compose-preview-dirty.js` |
| AMCP capture | extend `src/caspar/amcp-basic.js` — **`addImage(channel, basename)`** |
| File stability + ETag | `src/preview/compose-preview-cache.js` — watch fixed paths under `media/highascg_preview/` |
| HTTP API | `src/api/routes-compose-preview.js` — `GET /api/compose-preview/:id.png`, `Cache-Control: no-cache` + `ETag` |
| WS optional | `compose.preview` event with `{ channel, etag, url }` — only when dirty capture completes |
| Client image draw | `client/components/preview-canvas-compose-snapshot.js` |
| Legacy canvas (keep) | `client/components/preview-canvas-draw-stacks.js` |
| Preview shell integration | `client/components/preview-canvas-panel.js`, `timeline-editor.js`, `scenes-editor.js` |
| Hooks for dirty | `src/state/playback-tracker.js`, `src/engine/timeline-playback.js`, scene take paths |
| Media folder hygiene | fixed files only under `media/highascg_preview/`; exclude from media browser (align WO-42) |
| Tests | `tools/smoke/smoke-compose-preview-dirty.test.js` (pure dirty logic), manual hardware checklist |

**Note:** Do **not** extend `live-thumbnail-cache.js` for compose tick — that module is `PRINT`/timestamp-specific.

---

## 7. Tasks

### Phase 0 — Caspar `ADD IMAGE` spike (no default behaviour change)

- [ ] **T57.0.1** Confirm Caspar build behaviour: `ADD 1 IMAGE highascg_preview/ch1` — overwrites same PNG? one-shot vs persistent consumer? need `REMOVE 1-N`? Document in Work Log with server version.
- [ ] **T57.0.2** Benchmark **ADD IMAGE** for 1× PRV + 1× PGM: latency (command → file stable), CPU %, disk writes/sec at 5 Hz and 10 Hz **with dirty-only** simulation.
- [ ] **T57.0.3** Confirm stable HTTP serve: fixed basename + `ETag` from mtime; browser `<img>` refresh latency acceptable.

### Phase 1 — Safety rails + parallel path (flag off)

- [ ] **T57.1.1** Add `composePreview` config schema + Settings toggle (**default: canvas**).
- [ ] **T57.1.2** Implement `compose-preview-dirty.js` with unit tests for bump/clear/coalesce.
- [ ] **T57.1.3** Wire dirty bumps from timeline playback, scene take, and one mixer path (minimum viable).
- [ ] **T57.1.4** Implement capture worker: `addImage(ch, fixedBasename)`, single-flight per channel, skip if `!shouldCapture`.
- [ ] **T57.1.5** `GET /api/compose-preview/:target.png` serving fixed media file + `ETag`.
- [ ] **T57.1.6** Client: **comment-switch** in preview panel — when flag on, show `<img>`/canvas blit from stable URL; **else unchanged canvas path**.

### Phase 2 — Compose integration

- [ ] **T57.2.1** Map **compose visible cells** (PRV/PGM per screen) to Caspar channel numbers via `channelMap`.
- [ ] **T57.2.2** Timeline editor compose: replace `drawTimelineStack` when snapshot mode active (legacy code commented, not deleted).
- [ ] **T57.2.3** Scenes editor compose: same for `drawSceneComposeStack`.
- [ ] **T57.2.4** Dual PRV/PGM layout: independent image per cell; respect collapsed panel (pause tick for hidden cells).

### Phase 3 — Hardening & observability

- [ ] **T57.3.1** Metrics/log line: captures/sec, skipped (clean), skipped (in-flight), AMCP errors; expose in `GET /api/health` or debug endpoint.
- [ ] **T57.3.2** Shutdown: cancel tick timer; no orphaned IMAGE consumers (best-effort `REMOVE`).
- [ ] **T57.3.3** Media folder policy: **fixed** PNGs only under `highascg_preview/`; exclude from media browser (align WO-42).
- [ ] **T57.3.4** Manual QA checklist (below) on hardware; only then consider **default flag → caspar_image** for new installs.

### Phase 4 — Optional enhancements (only if Phase 1–3 stable)

- [ ] **T57.4.1** WS push instead of client poll when capture completes.
- [ ] **T57.4.2** Layer-scoped still for inspector trim — would need Caspar support for fixed-basename layer capture; separate from full-channel compose.

---

## 8. Acceptance criteria

1. With `composePreview.mode = caspar_image`, timeline and scenes compose panels show **Caspar-mixed** output, not reconstructed thumbnails.
2. Static scene (no AMCP / OSC activity): **zero** `ADD IMAGE` commands for ≥2 s (verify in Caspar log).
3. Single mixer fade on PRV: **one** capture within ≤1 s; no burst of >3 captures for same channel unless operator drags continuously.
4. Toggle flag back to `canvas`: behaviour **identical** to pre-WO-57 (legacy path unchanged).
5. **No timestamped PNG accumulation** in media folder from compose preview — only fixed `highascg_preview/ch{N}` files.
6. Compose preview works with **`streaming.enabled === false`** and does not depend on go2rtc/WebRTC.

---

## 9. Manual QA checklist

- [ ] PRV only (PGM off) — timeline playing video + audio on L2; preview shows video mix; audio L2 not drawn as overlay.
- [ ] PGM take from scene — PRV and PGM cells update independently; only affected channel captured.
- [ ] Pause timeline — captures stop after idle settles.
- [ ] Multiview channel (if enabled) — dirty only when MV content changes.
- [ ] Restart HighAsCG — no duplicate IMAGE consumers (`INFO 1` clean); fixed preview files still present, not duplicated.
- [ ] Media folder — no runaway timestamped PNGs from compose tick.
- [ ] `streaming.enabled false` — snapshot preview still works.

---

## 10. Explicit non-goals (this WO)

- **WebRTC / go2rtc / STREAM** compose preview (not ready; separate future WO).
- **`PRINT` tick** for compose (timestamped files; use only existing on-demand live-thumb path).
- Replacing **WebRTC** for streaming/RTMP outputs or multiview program feed to air.
- Pixel-perfect match to SDI (preview is monitoring only).
- Per-layer compose preview in snapshot mode (full channel only unless Phase 4.2).
- Deleting canvas compose code before operator sign-off.

---

## Work Log

### 2026-06-26 — Agent (draft WO)

**Work done:**
- Drafted WO-57 from operator request: Caspar tick-based compose preview.
- Documented canvas baseline and non-destructive rollout + dirty-channel gate.

**Status:** Draft — no implementation started.

---

### 2026-06-26 — Agent (scope correction per operator)

**Work done:**
- **Removed `PRINT` as compose capture option** — Caspar `PRINT` always writes timestamped PNGs; unsuitable for stable static URLs and would create millions of files at tick rate. `live-thumbnail-cache.js` remains for on-demand source thumbs only.
- **Removed WebRTC/stream spike path** — preview UDP was correctly removed; client path not ready; out of scope for WO-57.
- **Single architecture:** `ADD IMAGE` with **fixed basename** per channel, overwrite in place, serve via stable `/api/compose-preview/…` + ETag.
- Renamed flag mode to `caspar_image`; dropped `captureMethod` config.

**Instructions for Next Agent:** Run **Phase 0** spike only for `ADD 1 IMAGE highascg_preview/ch1` on target Caspar build. Record overwrite semantics and consumer lifecycle in this log. Then implement **T57.1.2–T57.1.6** with flag default **off**.

---

*Work Order created: 2026-06-26 | Series: HighAsCG operations | Related: 21, 42*
