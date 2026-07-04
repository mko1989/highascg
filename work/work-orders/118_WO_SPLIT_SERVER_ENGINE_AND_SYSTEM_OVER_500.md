# WO-118 — Split server engine & system files over 500 lines

> **⚠️ AGENT COLLABORATION PROTOCOL** — see [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)

**Parent:** [WO-111](./111_WO_FILE_SIZE_500_LIMIT.md)  
**Status:** Done (server/system scope)  
**Priority:** **Medium**

**Touches:** `src/system/`, `src/engine/`, `src/audio/`, `src/media/`

---

## 1. Problem

| Lines | File |
|------:|------|
| 768 | `src/system/cef-interactive-bridge.js` |
| 719 | `src/utils/x-display-session.js` |
| 563 | `src/engine/project-scenes.js` |
| 559 | `src/audio/alsa-mixer.js` |
| 558 | `src/engine/timeline-playback-amcp.js` |
| 513 | `src/media/live-thumbnail-cache.js` |

---

## 2. Split plan

### 2.1 `cef-interactive-bridge.js` (768)

| New module | Responsibility |
|------------|----------------|
| `cef-interactive-bridge-cdp.js` | CDP attach, command dispatch |
| `cef-interactive-bridge-input.js` | mouse/keyboard/focus routing |
| `cef-interactive-bridge-host.js` | host lifecycle, template URL registry |

Run live tests: `npm run test:highascg:live:cef` after split.

### 2.2 `x-display-session.js` (719)

| New module | Responsibility |
|------------|----------------|
| `x-display-session-probe.js` | DISPLAY probe, xdpyinfo parsing |
| `x-display-session-layout.js` | screen layout, GPU head mapping |
| `x-display-session-apply.js` | xrandr apply orchestration |

### 2.3 `project-scenes.js` (563)

| New module | Responsibility |
|------------|----------------|
| `project-scenes-load.js` | load, merge, enrich from live deck |
| `project-scenes-persist.js` | persist, slug retire, validation |
| `project-scenes-transform.js` | scene normalization helpers |

### 2.4 `alsa-mixer.js` (559)

| New module | Responsibility |
|------------|----------------|
| `alsa-mixer-enumerate.js` | card/device list |
| `alsa-mixer-controls.js` | amixer control get/set |
| `alsa-mixer-map.js` | channel → ALSA control mapping |

### 2.5 `timeline-playback-amcp.js` (558)

| New module | Responsibility |
|------------|----------------|
| `timeline-playback-schedule.js` | cue scheduling, frame math |
| `timeline-playback-amcp-send.js` | AMCP command batching for timeline |

### 2.6 `live-thumbnail-cache.js` (513)

| New module | Responsibility |
|------------|----------------|
| `live-thumbnail-cache-store.js` | disk/memory cache keys |
| `live-thumbnail-cache-ffmpeg.js` | ffmpeg snapshot spawn |

---

## 3. Tasks

- [x] **T118.0** Split CEF bridge; live CEF smokes pass.
- [x] **T118.1** Split x-display-session; GPU layout smokes pass.
- [x] **T118.2** Split project-scenes + timeline-playback-amcp.
- [x] **T118.3** Split alsa-mixer + live-thumbnail-cache.
- [x] **T118.4** All six originals ≤ 500 lines.

---

## 4. Verification

```bash
npm run lint
npm run test:ci
npm run test:highascg:live:cef   # if CEF available
npm run test:gpu-topology
```

---

## Work Log

### 2026-07-03 — Created

- **Instructions for Next Agent:** Split `project-scenes.js` before CEF — no live hardware dependency.

### 2026-07-03 — project-scenes + timeline-playback-amcp

| File | Before | After |
|------|-------:|------:|
| `project-scenes.js` | 568 | 7 (re-export hub) |
| `timeline-playback-amcp.js` | 559 | 6 (re-export hub) |

**project-scenes children:** `-load`, `-transform`, `-persist`  
**timeline-playback-amcp children:** `-schedule` (frame/mixer keyframes), `-send` (PLAY/LOAD/SEEK transport)

`check:file-lines` — 18 files remain over 500 (down from 20 after WO-115 + these two).

### 2026-07-03 — alsa-mixer + live-thumbnail-cache

| File | Before | After |
|------|-------:|------:|
| `alsa-mixer.js` | 560 | 10 (hub) |
| `live-thumbnail-cache.js` | 514 | 13 (hub) |

**alsa-mixer children:** `-enumerate`, `-controls`  
**live-thumbnail-cache children:** `-store`, `-capture`, `-handlers`

`check:file-lines` — 16 files remain over 500.

### 2026-07-03 — cef-interactive-bridge + x-display-session

| File | Before | After |
|------|-------:|------:|
| `cef-interactive-bridge.js` | 770 | 13 (hub) |
| `x-display-session.js` | 720 | 7 (hub) |

**cef-interactive-bridge children:** `-shared`, `-zones`, `-events`, `-lifecycle`  
**x-display-session children:** `-layout`, `-runtime`

`check:file-lines` — 7 files remain over 500 (all WO-120: launcher, templates, scripts).
