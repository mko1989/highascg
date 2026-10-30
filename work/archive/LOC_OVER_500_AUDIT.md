# Code files larger than 500 lines — repository audit

**Generated:** 2026-04-16  
**Repository root:** `companion-module-dev`  

## Executive summary

| Metric | Value |
|--------|------:|
| Files &gt; 500 lines (raw scan, incl. `micropython/`) | ~6940 |
| Files &gt; 500 lines (this report, exclusions below) | **156** |

## Methodology

1. Walk the repository recursively.
2. Count newline-terminated lines per file (same as `wc -l`).
3. Include common source extensions (see Scope).
4. Exclude dependency/build trees and generated artifacts (see Scope).

## Scope

**Included extensions:** `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.vue`, `.svelte`, `.py`, `.go`, `.rs`, `.java`, `.cs`, `.swift`, `.kt`, `.kts`, `.c`, `.cpp`, `.h`, `.hpp`, `.cc`, `.rb`, `.php`, `.sh`, `.bash`, `.zsh`

**Excluded directory names (any depth):** `node_modules`, `.git`, `dist`, `build`, `.next`, `coverage`, `vendor`, `__pycache__`, `venv`, `.venv`

**Excluded paths:**

- **`micropython/`** — third-party firmware/SDK tree (dominates line count; not application code).
- **`**/venv/**`** — Python virtual environments (e.g. NumPy, pip).
- **Yarn PnP** — `.pnp.js`, `.pnp.cjs`, `.pnp.loader.mjs` (generated).

## Summary — files &gt; 500 lines (filtered)

### By top-level folder

| Count | Folder |
|------:|--------|
| 55 | `companion-module-highpass-accompaniment_v2/` |
| 19 | `companion-surface-highpass-controller/` |
| 17 | `companion-surface-chinese-controller/` |
| 17 | `companion-module-casparcg-server/` |
| 7 | `Avonic CM93/` |
| 6 | `companion-module-bosch-dcn/` |
| 6 | `companion-module-resolume-arena-master/` |
| 3 | `companion-module-avonic-cm93/` |
| 3 | `companion-module-highpass-accompaniment-builtin/` |
| 3 | `companion-module-highpass-countdown/` |
| 3 | `companion-module-roland-vr400uhd/` |
| 3 | `companion-module-novastar-splicer-main/` |
| 3 | `HighAsCG/` |
| 2 | `companion-module-avstumpfl-pixera-master/` |
| 2 | `companion-module-base-main/` |
| 1 | `companion-module-generic-onvif-main/` |
| 1 | `companion-module-bosch-dicentis-main/` |
| 1 | `companion-module-getontime-ontime-main/` |
| 1 | `companion-module-anomes-millumin-master/` |
| 1 | `companion-module-pixelhue-switcher-main 2/` |
| 1 | `companion-module-cvmeventi-countdown/` |
| 1 | `companion-module-novastar-controller-master/` |

## HighAsCG

**Count:** 3

| Lines | Path |
|------:|------|
| 557 | `HighAsCG/client/components/preview-canvas-panel.js` |
| 525 | `HighAsCG/index.js` |
| 503 | `HighAsCG/client/app.js` |

## `companion-*` modules and surfaces

**Count:** 146

| Lines | Path |
|------:|------|
| 4935 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/st7789/png/miniz.c` |
| 4935 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/st7789/png/miniz.c` |
| 4596 | `companion-module-bosch-dcn/DcnApiDemonstrator/Sources/ApiDemonstratorMainForm.cs` |
| 4244 | `companion-module-avstumpfl-pixera-master/src/actions.js` |
| 2703 | `companion-module-bosch-dcn/DcnApiDemonstrator/Sources/ApiDemonstratorMainForm.Designer.cs` |
| 2586 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/examples/chango/chango_64.py` |
| 2586 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/examples/chango/chango_64.py` |
| 2574 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/st7789/st7789.c` |
| 2574 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/st7789/st7789.c` |
| 2119 | `companion-surface-highpass-controller/highpass_controller/STM32_Lib_TFT_ST7789-master/st7789/st7789.c` |
| 1706 | `companion-module-resolume-arena-master/src/domain/api.ts` |
| 1599 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/examples/mono_fonts/inconsolata_64.py` |
| 1599 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/examples/mono_fonts/inconsolata_64.py` |
| 1400 | `companion-module-highpass-accompaniment_v2/gui/ui/waveformExpanded.js` |
| 1399 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui/waveformExpanded.js` |
| 1399 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/ui/waveformExpanded.js` |
| 1399 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui/waveformExpanded.js` |
| 1399 | `companion-module-highpass-accompaniment_v2/pkg/gui/ui/waveformExpanded.js` |
| 1315 | `companion-module-avonic-cm93/src/actions.js` |
| 1302 | `companion-module-casparcg-server/src/client/components/inspector-panel.js` |
| 1230 | `companion-module-highpass-accompaniment-builtin/companion-module-highpass-countdown/src/timer.js` |
| 1230 | `companion-module-base-main/src/internal/__tests__/feedback.spec.ts` |
| 1230 | `companion-module-highpass-countdown/src/timer.js` |
| 1209 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/ui/waveformControls.js` |
| 1209 | `companion-module-highpass-accompaniment_v2/gui/ui/waveformControls.js` |
| 1209 | `companion-module-highpass-accompaniment_v2/pkg/gui/ui/waveformControls.js` |
| 1155 | `companion-module-avonic-cm93/companion-module-generic-onvif-main/src/actions.js` |
| 1155 | `companion-module-generic-onvif-main/src/actions.js` |
| 1150 | `companion-module-casparcg-server/Server_tools/casparcg_setup.sh` |
| 1132 | `companion-module-resolume-arena-master/src/actions/osc-transport/oscTransportActions.ts` |
| 1125 | `companion-module-casparcg-server/src/client/components/scenes-editor.js` |
| 1106 | `companion-module-casparcg-server/src/api-routes.js` |
| 1106 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui/cueGrid.js` |
| 1049 | `companion-module-avstumpfl-pixera-master/src/Pixera.js` |
| 1016 | `companion-module-bosch-dcn/DcnApiDemonstrator/Sources/Delegate.Designer.cs` |
| 958 | `companion-module-bosch-dicentis-main/main.js` |
| 952 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/st7789/jpg/tjpgd565.c` |
| 952 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/st7789/jpg/tjpgd565.c` |
| 945 | `companion-module-roland-vr400uhd/src/internal/__tests__/feedback.spec.ts` |
| 912 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/st7789/png/pngle.c` |
| 912 | `companion-module-getontime-ontime-main/src/presets.ts` |
| 912 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/st7789/png/pngle.c` |
| 911 | `companion-surface-highpass-controller/highpass_controller/STM32_Lib_TFT_ST7789-master/st7789/fonts.c` |
| 903 | `companion-module-avonic-cm93/src/presets.js` |
| 902 | `companion-module-highpass-accompaniment_v2/gui/audio/audioController.js` |
| 899 | `companion-module-novastar-splicer-main/src/presets.js` |
| 882 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui/waveformControls.js` |
| 882 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui/waveformControls.js` |
| 835 | `companion-module-novastar-splicer-main/src/actions.js` |
| 821 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/audio/audioController.js` |
| 821 | `companion-module-highpass-accompaniment_v2/pkg/gui/audio/audioController.js` |
| 820 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/lib/axp202c.py` |
| 820 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/lib/axp202c.py` |
| 815 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/ui/cueGrid.js` |
| 815 | `companion-module-highpass-accompaniment_v2/pkg/gui/ui/cueGrid.js` |
| 808 | `companion-module-casparcg-server/Caspar_amcp_guide/_themes/basic/static/websupport.js` |
| 808 | `companion-module-casparcg-server/Caspar_amcp_guide/_themes/default/basic/static/websupport.js` |
| 807 | `companion-module-highpass-accompaniment_v2/gui/ui/cueGrid.js` |
| 807 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/audioController.js` |
| 792 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/examples/pinball.py` |
| 792 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/examples/pinball.py` |
| 789 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/backend/cueManager.js` |
| 775 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/audioController.js` |
| 766 | `companion-module-anomes-millumin-master/src/presets.ts` |
| 751 | `companion-module-resolume-arena-master/src/osc-state.ts` |
| 746 | `companion-module-bosch-dcn/companion-module-bosch-dcn/main.js` |
| 738 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/main/ipcHandlers.js` |
| 736 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/backend/websocketManager.js` |
| 723 | `companion-module-pixelhue-switcher-main 2/src/actions.ts` |
| 720 | `companion-module-highpass-accompaniment_v2/gui/ui/waveformCore.js` |
| 718 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/ui/waveformCore.js` |
| 718 | `companion-module-highpass-accompaniment_v2/pkg/gui/ui/waveformCore.js` |
| 716 | `companion-module-resolume-arena-master/src/domain/layer-groups/layer-group-util.ts` |
| 706 | `companion-module-roland-vr400uhd/src/module-api/base.ts` |
| 702 | `companion-module-casparcg-server/companion-module-base-main/packages/companion-module-host/src/internal/__tests__/feedback.spec.ts` |
| 701 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/examples/chango/chango_32.py` |
| 701 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/examples/chango/chango_32.py` |
| 700 | `companion-module-resolume-arena-master/src/domain/clip/clip-utils.ts` |
| 694 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui/waveformCore.js` |
| 694 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui/waveformCore.js` |
| 689 | `companion-module-base-main/src/module-api/base.ts` |
| 669 | `companion-module-casparcg-server/src/client/components/timeline-canvas.js` |
| 661 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/vector/gothger.py` |
| 661 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/vector/gothger.py` |
| 659 | `companion-module-highpass-accompaniment_v2/gui/ui.js` |
| 649 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/examples/toasters/toast_bitmaps.py` |
| 649 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/examples/toasters/toast_bitmaps.py` |
| 645 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/vector/gotheng.py` |
| 645 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/vector/gotheng.py` |
| 644 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/audioPlaybackCore.js` |
| 633 | `companion-module-casparcg-server/src/client/components/timeline-editor.js` |
| 630 | `companion-module-cvmeventi-countdown/src/presets.ts` |
| 626 | `companion-module-novastar-splicer-main/src/main.js` |
| 617 | `companion-module-bosch-dcn/BoschDcnBridge/BridgeService.Delegate.cs` |
| 617 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui/appConfigUI.js` |
| 615 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui/sidebars.js` |
| 615 | `companion-module-highpass-accompaniment_v2/gui/audio/audioPlaybackCore.js` |
| 606 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui/appConfigUI.js` |
| 602 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/audio/audioPlaybackCore.js` |
| 602 | `companion-module-highpass-accompaniment_v2/pkg/gui/audio/audioPlaybackCore.js` |
| 602 | `companion-module-novastar-controller-master/actions.js` |
| 598 | `companion-module-casparcg-server/src/actions.js` |
| 595 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/audioPlaybackCore.js` |
| 595 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/ui.js` |
| 595 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/ui/appConfigUI.js` |
| 595 | `companion-module-highpass-accompaniment_v2/pkg/gui/ui.js` |
| 595 | `companion-module-highpass-accompaniment_v2/pkg/gui/ui/appConfigUI.js` |
| 592 | `companion-module-casparcg-server/src/config-fields.js` |
| 589 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/vector/astrol.py` |
| 589 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/vector/astrol.py` |
| 583 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui.js` |
| 577 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/vector/romant.py` |
| 577 | `companion-module-resolume-arena-master/src/domain/layers/layer-util.ts` |
| 577 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/vector/romant.py` |
| 572 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/ui/cueGrid.js` |
| 562 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/renderer/easter_egg_game/game.js` |
| 562 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/easter_egg_game/game.js` |
| 557 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/vector/italict.py` |
| 557 | `companion-module-highpass-accompaniment_v2/original_electron_app/main.js` |
| 557 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/vector/italict.py` |
| 552 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui.js` |
| 545 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/electron-launcher/main.js` |
| 541 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/main/cueManager.js` |
| 537 | `companion-module-highpass-accompaniment_v2/gui/ui/appConfigUI.js` |
| 536 | `companion-module-casparcg-server/src/config-generator.js` |
| 536 | `companion-module-highpass-accompaniment_v2/OLD/src/httpHandler.ts` |
| 536 | `companion-module-highpass-accompaniment_v2/original_electron_app/src/renderer/ui/sidebars.js` |
| 535 | `companion-module-highpass-accompaniment-builtin/companion-module-highpass-countdown/public/script.js` |
| 535 | `companion-module-highpass-accompaniment-builtin/companion-module-highpass-countdown/pkg/script.js` |
| 535 | `companion-module-highpass-countdown/public/script.js` |
| 535 | `companion-module-highpass-countdown/pkg/script.js` |
| 533 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/vector/gothita.py` |
| 533 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/vector/gothita.py` |
| 532 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/client/audio/audioPlaybackPlaylist.js` |
| 532 | `companion-module-highpass-accompaniment_v2/gui/audio/audioPlaybackPlaylist.js` |
| 532 | `companion-module-highpass-accompaniment_v2/pkg/gui/audio/audioPlaybackPlaylist.js` |
| 529 | `companion-module-bosch-dcn/BoschDcnBridge/BridgeService.Discussion.cs` |
| 522 | `companion-module-casparcg-server/src/instance.js` |
| 521 | `companion-surface-highpass-controller/highpass_controller/st7789_mpy-master/fonts/truetype/NotoSansMono_32.py` |
| 521 | `companion-surface-chinese-controller/highpass-controller/st7789_mpy-master/fonts/truetype/NotoSansMono_32.py` |
| 518 | `companion-module-casparcg-server/src/scene-transition.js` |
| 515 | `companion-module-roland-vr400uhd/src/actions.ts` |
| 513 | `companion-module-casparcg-server/src/client/components/preview-canvas.js` |
| 511 | `companion-module-casparcg-server/src/client/components/dashboard.js` |
| 511 | `companion-module-highpass-accompaniment_v2/accompaniment-v2-backend/src/backend/audioPlaybackManager.js` |
| 509 | `companion-module-casparcg-server/src/timeline-engine.js` |

## Other top-level projects

**Count:** 7

| Lines | Path |
|------:|------|
| 2400 | `Avonic CM93/companion-module-sony-visca-master/src/presets.js` |
| 1558 | `Avonic CM93/companion-module-sony-visca-master/src/actions.js` |
| 1304 | `Avonic CM93/companion-module-avonic-cm93/src/actions.js` |
| 1120 | `Avonic CM93/companion-module-sony-visca-master/src/choices.js` |
| 945 | `Avonic CM93/companion-module-base-main 2/src/internal/__tests__/feedback.spec.ts` |
| 903 | `Avonic CM93/companion-module-avonic-cm93/src/presets.js` |
| 705 | `Avonic CM93/companion-module-base-main 2/src/module-api/base.ts` |

## Notes

- **Large C sources** (e.g. `st7789.c`, `miniz.c`) are often vendor or display-driver code bundled with hardware projects.
- **`.ts` in `companion-module-resolume-arena-master`** includes generated or domain-heavy API typings.
- Very large **`actions.js`** / **`presets.js`** files are typical of Bitfocus Companion modules.
- To reduce noise in future audits, add `micropython/` to `.gitignore` clones or scan only `HighAsCG/` and selected `companion-module-*` folders.

---
*End of audit.*
