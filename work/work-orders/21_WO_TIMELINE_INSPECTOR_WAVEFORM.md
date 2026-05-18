# Work Order 21: Timeline Layout (Resizable / Collapsible) + Trim Preview Frame + Clip Waveforms

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Improve the **timeline editor** workspace and **media-aware clip visualization**:

1. **Inspector** — user-resizable width (drag handle), and **collapsible** (toggle) without losing state.
2. **Sources browser** (media/templates list) — **collapsible** alongside the timeline, with persisted width where applicable.
3. **Compose ↔ timeline splitter** — the bar that resizes the compose (stack) view vs the timeline strip is **too thick**; make it **subtle** (thinner hit-area styling, visual weight).
4. **Trim / clip duration editing** — while dragging in/out points or changing duration on the timeline, the **preview** should show the **video frame at the current trim position** (not a stale frame).
5. **Audio waveforms** — for clips that contain an audio stream, draw a **waveform inside the clip rectangle** on the timeline (server has filesystem access to media → analyze once, cache, reuse).

These are **large, separable** features; implement in phases below. Prefer small PR-sized chunks per phase.

---

## Current State (Baseline)

- Timeline UI lives under `web/components/` (`timeline-editor.js`, `timeline-canvas.js`, `timeline-transport.js`, etc.).
- Inspector and sources are likely composed in `timeline-editor.js` or `app.js` layout; compose area vs timeline may use flex/grid with a fixed “gutter” for resize.
- Preview during editing may use `timeline-preview-runtime` / go2rtc or canvas — trim gestures may not seek the preview element to the edited frame.
- No first-class waveform asset today; media browser may expose duration via `ffprobe` or Caspar metadata only in some paths.

---

## Architecture Notes

### Layout shell (Phases 1–2)

- Use a **CSS-first** approach: `flex` or `grid` with **CSS variables** for panel widths (`--inspector-width`, `--sources-width`), stored in **`localStorage`** (namespaced keys e.g. `highascg.timeline.layout.v1`) so reopening restores layout.
- **Resize**: pointer capture on a narrow **drag handle** (1–4px visible line, larger invisible hit target ~6–8px) — same pattern as VS Code / DAW side panels.
- **Collapse**: toggle buttons in panel headers or strip edges; collapsed state boolean persisted; collapsed width `0` with `overflow: hidden` and icon to expand.

### Trim preview frame (Phase 3)

- On **trim handle drag** or **duration change**, compute **absolute time in ms** (or frame index) at the active handle.
- **Seek** the preview `<video>` (or the timeline preview pipeline) to that time: `video.currentTime = t` (throttle to `requestAnimationFrame` or ~50ms while dragging).
- If preview uses **WebRTC / go2rtc**, ensure the binding supports seek or use a **secondary** still/thumbnail path for trim (fallback: `GET /api/thumbnail` with time query if already available — only if cheaper than seek).

### Waveforms (Phases 4–6)

- **Server** generates **compact waveform data** (e.g. peak envelope, 1–2 samples per pixel at default zoom) using **ffmpeg** `showwavespic` or **audio decode + downsample**; cache by `(media path hash, file mtime/size, analysis version)`.
- **API** e.g. `GET /api/media/:id/waveform` or `GET /api/waveform?path=...` returning JSON array or binary (Float32) + sample rate metadata.
- **Client** draws into **canvas** or SVG **inside** the clip rect in `timeline-canvas.js` (respect clip zoom, HiDPI `devicePixelRatio`).
- **No audio**: skip drawing or show flat line; **errors** (offline file): degrade gracefully.

---

## Tasks

### Phase 1: Subtle compose / timeline splitter

- [x] **T1.1** Locate the resize control between **compose stack** and **timeline** (DOM + CSS). Document selector in Work Log.
- [x] **T1.2** Reduce **visual thickness** (border, padding, background) of the splitter; keep **accessible hit target** (min ~6px touch/click).
- [x] **T1.3** Optional: add `cursor: row-resize` / `ns-resize` and hover state consistent with the rest of the app.

### Phase 2: Collapsible inspector + sources

- [x] **T2.1** Add **collapse toggles** for inspector and sources panels (icons + `aria-expanded`).
- [x] **T2.2** Persist **collapsed** flags in `localStorage` (per device).
- [x] **T2.3** When expanded, restore **last width** from Phase 1; when collapsed, reserve **0** or **icon-only** strip width (define one behavior and document).

### Phase 3: Resizable inspector (and sources width if applicable)

- [x] **T3.1** Implement **drag-to-resize** for inspector (min/max width constraints, e.g. 200–600px).
- [x] **T3.2** Persist **widths** in `localStorage` (same namespace as T2.2).
- [x] **T3.3** If sources panel is width-resizable, **share one pattern** (small shared module `web/lib/panel-resize.js` or similar) to avoid duplication.

### Phase 4: Trim preview — frame at current edit position

- [x] **T4.1** Map timeline trim gestures to **absolute time** (ms) for the **active handle** (in, out, or playhead during trim).
- [x] **T4.2** On trim drag / duration change, **seek preview** to that time (throttled); on release, **optional** fine seek.
- [x] **T4.3** Handle edge cases: **no video** (audio-only), **offline** media, **preview not ready** — show toast or last good frame.

### Phase 5: Waveform — server analysis + cache

- [x] **T5.1** Define **cache key** (path + stat mtime/size + `WAVEFORM_VERSION` constant).
- [x] **T5.2** Implement **ffmpeg/ffprobe** pipeline: detect audio stream; if none, return **JSON** `{ peaks: [], hasAudio: false }` (client hides strip).
- [x] **T5.3** Generate **peak buckets**; store under `data/waveforms/` (optional `waveform_cache_path` in server config).
- [x] **T5.4** Expose **REST** route; wire in `router.js`; add **rate limit** or debounce for bulk requests.

### Phase 6: Waveform — client draw on clip rects

- [x] **T6.1** Fetch waveform **once per clip** (or lazy when clip enters viewport); **memoize** in client.
- [x] **T6.2** Draw in **timeline clip** paint path (zoom/pan aware); **clip** to clip rect; **theme** colors (foreground/background).
- [x] **T6.3** When **trim** changes visible range, **slice** or **map** waveform samples to visible range.

---

## Technical Considerations

- **Performance**: Waveform generation must not block the event loop — use **worker** or **spawn** ffmpeg async; return **202 + poll** or **progress** if slow.
- **Security**: Waveform API must resolve paths **only** under configured **media roots** (same rules as `media`/`thumbnail` routes).
- **Privacy**: No user data in logs beyond relative paths.
- **Testing**: Manual: resize/collapse/restore; trim with long GOP H.264 (seek accuracy); waveform on stereo vs mono.

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| ffmpeg/ffprobe missing on host | Feature flag; graceful “no waveform” in UI |
| WebRTC preview cannot seek | Fallback to thumbnail-at-time or local `<video>` with file URL |
| Large media files | Cap analysis duration; stream decode only audio |

---

## Acceptance Criteria (Overall)

- [x] User can **resize** inspector; width **survives** reload.
- [x] User can **collapse** inspector and sources; state **survives** reload.
- [x] Compose/timeline splitter looks **visibly thinner** but remains **easy to grab**.
- [x] While **trimming** a video clip on the timeline, **preview** updates to show **approximately** the frame at the trim position.
- [x] Clips with **audio** show a **waveform** in the clip; **no audio** (ffprobe) — **no** strip (`hasAudio: false`); **audio-only** still gets waveform when ffmpeg decodes audio.

---

## Work Log

### 2026-04-08 — Work order created
**Work Done:**
- Created WO 21 with phased tasks (layout → trim preview → waveform pipeline).
- Aligned structure with existing WO protocol (`05`, `14`, etc.).

**Instructions for Next Agent:**
- Start with **Phase 1** (splitter) and **Phase 2** (collapse) — low risk, immediate UX win.
- Before waveform work, grep `routes-media` / `thumbnail` for existing **path allowlist** and reuse.
- After implementing, add a short “How to test” bullet list under this log entry.

### 2026-04-08 — Phases 1–4 (partial) implemented
**Work Done:**
- **`web/lib/workspace-layout.js`**: Collapsible Sources + Inspector (`«`/`»`), persisted widths (`--sources-panel-w`, `--inspector-panel-w`), resize handle **before** inspector (`#resize-inspector`), merged sources resize + persist (namespace `highascg.workspace.v1.*`).
- **`index.html`**: Header actions + collapse buttons; inspector resize handle between workspace and inspector.
- **`01-base-fonts-header-connection.css`**: Inspector width vars, collapsed 36px strip, consolidated side resize handles (1px line, hover accent), removed duplicate `.resize-handle` block.
- **`02-layout-workspace-tabs-preview.css`**: Thinner **Scenes** compose split (`scenes-split__handle`); **Timeline** preview vs tracks split (`tl-split-handle`) + `timeline-editor.js` drag + `casparcg_timeline_preview_split_px` LS; `fillParentHeight: true` on timeline preview panel.
- **`timeline-canvas.js` + `timeline-editor.js`**: `onClipResizePreview` — while trimming clip edges, seeks timeline (throttled) so **preview stack** matches trim edge time (WO 21 Phase 4).
- **`app.js`**: `initWorkspaceLayout()` replaces inline `initPanelResize`.

**How to test:** Reload app → drag Sources/Inspector edges; collapse panels; Scenes tab drag horizontal split (thinner bar); Timeline tab drag preview/tracks split; trim a clip edge and confirm preview updates with playhead at edge time.

**Instructions for Next Agent:**
- *(Superseded by log entry below.)*

### 2026-04-08 — Phase 5 waveform cache + `hasAudio`; Phase 6 client memo / no-audio
**Work Done:**
- **`src/media/local-media.js`**: `WAVEFORM_VERSION`; SHA-256 cache key (path + mtime + size + bars + version); JSON cache files under `data/waveforms/` (override via `waveform_cache_path` on server config); `ffprobe` sets `hasAudio` on successful probe; waveform handler skips ffmpeg when `hasAudio === false` and returns `{ peaks: [], hasAudio: false }`; cache hit avoids re-probe/re-encode.
- **`web/components/timeline-canvas-clip.js`**: Waveform strip hidden while loading; server **`no-audio`** cached as `'no-audio'` (no false waveform); fetch errors use synthetic bars; empty peak arrays use synthetic fallback.
- **`.gitignore`**: `data/waveforms/`.

**How to test:** Place a video **without** an audio stream — clip should show **no** bottom waveform strip after probe. Place a normal clip — strip appears; second load should be faster (disk cache). Delete `data/waveforms/` to force re-analysis.

**Instructions for Next Agent:**
- *(T6.3 completed in log entry below.)*
- *(T5.4 / T4.3 completed in “T4.3 preview edge cases + T5.4 waveform stagger” entry.)*

### 2026-04-08 — T6.3 waveform slice to trim / inPoint
**Work Done:**
- **`timeline-editor.js`**: `getSourceDurationMs(source)` resolves duration from the source object or `findMediaRow` + `stateStore` media list (same strategy as drop).
- **`timeline-canvas.js`**: Passes `getSourceDurationMs` into clip draw env.
- **`timeline-canvas-clip.js`**: `slicePeaksToTrim()` — maps full-file peak arrays onto `[inPoint→inPoint+duration]` using timeline `fps` (frames→ms), `clip.duration`, and file `sourceDurationMs`; resamples that window then existing `interpolatePeaks` → bar count. If duration is unknown, falls back to full peaks (unchanged).
- **Limitation**: Resizing the **left** clip edge does not yet advance `clip.inPoint` in the canvas pipeline, so the waveform still reflects **file-relative** trim only when `inPoint` is non-zero (e.g. future inspector edits). **Right-edge** trim (shorter clip, `inPoint` 0) shows the correct prefix of the envelope.

**How to test:** Shorten a clip from the **right** with known media duration in the list — waveform should compress to the **visible** portion of the file. Compare with a full-length clip on the same file.

**Instructions for Next Agent:**
- **T4.3**: Preview toasts / last frame for audio-only, offline, preview not ready.
- **T5.4**: Rate limit or debounce waveform GETs (optional).
- Optional: update **`onResizeClip`** / inspector to maintain **`inPoint`** when trimming the left edge so waveform + playback stay aligned.

### 2026-04-08 — T4.3 preview edge cases + T5.4 waveform stagger
**Work Done:**
- **`web/lib/media-audio-kind.js`**: `isLikelyAudioOnlySource` — CLS `type === audio` or common audio extensions.
- **`web/lib/waveform-fetch-queue.js`**: `enqueueWaveformFetch` — minimum ~55ms between **starts** of waveform GETs (reduces burst when many clips visible).
- **`timeline-canvas-clip.js`**: Skips video thumbnail fetch for audio-only sources; waveform `fetch` runs through the queue.
- **`preview-canvas-draw.js` (`drawTimelineStack`)**: Audio-only → gradient + label + decorative bars; thumbnail **loading** → “Loading…”; **failed** (offline / missing file) → “No preview”.
- **`timeline-editor.js`**: `showTimelineToast` + `notifyTimelineSeekFailed` (max once / 5s) on failed `POST .../seek` (ruler, trim preview, seek end).

**How to test:** Offline server → drag ruler or trim clip → red toast. Audio-only file in media list → timeline preview shows audio panel, not broken thumb. Many clips → waveform requests stagger in Network tab.

**Instructions for Next Agent:**
- Optional: **left-edge trim** updates **`inPoint`** in `onResizeClip` so waveform + Caspar SEEK stay aligned.
- Optional: WebRTC **live** preview “buffering” overlay (separate from canvas stack).

---

*Work Order created: 2026-04-08 | Parent: [`00_PROJECT_GOAL.md`](./00_PROJECT_GOAL.md) · Architecture index: [`PROJECT_BREAKDOWN.md`](./PROJECT_BREAKDOWN.md) · Related: `05_WO_LIVE_PREVIEW_SETTINGS.md` (preview), `06_WO_AUDIO_PLAYOUT.md` (audio)*
