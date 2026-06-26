# HighAsCG codebase audit — line-count report

**Date:** 2026-06-25  
**Repo:** `/home/casparcg/highascg` (unified backend + frontend)  
**Rule audited:** files exceeding **500 lines**

---

## Executive summary

| Scope | Files scanned | Over 500 lines | Worst offender |
|-------|--------------:|---------------:|----------------|
| **Production code** (backend + frontend + templates + tools + scripts) | 985 | **26** | `client/lib/device-view-gpu-port-list.js` (**1,170** lines) |
| Backend (`src/`) | 290 | **3** | `src/utils/os-layout-calculator.js` (664) |
| Frontend (`client/`) | 386 | **17** | `client/lib/device-view-gpu-port-list.js` (1,170) |
| Templates (`template/`) | 38 | **3** | `template/lower-thirds/lt-engine.js` (578) |
| Tools (`tools/`) | 169 | **2** | `tools/smoke/smoke-mapping-gpu-os-layout.js` (674) |
| Scripts (`scripts/`) | 79 | **1** | `scripts/lib/install-helpers.sh` (518) |

**Verdict:** The **500-line limit is violated in 26 production code files**. The problem is concentrated in the **frontend** (17 files, 65% of violations). The backend is comparatively healthy (3 violations). Main operator HTML shells (`client/index.html`, `client/setup.html`) are well under the limit; the only oversized HTML is the Electron launcher hub page.

**Near limit (450–500 lines):** 18 additional production files — mostly large API route modules and inspector/canvas components. These are likely to cross 500 lines on the next feature pass.

---

## Methodology

### Included

- **Backend:** all `src/**/*.js`
- **Frontend:** all `client/**/*.js`, `client/**/*.html`, `client/**/*.css`
- **Templates:** Caspar HTML/JS under `template/`
- **Tooling:** `tools/**/*.js`, `scripts/**/*.sh`
- **Repo root:** `index.js`, `vite.config.js`

### Excluded (not source-of-truth code)

| Excluded | Reason |
|----------|--------|
| `node_modules/`, `dist-web/`, `dist/`, `cef-cache/` | Dependencies / build output |
| `projects/`, `.highascg-state.json` | Runtime project data (many files 1,000–2,000+ lines) |
| `docs/wiki-site/` | Generated wiki bundle |
| `*.sync-conflict-*` | Editor merge artefacts |
| `work/references/` | Vendored reference clones (TypeScript/React/CasparCG connection) |
| `package-lock.json` | Lockfile |

### How counts were produced

```bash
# Line count per file; UTF-8; blank lines included
find … -type f \( -name '*.js' -o -name '*.html' -o -name '*.css' … \) | xargs wc -l
```

Counts are **physical lines** (including comments and blanks), not logical LOC.

---

## Backend (`src/`) — 290 JS files

**Over 500 lines: 3 files (1.0%)**

| Lines | File | Notes |
|------:|------|-------|
| 664 | `src/utils/os-layout-calculator.js` | GPU/xrandr layout math — prime split candidate |
| 559 | `src/audio/alsa-mixer.js` | ALSA mixer API surface |
| 544 | `src/config/build-caspar-generator-config.js` | Caspar XML generator orchestration |

### Near limit (450–500) — 6 backend files

| Lines | File |
|------:|------|
| 494 | `src/api/routes-mixer.js` |
| 486 | `src/api/routes-scene.js` |
| 483 | `src/utils/gpu-topology-drm.js` |
| 478 | `src/api/router.js` |
| 470 | `src/caspar/amcp-client.js` |
| 463 | `src/osc/osc-state.js` |

### Backend health

- Average file size: **178 lines**
- Largest API router pieces are approaching the limit but still manageable
- **Cleanup note:** `src/api/router.sync-conflict-20260624-090423-ED7RF3B.js` (459 lines) is a stale sync-conflict duplicate of `router.js` — safe to delete

### Suggested backend splits

| File | Suggested decomposition |
|------|-------------------------|
| `os-layout-calculator.js` | Split into `layout-parse.js`, `layout-apply.js`, `layout-validate.js` |
| `alsa-mixer.js` | Split route handlers vs low-level ALSA IO |
| `build-caspar-generator-config.js` | Already has submodules (`config-generator-*.js`); move remaining blocks out |

---

## Frontend (`client/`) — 386 code files

Breakdown: **301 JS**, **54 CSS**, **4 HTML** (operator + launcher), plus launcher tooling.

**Over 500 lines: 17 files (4.4%)**

### JavaScript (13 files over limit)

| Lines | File | Area |
|------:|------|------|
| **1,170** | `client/lib/device-view-gpu-port-list.js` | Device View — **2.3× limit** |
| 696 | `client/assets/modules/cg-studio/cg-studio-editor.js` | CG Studio module |
| 610 | `client/tools/electron-launcher/renderer.js` | Electron hub |
| 609 | `client/components/preview-canvas-panel.js` | Preview canvas |
| 564 | `client/components/device-view.js` | Device View shell |
| 546 | `client/components/inspector-lower-third.js` | Lower-thirds inspector |
| 546 | `client/components/audio-mixer-panel.js` | Audio mixer |
| 539 | `client/components/device-view-inspector-gpu-video-modeline.js` | GPU modeline inspector |
| 532 | `client/components/audio-mixer-view-console.js` | Audio console view |
| 519 | `client/lib/timeline-state.js` | Timeline state machine |
| 516 | `client/components/scenes-editor.js` | Scenes editor |
| 508 | `client/components/timeline-canvas.js` | Timeline canvas |
| 504 | `client/components/device-view-inspector-decklink.js` | DeckLink inspector (WO-55) |

### CSS (3 files over limit)

| Lines | File | Notes |
|------:|------|-------|
| 634 | `client/styles/08c-modals-misc.css` | Modals + misc UI chrome |
| 522 | `client/styles/06c-inspector-effects-pip.css` | Inspector effects / PiP |
| 505 | `client/styles/01a-base-theme-header-connection.css` | Base theme + header |

Total CSS across `client/styles/`: **9,547 lines** in 54 files (avg 177). Only 3 exceed 500; the stylesheet set is already split by feature prefix (`01a`, `06c`, `08c`, `09b`, etc.).

### HTML (1 file over limit)

| Lines | File | Notes |
|------:|------|-------|
| 562 | `client/tools/electron-launcher/index.html` | Electron hub shell (inline structure) |

**Operator UI HTML is fine:**

| Lines | File |
|------:|------|
| 120 | `client/index.html` |
| 89 | `client/setup.html` |

### Near limit (450–500) — 10 frontend files

| Lines | File |
|------:|------|
| 497 | `client/components/scene-list.js` |
| 496 | `client/components/inspector-panel-timeline.js` |
| 478 | `client/lib/device-view-gpu-layout-debug.js` |
| 478 | `client/components/preview-canvas-draw-stacks.js` |
| 463 | `client/lib/scene-state.js` |
| 463 | `client/components/usb-import-modal.js` |
| 458 | `client/components/previs-pgm-3d.js` |
| 455 | `client/lib/project-hardware-mismatch.js` |
| 452 | `client/components/preview-canvas-draw-base.js` |
| 452 | `client/components/inspector-panel.js` |

### Suggested frontend splits (priority order)

1. **`device-view-gpu-port-list.js` (1,170)** — highest priority. Likely contains static port metadata tables; extract data to JSON/`assets/` and keep rendering logic separate.
2. **`preview-canvas-panel.js` + draw-* siblings** — consolidate canvas drawing into a small core + per-mode plugins.
3. **`device-view.js` + inspector-* modules** — already partially split; continue extracting inspector panels.
4. **`08c-modals-misc.css`** — split into `08c-modals-*.css` per modal family (settings, logs, USB import, etc.).
5. **`timeline-state.js` + `timeline-canvas.js`** — separate state transitions from DOM/canvas rendering.

---

## Templates (`template/`) — 38 code files

**Over 500 lines: 3 files**

| Lines | File | Notes |
|------:|------|-------|
| 578 | `template/lower-thirds/lt-engine.js` | Production LT engine |
| 556 | `template/lower-thirds/lt-engine-from-client/lt-engine copy.js` | **Duplicate copy — candidate for removal** |
| 522 | `template/led_grid_test.js` | Test template |

Near limit: `template/lower-thirds/lt-engine-from-client/lt-engine.js` (455 lines).

---

## Tools & scripts

| Lines | File | Area |
|------:|------|------|
| 674 | `tools/smoke/smoke-mapping-gpu-os-layout.js` | Smoke test |
| 534 | `tools/smoke/smoke-config-generator-routing.js` | Smoke test |
| 518 | `scripts/lib/install-helpers.sh` | Install helpers |

Smoke tests are allowed to be large, but these two routing/GPU smokes are good candidates to split by scenario (`describe`/`test` blocks → separate files).

---

## Repo root

| Lines | File | Status |
|------:|------|--------|
| 438 | `vite.config.js` | Under limit |
| 298 | `index.js` | Under limit |

---

## Work folder & documentation (informational)

Not counted as production code, but **15 markdown files** under `work/` exceed 500 lines (work orders, migration guides). Largest:

| Lines | File |
|------:|------|
| 1,189 | `work/work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md` |
| 1,113 | `work/work-orders/01_WO_ANALYZE_MODULE.md` |
| 1,075 | `work/WO_CASPARCG_CONNECTION_MIGRATION.md` |

`work/references/` contains **6 TypeScript/reference files** over 500 lines — vendored third-party code, not HighAsCG production sources.

---

## Violations summary table (production code only)

| # | Lines | Type | Path |
|--|------:|------|------|
| 1 | 1,170 | JS | `client/lib/device-view-gpu-port-list.js` |
| 2 | 696 | JS | `client/assets/modules/cg-studio/cg-studio-editor.js` |
| 3 | 674 | JS | `tools/smoke/smoke-mapping-gpu-os-layout.js` |
| 4 | 664 | JS | `src/utils/os-layout-calculator.js` |
| 5 | 634 | CSS | `client/styles/08c-modals-misc.css` |
| 6 | 610 | JS | `client/tools/electron-launcher/renderer.js` |
| 7 | 609 | JS | `client/components/preview-canvas-panel.js` |
| 8 | 578 | JS | `template/lower-thirds/lt-engine.js` |
| 9 | 564 | JS | `client/components/device-view.js` |
| 10 | 562 | HTML | `client/tools/electron-launcher/index.html` |
| 11 | 559 | JS | `src/audio/alsa-mixer.js` |
| 12 | 556 | JS | `template/lower-thirds/lt-engine-from-client/lt-engine copy.js` |
| 13 | 546 | JS | `client/components/inspector-lower-third.js` |
| 14 | 546 | JS | `client/components/audio-mixer-panel.js` |
| 15 | 544 | JS | `src/config/build-caspar-generator-config.js` |
| 16 | 539 | JS | `client/components/device-view-inspector-gpu-video-modeline.js` |
| 17 | 534 | JS | `tools/smoke/smoke-config-generator-routing.js` |
| 18 | 532 | JS | `client/components/audio-mixer-view-console.js` |
| 19 | 522 | JS | `template/led_grid_test.js` |
| 20 | 522 | CSS | `client/styles/06c-inspector-effects-pip.css` |
| 21 | 519 | JS | `client/lib/timeline-state.js` |
| 22 | 518 | SH | `scripts/lib/install-helpers.sh` |
| 23 | 516 | JS | `client/components/scenes-editor.js` |
| 24 | 508 | JS | `client/components/timeline-canvas.js` |
| 25 | 505 | CSS | `client/styles/01a-base-theme-header-connection.css` |
| 26 | 504 | JS | `client/components/device-view-inspector-decklink.js` |

---

## Recommendations

### Immediate (hygiene)

1. **Delete stale artefacts:** `src/api/router.sync-conflict-*.js`, `template/lower-thirds/lt-engine-from-client/lt-engine copy.js`, and other `*.sync-conflict-*` files under `template/` and `src/`.
2. **Add a CI/lint guard:** e.g. `scripts/check-max-file-lines.sh 500` on `src/`, `client/`, `template/` (exclude `tools/smoke/` or use a higher cap for tests).

### Short term (reduce violations)

1. Split **`device-view-gpu-port-list.js`** — single biggest offender at 2.3× the limit.
2. Split the **3 oversized CSS** files along existing naming conventions (`08c`, `06c`, `01a`).
3. Extract **preview canvas** drawing helpers from `preview-canvas-panel.js` into `preview-canvas-draw-*.js` (pattern already started).

### Medium term (prevent regression)

1. Enforce **500-line soft limit** in code review for `client/components/` and `client/lib/`.
2. Keep **backend route files** (`routes-*.js`) under 450 lines — split by resource when adding endpoints.
3. Document the limit in `work/` or `.cursor/rules` so agents respect it during WO work.

---

## Architecture notes (context for this audit)

| Path | Role |
|------|------|
| `src/` | Node API, Caspar bridge, config generator, device-view snapshot |
| `client/` | Canonical operator UI (ES modules + CSS); builds to `dist-web/` |
| `template/` | Caspar HTML templates served at `/templates/` |
| `tools/smoke/` | Integration/smoke tests (large files acceptable but splittable) |
| `client/tools/electron-launcher/` | Optional Electron hub (packaged separately as highascg-client) |

---

*Generated by automated line-count audit on the playout host.*
