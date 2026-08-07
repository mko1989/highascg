# Sweep 2: files over 500 lines (code / CSS / HTML)

**Project root:** `highascg/` (this repo)  
**Generated:** 2026-06-03  
**Git HEAD:** `3472dda` — *Fix GPU topology from DRM and protect project saves from stale clients.*  
**Rule:** Line count **> 500** (strictly greater than 500), counted with `wc -l`.  
**Prior sweep:** [`work/work-orders/sweep1.md`](work-orders/sweep1.md) (2026-05-18) reported **0** files over 500 under the app-only scan.

## Included extensions

`.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.vue`, `.css`, `.scss`, `.less`, `.html`, `.htm`, `.py`, `.sh`, `.bash`

## Excluded paths (pruned)

- `node_modules/`
- `.git/`
- `dist/`, `build/`, `coverage/`
- `cef-cache/` — CEF/Chromium cache artifacts (not maintained source)
- `deprecated/` — archived code

---

## Summary

| Metric | Value |
|--------|------:|
| **Source files scanned** | **618** |
| **Total lines (all scanned files)** | **120,411** |
| **Files > 500 lines (full scan)** | **10** |
| **Files > 500 lines (app surface)** | **6** |
| **Largest file** | `client/tools/electron-launcher/style.css` (1,180 lines) |

### By top-level folder (files > 500)

| Count | Total lines | Folder |
|------:|------------:|--------|
| 4 | 2,816 | `client/` |
| 4 | 2,682 | `src/` |
| 2 | 1,525 | `work/` |

### By extension (files > 500)

| Count | Extension |
|------:|-----------|
| 5 | `.js` |
| 2 | `.css` |
| 2 | `.tsx` |
| 1 | `.html` |

---

## Findings — all files > 500 lines

Sorted by line count, descending.

| Lines | Path | Notes |
|------:|------|-------|
| 1,180 | `client/tools/electron-launcher/style.css` | Electron launcher UI stylesheet; standalone tool |
| 949 | `src/artnet/artnet-receiver.js` | Art-Net DMX receiver; **largest maintained runtime module** |
| 784 | `work/references/show_creator/ScreenSystem.tsx` | Reference / design prototype (not shipped runtime) |
| 741 | `work/references/show_creator/SceneViewer.tsx` | Reference / design prototype (not shipped runtime) |
| 644 | `src/system/exfat-sync.js` | exFAT sync engine (grew since sweep1 watchlist at 481) |
| 610 | `client/tools/electron-launcher/index.html` | Electron launcher shell HTML |
| 546 | `src/media/local-media.js` | Local media library + ingest helpers (was 491 in sweep1) |
| 543 | `src/config/defaults.js` | Default config schema / values (was 485 in sweep1) |
| 519 | `client/styles/09a-device-view-layout-destinations.css` | Device View layout CSS (was 496 in sweep1) |
| 507 | `client/components/pixel-map-editor.js` | Pixel map editor component |

---

## App surface only (primary maintenance target)

Excludes `work/references/`, `cef-cache/`, and `client/tools/electron-launcher/`.

| Lines | Path | Δ vs sweep1 watchlist |
|------:|------|----------------------|
| 949 | `src/artnet/artnet-receiver.js` | *(not on sweep1 watchlist)* |
| 644 | `src/system/exfat-sync.js` | +163 (was 481) |
| 546 | `src/media/local-media.js` | +55 (was 491) |
| 543 | `src/config/defaults.js` | +58 (was 485) |
| 519 | `client/styles/09a-device-view-layout-destinations.css` | +23 (was 496) |
| 507 | `client/components/pixel-map-editor.js` | *(not on sweep1 watchlist)* |

**Regressions since sweep1:** Six files crossed the 500-line threshold. The largest new offender is `artnet-receiver.js` at 949 lines. exFAT sync, defaults, local-media, and device-view CSS also grew into violation territory.

---

## Grouped interpretation

### High priority — runtime `src/` (4 files)

| Lines | Path | Suggested split axis |
|------:|------|----------------------|
| 949 | `src/artnet/artnet-receiver.js` | Packet parsing vs channel mapping vs socket lifecycle |
| 644 | `src/system/exfat-sync.js` | Sync policy / mtime logic vs filesystem walk vs boot hooks |
| 546 | `src/media/local-media.js` | Scan/index vs thumbnail/probe vs API-facing helpers |
| 543 | `src/config/defaults.js` | Schema sections by domain (audio, GPU, scenes, storage) |

### Medium priority — browser `client/` (2 files)

| Lines | Path | Suggested split axis |
|------:|------|----------------------|
| 519 | `client/styles/09a-device-view-layout-destinations.css` | Split by band/destination type or extract shared tokens |
| 507 | `client/components/pixel-map-editor.js` | Canvas draw vs interaction vs persistence |

### Lower priority — tools & reference

| Lines | Path | Rationale |
|------:|------|-----------|
| 1,180 | `client/tools/electron-launcher/style.css` | Standalone launcher; split only if actively edited |
| 610 | `client/tools/electron-launcher/index.html` | Paired with launcher CSS |
| 784 | `work/references/show_creator/ScreenSystem.tsx` | Reference material under `work/` |
| 741 | `work/references/show_creator/SceneViewer.tsx` | Reference material under `work/` |

---

## Watchlist — approaching threshold (430–500 lines)

Largest files under `src/`, `client/`, and `template/` that have **not** yet crossed 500. Rerun before refactoring.

| Lines | Path |
|------:|------|
| 496 | `client/components/scenes-editor.js` |
| 494 | `src/api/routes-mixer.js` |
| 491 | `template/led_grid_test.js` |
| 488 | `client/components/inspector-panel-timeline.js` |
| 480 | `src/utils/os-layout-calculator.js` |
| 477 | `client/components/timeline-canvas.js` |
| 475 | `client/lib/timeline-state.js` |
| 473 | `client/components/preview-canvas-draw-stacks.js` |
| 465 | `client/components/scene-list.js` |
| 463 | `client/components/usb-import-modal.js` |
| 459 | `src/api/routes-scene.js` |
| 458 | `client/components/previs-pgm-3d.js` |
| 456 | `client/components/device-view-inspector-decklink.js` |
| 455 | `client/styles/01a-base-theme-header-connection.css` |
| 449 | `client/components/preview-canvas-panel.js` |
| 446 | `client/lib/scene-state.js` |
| 446 | `client/components/device-view-bands-render.js` |
| 436 | `template/multiview_master.html` |
| 436 | `client/components/audio-mixer-panel.js` |
| 435 | `client/components/inspector-pip-overlay.js` |
| 434 | `client/lib/previs-state.js` |
| 433 | `src/config/config-generator-audio-xml.js` |
| 430 | `src/utils/periodic-sync.js` |

**Nearest to crossing:** `scenes-editor.js` (496), `routes-mixer.js` (494), `led_grid_test.js` (491).

---

## Methodology

```bash
find . -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \
  -o -name '*.ts' -o -name '*.tsx' -o -name '*.jsx' -o -name '*.vue' \
  -o -name '*.css' -o -name '*.scss' -o -name '*.less' \
  -o -name '*.html' -o -name '*.htm' -o -name '*.py' \
  -o -name '*.sh' -o -name '*.bash' \) \
  ! -path './node_modules/*' ! -path './.git/*' \
  ! -path './dist/*' ! -path './build/*' ! -path './coverage/*' \
  ! -path './cef-cache/*' ! -path './deprecated/*' \
  -print0 | xargs -0 wc -l | sort -rn
```

JSON config files (e.g. `package-lock.json`, `highascg.config.json`) are intentionally excluded — they are data, not code modules.

---

## Recommended next actions

1. **Split `src/artnet/artnet-receiver.js`** — single largest violation; likely highest ROI.
2. **Split `src/system/exfat-sync.js`** — recent exFAT refactor added substantial logic; natural boundary after boot vs sync-on-save paths.
3. **Watch `scenes-editor.js` and `routes-mixer.js`** — both within 6 lines of the limit; split preemptively or trim dead code.
4. **Re-run this sweep** after each modularization PR; update as `work/sweep3.md`.
