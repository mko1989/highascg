# Work Order 58: FFmpeg JPEG compose preview — Caspar writes file directly, no ADD IMAGE tick

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** Draft  
**Priority:** Medium (operator UX / Caspar log hygiene)  
**Supersedes (partially):** [57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md](./57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md) — `caspar_image` tick mode remains as fallback; **`ffmpeg_jpeg` becomes the recommended default** once validated.  
**Related:** [21_WO_TIMELINE_INSPECTOR_WAVEFORM.md](./21_WO_TIMELINE_INSPECTOR_WAVEFORM.md) (compose canvas baseline), [27_WO_STREAMING_CHANNEL.md](./27_WO_STREAMING_CHANNEL.md) (Caspar ffmpeg arg conventions)

**Out of scope:** go2rtc, WebRTC, UDP/MPEG-TS relay (fallback only if direct file fails spike), per-layer capture, deleting canvas compose code.

---

## 1. Problem statement

[WO-57](./57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md) `caspar_image` mode works but **floods Caspar logs** with repeated AMCP:

```text
ADD 2 IMAGE highascg_preview/ch2
```

At 8 Hz × 3 channels that is ~24 log lines/sec while video plays. Operators need **true Caspar-mixed compose preview** without continuous AMCP noise.

**Operator request (2026-06):** use a **low-cost Caspar ffmpeg consumer** that writes a fixed JPEG under `media/`; browser shows that file (same UX as WO-57 snapshot URLs).

**Operator refinements (2026-06-27):**
- Output resolution must be **relative to channel size** (not a fixed 480 px width): default **half** width × height; also **75%** and **full**.
- **FPS editable** in Settings modal.
- **No UDP relay** if Caspar can write the file directly (it can — see §3.1).

---

## 2. Goal

Replace the **ADD IMAGE tick loop** with a **persistent Caspar `<ffmpeg>` consumer** that writes JPEG in place:

```text
Caspar channel (static <ffmpeg> in casparcg.config)
  → media/highascg_preview/ch{N}.jpg   (image2, -update 1)

Browser (reuse WO-57 client)
  → poll GET /api/compose-preview/{N}.jpg  (ETag from mtime)
  → drawImage on compose canvas cells
```

**No HighAsCG receiver process. No UDP. No second ffmpeg.**

**Hard requirements:**

1. **Zero repeated AMCP** during normal playback — no tick `ADD IMAGE`.
2. **Caspar log quiet** — consumer attached at config load only; no per-frame commands.
3. **Resolution relative to channel** — scale derived from channel frame size (`iw`/`ih`), not a fixed pixel width.
4. **Operator-tunable FPS and scale** — Settings modal exposes fps + scale preset.
5. **OSC-driven idle** — optional REMOVE/ADD consumer on state transitions only (not per frame); last JPEG remains on disk when idle.
6. **Non-destructive rollout** — `ffmpeg_jpeg` mode; keep `canvas` and `caspar_image`.
7. **No go2rtc.**

---

## 3. Architecture

### 3.1 Primary: direct file write (no stream)

Caspar’s ffmpeg consumer accepts **`[file|url]`** as `<path>` ([Caspar config docs](https://casparcg.net/validator/explained.html), [FFmpeg consumer wiki](https://github.com/CasparCG/help/wiki/FFmpeg-Consumer)). HighAsCG embeds one consumer per monitored channel:

```xml
<ffmpeg>
    <path>highascg_preview/ch2.jpg</path>
    <args>-filter:v scale=iw/2:ih/2,format=yuv420p,fps=2 -codec:v mjpeg -q:v:v 10 -format image2 -update 1</args>
</ffmpeg>
```

Path is **relative to Caspar `media-path`** (same folder WO-57 uses). Caspar’s internal ffmpeg overwrites the same file continuously.

**Caspar ffmpeg arg rules** (same as RTMP/streaming code in this repo):
- Use **`-format image2`**, not `-f image2`
- Use **`-codec:v`**, **`-filter:v`**, **`-q:v:v`** (stream suffix) — args without `:v` log “Unused option”
- Filter chain receives **RGBA from Caspar** → convert with `format=yuv420p` before MJPEG

**Why not UDP?** UDP + a HighAsCG receiver ffmpeg was the initial WO-58 draft. It adds port management, a second encode/decode, and another process for no benefit when Caspar can write the file itself. UDP remains a **Phase 0 fallback** only if direct `image2` + `-update 1` fails on the target Caspar build.

### 3.1.1 Resolution scale (relative to channel)

Scale is expressed with **ffmpeg `iw` / `ih`** so it automatically matches each channel’s video mode (3072×1728, 1080p5000, etc.) — no hard-coded widths.

| Setting `resolutionScale` | Filter scale expression | Example on 3072×1728 |
|---------------------------|-------------------------|----------------------|
| `half` (**default**) | `scale=iw/2:ih/2` | 1536×864 |
| `75` | `scale=trunc(iw*3/4/2)*2:trunc(ih*3/4/2)*2` | 2304×1296 |
| `full` | *(omit scale)* | 3072×1728 |

Built in `compose-preview-ffmpeg-args.js`:

```javascript
function buildScaleFilter(resolutionScale) {
  if (resolutionScale === '75') return 'scale=trunc(iw*3/4/2)*2:trunc(ih*3/4/2)*2'
  if (resolutionScale === 'full') return null
  return 'scale=iw/2:ih/2'  // default half
}

function buildComposeFfmpegArgs({ fps, resolutionScale, jpegQuality }) {
  const parts = []
  const scale = buildScaleFilter(resolutionScale)
  if (scale) parts.push(scale)
  parts.push('format=yuv420p', `fps=${fps}`)
  return `-filter:v ${parts.join(',')} -codec:v mjpeg -q:v:v ${jpegQuality} -format image2 -update 1`
}
```

Regenerating `casparcg.config` is required when operator changes fps/scale/quality (consumer args are static XML).

### 3.1.2 FPS (Settings)

| Field | Default | Range | Notes |
|-------|---------|-------|-------|
| `composePreview.fps` | `2` | 1–30 (UI slider) | Drives `-filter:v …,fps=N` in consumer |

Low default keeps CPU down; operator can raise for smoother compose preview during edits.

### 3.2 Data flow

```text
┌─────────────────────────────────────────────────────────────────┐
│ CasparCG channel N (PRV/PGM)                                     │
│   <ffmpeg> consumer (casparcg.config — no AMCP during play)      │
│     path: highascg_preview/chN.jpg                               │
│     args: -filter:v scale=iw/2:ih/2,format=yuv420p,fps={fps}    │
│           -codec:v mjpeg -q:v:v {q} -format image2 -update 1    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ overwrite in place
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ media/highascg_preview/chN.jpg                                   │
└───────────────────────────┬─────────────────────────────────────┘
                            │ mtime / ETag
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ GET /api/compose-preview/{N}.jpg                                 │
│ GET /api/compose-preview/{N}/meta                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ client/components/preview-canvas-compose-snapshot.js             │
│   poll meta → drawImage when etag changes                        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 OSC idle gating (optional AMCP, not per frame)

When consumer runs continuously, JPEG keeps updating even on a static frame (same image, new mtime). To save CPU when nothing is moving:

| State | Action | AMCP frequency |
|-------|--------|----------------|
| OSC: any layer `remaining > 0` | Consumer **present** (config or `ADD … FILE`) | 0 during play |
| OSC: all `remaining = 0/null` | **`REMOVE` ffmpeg consumer** for that channel | once per idle transition |
| Content change / play resume | **`ADD` consumer back** (same args) | once per live transition |
| Channel clear | REMOVE; optional delete JPG | rare |

Reuse `compose-preview-activity.js` → `shouldConsumerRun(ctx, channel)`; new thin module `compose-preview-consumer.js` issues REMOVE/ADD only on transitions.

**Simpler alternative (Phase 1):** leave consumer always on at configured fps; add OSC REMOVE/ADD in Phase 2 if CPU is an issue.

### 3.4 Caspar consumer attachment

**Preferred:** embed in generated `casparcg.config` for each compose-visible channel when `composePreview.mode === 'ffmpeg_jpeg'`.

**Generator:** `buildComposePreviewFfmpegConsumerXml(config, channel)` in `src/config/config-generator-audio-xml.js`.

**Channel 2 (PRV):** currently empty `<consumers>` — ideal slot.

**On settings change** (fps / scale / quality): regenerate config + Caspar restart (same as other consumer changes).

### 3.5 Feature flag & Settings modal

```javascript
composePreview: {
  mode: 'canvas' | 'caspar_image' | 'ffmpeg_jpeg',
  fps: 2,                      // ffmpeg_jpeg — editable in Settings
  resolutionScale: 'half',     // 'half' | '75' | 'full'
  jpegQuality: 10,             // -q:v:v (2–31, lower = better)
  tickIntervalMs: 125,         // caspar_image only
  basenamePrefix: 'highascg_preview',
  channels: 'compose_visible',
  embedConsumersInCasparConfig: true,
  pauseConsumerWhenIdle: true, // OSC REMOVE when idle (Phase 2)
}
```

**Settings modal (Defaults tab)** when compose preview enabled:

| Control | Modes | Widget |
|---------|-------|--------|
| Preview source | all | select: Canvas / Caspar JPEG (ffmpeg) / Caspar ADD IMAGE (legacy) |
| FPS | `ffmpeg_jpeg` | slider 1–10 + label |
| Resolution | `ffmpeg_jpeg` | select: Half / 75% / Full |
| JPEG quality | `ffmpeg_jpeg` | slider 2–20 |
| Tick interval | `caspar_image` only | existing ms slider |

Note in UI: changing FPS/resolution requires **Apply Caspar config** (or auto-regenerate if generator hook is wired).

Env override: `HIGHASCG_COMPOSE_PREVIEW_MODE=ffmpeg_jpeg`

### 3.6 HTTP / cache layer

Extend `compose-preview-cache.js`:
- Resolve `.jpg` then `.png` (backward compat with `caspar_image`)
- Serve correct `Content-Type: image/jpeg`
- Meta: `{ format, etag, mtimeMs, width?, height? }` — optional dimensions from ffprobe or config

**No AMCP in cache layer.**

### 3.7 Lifecycle

| Event | `caspar_image` | `ffmpeg_jpeg` |
|-------|----------------|---------------|
| Caspar connect | start tick | ensure consumers (config); optional OSC gating loop |
| Caspar disconnect | stop tick | best-effort REMOVE if dynamically added |
| Config change | restart tick | regenerate casparcg.config; restart Caspar |
| Shutdown | stop tick | no extra processes to kill |

**Disable** `compose-preview-tick.js` when mode is `ffmpeg_jpeg`.

### 3.8 Fallback: UDP relay (only if spike fails)

If Phase 0 shows direct `image2` + `-update 1` broken on this Caspar build:

```text
Caspar → UDP MPEG-TS → HighAsCG ffmpeg receiver → chN.jpg
```

Use `casparUdpStreamUri()` from `caspar-ffmpeg-setup.js`. **Do not implement unless spike requires it.**

---

## 4. Comparison

| | WO-57 `caspar_image` | WO-58 `ffmpeg_jpeg` (direct file) |
|---|---|---|
| Caspar AMCP during play | ~8/sec/channel | **0** |
| Extra processes | 0 | **0** |
| Encode location | Caspar IMAGE | Caspar ffmpeg → JPG on disk |
| Resolution | Caspar default | **½ / 75% / full of channel** |
| FPS | tick interval | **Settings `fps`** |
| Idle CPU | stops ADD | optional REMOVE consumer |
| Config change | none | embed `<ffmpeg>` blocks |

---

## 5. Code map (planned)

| Concern | File |
|---------|------|
| WO doc | `work/work-orders/58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md` |
| Defaults + flag | `src/config/defaults-core.js`, `config/general.json` |
| Caspar args builder | `src/preview/compose-preview-ffmpeg-args.js` (new, ≤150 lines) |
| Caspar config XML | `src/config/config-generator-audio-xml.js` |
| OSC consumer gating | `src/preview/compose-preview-consumer.js` (new, ≤250 lines) — REMOVE/ADD on transitions |
| OSC activity | `src/preview/compose-preview-activity.js` — `shouldConsumerRun()` |
| Lifecycle | `src/bootstrap/compose-preview-lifecycle.js` |
| Disable tick | `src/preview/compose-preview-tick.js` |
| File serve | `src/preview/compose-preview-cache.js` |
| Settings API + UI | `settings-get/post.js`, settings modal templates/logic |
| Client | `client/lib/compose-preview-url.js` |
| Tests | `tools/smoke/smoke-compose-preview-ffmpeg-args.test.js` |
| UDP fallback (optional) | `src/preview/compose-preview-receiver.js` — **only if spike fails** |

---

## 6. Tasks

### Phase 0 — Spike (direct file first)

- [ ] **T58.0.1** Add manual `<ffmpeg>` block on **channel 2** writing `highascg_preview/ch2.jpg` with `scale=iw/2:ih/2,fps=2,image2,-update 1`; restart Caspar.
- [ ] **T58.0.2** Confirm JPG updates while video plays; dimensions = half of channel video mode.
- [ ] **T58.0.3** Confirm **zero AMCP** during playback.
- [ ] **T58.0.4** Try `75` and `full` scale expressions; document working args in Work Log.
- [ ] **T58.0.5** *(Fallback only)* If T58.0.1 fails, test UDP + receiver path; document build limitation.

### Phase 1 — Server core

- [ ] **T58.1.1** Config schema: `fps`, `resolutionScale`, `jpegQuality`, mode `ffmpeg_jpeg`.
- [ ] **T58.1.2** `compose-preview-ffmpeg-args.js` — scale/fps/quality → Caspar args string.
- [ ] **T58.1.3** Config generator embeds ffmpeg consumers for compose-visible channels.
- [ ] **T58.1.4** Cache layer: serve `.jpg` + Content-Type.
- [ ] **T58.1.5** Lifecycle: disable ADD IMAGE tick when `ffmpeg_jpeg`.
- [ ] **T58.1.6** Stats: consumer embedded / file mtime / last OSC state.

### Phase 2 — Settings UX + OSC idle

- [ ] **T58.2.1** Settings modal: mode select, **FPS slider**, **resolution Half/75%/Full**, JPEG quality.
- [ ] **T58.2.2** Settings POST persists fields; triggers config regen when ffmpeg_jpeg params change.
- [ ] **T58.2.3** Client: `ffmpeg_jpeg` uses same snapshot poll path as `caspar_image`.
- [ ] **T58.2.4** OSC `shouldConsumerRun` → REMOVE/ADD consumer on idle/live transitions (if `pauseConsumerWhenIdle`).

### Phase 3 — Hardening

- [ ] **T58.3.1** Smoke tests for args builder (half/75/full/fps).
- [ ] **T58.3.2** Manual QA (§8); migrate `general.json` to `ffmpeg_jpeg`.
- [ ] **T58.3.3** Disable `caspar_image` on production machines using ffmpeg_jpeg.

---

## 7. Acceptance criteria

1. Compose panels show Caspar-mixed output with `ffmpeg_jpeg`.
2. **No repeated AMCP** during 60 s playback.
3. JPG dimensions match selected scale relative to channel (half default).
4. Changing FPS in Settings → regen config → observable update rate change.
5. Changing resolution scale → output dimensions change accordingly.
6. Idle: JPG stops updating (REMOVE or static frame); last frame visible.
7. `canvas` and `caspar_image` modes still work.

---

## 8. Manual QA checklist

- [ ] ch2 @ half — JPG is 50% of channel WxH.
- [ ] Settings → 75% — regen config — JPG matches 75%.
- [ ] Settings → fps 5 — JPG mtime ~5×/sec.
- [ ] Clip ends — updates stop; still visible.
- [ ] Caspar log — no ADD IMAGE flood.
- [ ] Switch canvas / ffmpeg_jpeg / caspar_image.

---

## 9. Explicit non-goals

- go2rtc / WebRTC.
- Fixed 480 px width (removed — use channel-relative scale).
- UDP relay (unless spike fallback).
- Per-layer capture.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| `image2 -update 1` unsupported on build | Phase 0 spike; fallback UDP or `caspar_image` |
| `-update 1` not forwarded by Caspar | Try without; or `%05d` sequence + symlink latest |
| Config regen on every fps tweak | Batch settings Apply; document restart |
| Continuous encode when idle | Phase 2 OSC REMOVE |

---

## Work Log

### 2026-06-27 — Agent (draft WO)

**Work done:**
- Drafted WO-58: ffmpeg consumer compose preview replacing ADD IMAGE tick.

**Instructions for Next Agent:** Phase 0 spike on ch2.

---

### 2026-06-27 — Agent (architecture revision per operator)

**Work done:**
- **Removed UDP/relay as primary path** — Caspar ffmpeg consumer writes **directly to `media/highascg_preview/chN.jpg`** (`image2`, `-update 1`). No HighAsCG receiver process.
- **Resolution:** channel-relative scale — default **`half`** (`iw/2:ih/2`); Settings options **`75`**, **`full`**. No fixed 480 px.
- **FPS:** editable in Settings modal (`composePreview.fps`, default 2, range 1–10).
- UDP relay demoted to **Phase 0 fallback only** if direct file write fails on hardware.
- Updated tasks, code map, acceptance criteria, and Settings UX spec.

**Instructions for Next Agent:** Phase 0 spike **T58.0.1** — direct file consumer on ch2 with `scale=iw/2:ih/2,fps=2`. If it works, implement args builder + config generator (Phase 1). Do not build UDP receiver unless T58.0.5 required.

---

*Work Order created: 2026-06-27 | Updated: 2026-06-27 | Related: 57, 21*
