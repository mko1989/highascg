# HighAsCG — Code Files Over 500 Lines

**Generated:** 2026-06-13  
**Repository root:** `/home/casparcg/highascg`

## Executive summary

| Metric | Count |
|--------|------:|
| Total files scanned (code + JSON) | 1,282 |
| Source code files scanned | 1,210 |
| **Application code files > 500 lines** | **7** |
| Vendor/third-party code > 500 lines (`lib/libcef_dll/`) | 29 |
| Reference copies > 500 lines (`work/references/`) | 6 |
| Data/config JSON > 500 lines | 15 |
| **All files > 500 lines (any category)** | **57** |

The HighAsCG application codebase is in good shape relative to the 500-line threshold. Only **7 first-party source files** exceed it. The bulk of oversized files are vendored CEF bindings (`lib/libcef_dll/`), saved project JSON, or reference material under `work/references/`.

### Application files over 500 lines (actionable)

| Lines | File | Type |
|------:|------|------|
| 1,180 | `client/tools/electron-launcher/style.css` | CSS |
| 610 | `client/tools/electron-launcher/index.html` | HTML |
| 522 | `template/led_grid_test.js` | JavaScript |
| 519 | `client/styles/09a-device-view-layout-destinations.css` | CSS |
| 508 | `scripts/lib/install-helpers.sh` | Shell |
| 507 | `client/components/pixel-map-editor.js` | JavaScript |
| 501 | `client/components/scenes-editor.js` | JavaScript |

**Total application lines over threshold:** 4,347

---

## Methodology

1. Recursive walk of the entire `highascg/` tree.
2. Line count = newline count per file (equivalent to `wc -l`).
3. Included extensions listed in Scope below.
4. Excluded dependency, cache, and build trees listed in Exclusions.

### Scope — included extensions

**Source code:** `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.vue`, `.svelte`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.swift`, `.kt`, `.kts`, `.c`, `.cpp`, `.h`, `.hpp`, `.cc`, `.rb`, `.php`, `.sh`, `.bash`, `.zsh`, `.css`, `.scss`, `.less`, `.html`, `.htm`

**Data (reported separately):** `.json`

### Exclusions

**Directory names (any depth):** `.git`, `node_modules`, `cef-cache`, `_media`, `dist`, `coverage`, `vendor`, `__pycache__`, `venv`, `.venv`, `.reference`

**Not excluded but categorized separately:**

- `lib/libcef_dll/` — vendored Chromium Embedded Framework C++ bindings
- `work/references/` — third-party/reference copies, not shipped application code
- `projects/` — operator project save files (JSON)

---

## Application code > 500 lines (detail)

### By top-level folder

| Files | Folder | Total lines |
|------:|--------|------------:|
| 5 | `client/` | 3,317 |
| 1 | `template/` | 522 |
| 1 | `scripts/` | 508 |

### By extension

| Files | Extension |
|------:|-----------|
| 3 | `.js` |
| 2 | `.css` |
| 1 | `.html` |
| 1 | `.sh` |

### Notes per file

- **`client/components/pixel-map-editor.js` (507)** — Largest application JS module; primary candidate for split if editor complexity grows.
- **`client/components/scenes-editor.js` (501)** — Just over threshold; scene composition UI.
- **`client/styles/09a-device-view-layout-destinations.css` (519)** — Device view layout CSS; consistent with other large style sheets in `client/styles/`.
- **`client/tools/electron-launcher/style.css` (1,180)** — Standalone Electron launcher tool; largest first-party file overall.
- **`client/tools/electron-launcher/index.html` (610)** — Launcher markup bundled with above.
- **`template/led_grid_test.js` (522)** — LED grid test template script.
- **`scripts/lib/install-helpers.sh` (508)** — Shared install helper library for deployment scripts.

---

## Near-miss: application code 400–500 lines

Files approaching the threshold — useful for proactive refactoring.

| Lines | File |
|------:|------|
| 494 | `src/api/routes-mixer.js` |
| 490 | `src/utils/gpu-topology-drm.js` |
| 488 | `client/components/inspector-panel-timeline.js` |
| 484 | `src/utils/os-layout-calculator.js` |
| 483 | `client/components/timeline-canvas.js` |
| 475 | `client/lib/timeline-state.js` |
| 473 | `client/components/preview-canvas-draw-stacks.js` |
| 470 | `src/caspar/amcp-client.js` |
| 465 | `client/components/scene-list.js` |
| 463 | `client/components/usb-import-modal.js` |
| 459 | `src/api/routes-scene.js` |
| 458 | `client/components/previs-pgm-3d.js` |
| 456 | `client/components/device-view-inspector-decklink.js` |
| 455 | `client/styles/01a-base-theme-header-connection.css` |
| 453 | `src/engine/timeline-playback-amcp.js` |
| 449 | `client/components/preview-canvas-panel.js` |
| 448 | `scripts/exfat/install-exfat-systemd-units.sh` |
| 446 | `client/lib/scene-state.js` |
| 446 | `client/components/device-view-bands-render.js` |
| 436 | `template/multiview_master.html` |

No file under `src/` currently exceeds 500 lines. The largest backend modules are `routes-mixer.js` (494) and `gpu-topology-drm.js` (490).

---

## Largest files by area (all sizes)

### `src/` — top 15 (none > 500)

| Lines | File |
|------:|------|
| 494 | `src/api/routes-mixer.js` |
| 490 | `src/utils/gpu-topology-drm.js` |
| 484 | `src/utils/os-layout-calculator.js` |
| 470 | `src/caspar/amcp-client.js` |
| 459 | `src/api/routes-scene.js` |
| 453 | `src/engine/timeline-playback-amcp.js` |
| 433 | `src/config/config-generator-audio-xml.js` |
| 430 | `src/utils/periodic-sync.js` |
| 429 | `src/api/router.js` |
| 428 | `src/osc/osc-state.js` |
| 425 | `src/config/build-caspar-generator-config.js` |
| 419 | `src/api/routes-multiview.js` |
| 415 | `src/api/routes-ingest.js` |
| 402 | `src/api/routes-streaming-channel.js` |
| 400 | `src/utils/gpu-modetest.js` |

### `client/` — top 15

| Lines | File |
|------:|------|
| 1,180 | `client/tools/electron-launcher/style.css` |
| 610 | `client/tools/electron-launcher/index.html` |
| 519 | `client/styles/09a-device-view-layout-destinations.css` |
| 507 | `client/components/pixel-map-editor.js` |
| 501 | `client/components/scenes-editor.js` |
| 488 | `client/components/inspector-panel-timeline.js` |
| 483 | `client/components/timeline-canvas.js` |
| 475 | `client/lib/timeline-state.js` |
| 473 | `client/components/preview-canvas-draw-stacks.js` |
| 465 | `client/components/scene-list.js` |
| 463 | `client/components/usb-import-modal.js` |
| 458 | `client/components/previs-pgm-3d.js` |
| 456 | `client/components/device-view-inspector-decklink.js` |
| 455 | `client/styles/01a-base-theme-header-connection.css` |
| 449 | `client/components/preview-canvas-panel.js` |

### `scripts/` — top 5

| Lines | File |
|------:|------|
| 508 | `scripts/lib/install-helpers.sh` |
| 448 | `scripts/exfat/install-exfat-systemd-units.sh` |
| 305 | `scripts/legacy/install-phase4.sh` |
| 235 | `scripts/legacy/install-phase1.sh` |
| 203 | `scripts/legacy/install-phase3.sh` |

### `tools/` — top 5

| Lines | File |
|------:|------|
| 389 | `tools/eggs/live-usb/add-exfat-data-partition.sh` |
| 383 | `tools/eggs/live-usb/legacy-persistence/add-union-persistence-partition.sh` |
| 360 | `tools/smoke/smoke-config-generator-routing.js` |
| 323 | `tools/smoke/smoke-mapping-gpu-os-layout.js` |
| 323 | `tools/smoke/highascg-health-api-amcp.test.js` |

---

## Vendor / third-party code > 500 lines

**Location:** `lib/libcef_dll/` (CEF C++ wrapper)  
**Count:** 29 files  
**Total lines:** 28,305

| Lines | File |
|------:|------|
| 1,906 | `lib/libcef_dll/ctocpp/views/window_ctocpp.cc` |
| 1,637 | `lib/libcef_dll/ctocpp/test/translator_test_ctocpp.cc` |
| 1,492 | `lib/libcef_dll/ctocpp/views/textfield_ctocpp.cc` |
| 1,350 | `lib/libcef_dll/ctocpp/browser_host_ctocpp.cc` |
| 1,308 | `lib/libcef_dll/ctocpp/views/menu_button_ctocpp.cc` |
| 1,276 | `lib/libcef_dll/ctocpp/views/label_button_ctocpp.cc` |
| 1,214 | `lib/libcef_dll/wrapper/cef_message_router.cc` |
| 1,190 | `lib/libcef_dll/ctocpp/menu_model_ctocpp.cc` |
| 1,187 | `lib/libcef_dll/ctocpp/views/panel_ctocpp.cc` |
| 1,171 | `lib/libcef_dll/ctocpp/v8_value_ctocpp.cc` |
| 1,104 | `lib/libcef_dll/ctocpp/test/api_version_test_ctocpp.cc` |
| 1,084 | `lib/libcef_dll/ctocpp/views/scroll_view_ctocpp.cc` |
| 1,065 | `lib/libcef_dll/ctocpp/views/browser_view_ctocpp.cc` |
| 1,049 | `lib/libcef_dll/ctocpp/views/button_ctocpp.cc` |
| 969 | `lib/libcef_dll/cpptoc/views/window_delegate_cpptoc.cc` |
| 966 | `lib/libcef_dll/ctocpp/views/view_ctocpp.cc` |
| 890 | `lib/libcef_dll/wrapper/libcef_dll_wrapper.cc` |
| 782 | `lib/libcef_dll/wrapper/cef_resource_manager.cc` |
| 763 | `lib/libcef_dll/ctocpp/dictionary_value_ctocpp.cc` |
| 666 | `lib/libcef_dll/ctocpp/request_context_ctocpp.cc` |
| 648 | `lib/libcef_dll/ctocpp/xml_reader_ctocpp.cc` |
| 628 | `lib/libcef_dll/cpptoc/views/browser_view_delegate_cpptoc.cc` |
| 626 | `lib/libcef_dll/cpptoc/render_handler_cpptoc.cc` |
| 596 | `lib/libcef_dll/ctocpp/list_value_ctocpp.cc` |
| 574 | `lib/libcef_dll/base/cef_logging.cc` |
| 566 | `lib/libcef_dll/ctocpp/drag_data_ctocpp.cc` |
| 556 | `lib/libcef_dll/ctocpp/domnode_ctocpp.cc` |
| 525 | `lib/libcef_dll/wrapper/cef_message_router_utils.cc` |
| 517 | `lib/libcef_dll/ctocpp/frame_ctocpp.cc` |

These are generated/vendored bindings and are not candidates for in-repo refactoring.

---

## Reference copies > 500 lines

**Location:** `work/references/show_creator/`  
**Count:** 6 files

| Lines | File |
|------:|------|
| 784 | `work/references/show_creator/ScreenSystem.tsx` |
| 741 | `work/references/show_creator/SceneViewer.tsx` |
| 618 | `work/references/show_creator/casparcg-connection-main/src/serializers.ts` |
| 607 | `work/references/show_creator/casparcg-connection-main/src/CasparCG.ts` |
| 552 | `work/references/show_creator/casparcg-connection-main/src/parameters.ts` |
| 531 | `work/references/show_creator/casparcg-connection-main/src/__tests__/connection.spec.ts` |

Reference material only; not part of the shipped runtime.

---

## Data / config JSON > 500 lines

| Lines | File | Notes |
|------:|------|-------|
| 1,669 | `package-lock.json` | npm lockfile |
| 1,410 | `config/.highascg-state.json` | Runtime state snapshot |
| 1,185 | `projects/moj1.json` | Saved project |
| 1,185 | `projects/_autosave/moj1.json` | Autosave copy |
| 1,088 | `data/gpu_database.json` | GPU hardware database |
| 992 | `.highascg-state.json` | Root state snapshot |
| 980 | `projects/tststs2.json` | Saved project |
| 980 | `projects/_autosave/tststs2.json` | Autosave copy |
| 803 | `projects/moj2.json` | Saved project |
| 803 | `projects/_autosave/moj2.json` | Autosave copy |
| 681 | `projects/mojtest.json` | Saved project |
| 681 | `projects/_autosave/mojtest.json` | Autosave copy |
| 678 | `projects/newtest8.json` | Saved project |
| 678 | `projects/_autosave/newtest8.json` | Autosave copy |
| 546 | `docs/wiki-site/manifest.json` | Wiki site manifest |

---

## Observations

1. **Backend (`src/`) is well-factored** — 233 JS modules, none over 500 lines; largest is `routes-mixer.js` at 494.
2. **Frontend concentration** — 5 of 7 oversized application files live under `client/`; two are the electron-launcher tool, two are CSS, two are editor components.
3. **CSS dominates line count** — The electron-launcher stylesheet alone is 1,180 lines (27% of all application lines over threshold).
4. **Install scripts** — `scripts/lib/install-helpers.sh` is a shared library-style shell script at 508 lines.
5. **Vendor noise** — Including `lib/libcef_dll/` inflates raw scan from 7 to 36 code files over 500 lines; always filter vendor trees for actionable audits.

## Suggested follow-ups (optional)

| Priority | Target | Rationale |
|----------|--------|-----------|
| Medium | `client/components/pixel-map-editor.js` | Largest app JS module; editor complexity |
| Medium | `client/components/scenes-editor.js` | Just over 500; scene UI |
| Low | `client/tools/electron-launcher/style.css` | Isolated tool; split only if maintaining launcher UI |
| Low | `scripts/lib/install-helpers.sh` | Could split by install phase if harder to navigate |
| Watch | `src/api/routes-mixer.js`, `src/utils/gpu-topology-drm.js` | Likely next to cross 500 with feature growth |

---

*Scan command: Python walk with extension filter and directory exclusions; line count via byte-level newline count.*
