# Work order status (lightweight index)

**Note:** Per-WO checklists and specs live in `work/*_WO_*.md`.

| ID | File | Status | Summary |
|----|------|--------|---------|
| 52 | [52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md](./52_WO_BRIDGE_DISK_PARTITION_AND_USB_SYNC.md) | Draft | Split internal **bridge** exFAT (sole media + config sync) vs **USB** (one-way media ingest + config sync) |
| 57 | [57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md](./57_WO_CASPAR_IMAGE_COMPOSE_PREVIEW.md) | Draft | Caspar ADD IMAGE tick compose preview — fixed basename, dirty-channel gate (not PRINT/WebRTC) |
| 58 | [58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md](./58_WO_FFMPEG_JPEG_COMPOSE_PREVIEW.md) | Draft | Caspar ffmpeg consumer → JPG file (direct write, channel-relative scale) — no ADD IMAGE tick, no UDP relay |
| 59 | [59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md](./59_WO_DEVICE_VIEW_SERVER_INSPECTOR_FPS_NETWORK.md) | In progress | Device View server inspector — project default fps, Ethernet IP auto/manual, factory reset only |
| 60 | [60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md](./60_WO_CG_ONLY_LOOKS_DECK_VISUAL.md) | In progress | CG-only looks — dark blue / purple / green–yellow deck cards; checkerboard alpha CG thumbnails |
| 62 | [62_WO_PROJECT_SCOPED_MEDIA_ROOT.md](./62_WO_PROJECT_SCOPED_MEDIA_ROOT.md) | Draft | Project-scoped media write root under `media/projects/<slug>/` |
| 64 | [64_WO_HOT_BACKUP_AMCP_FANOUT.md](./64_WO_HOT_BACKUP_AMCP_FANOUT.md) | Phase A–C shipped | Leader AMCP fan-out to follower Caspar (2026-06-27) |
| 65 | [65_WO_HOT_BACKUP_ROBUSTNESS_FAILOVER_PLAYHEAD_SYNC.md](./65_WO_HOT_BACKUP_ROBUSTNESS_FAILOVER_PLAYHEAD_SYNC.md) | Draft | Playhead sync, fan-out robustness, failover v2 (WO-64 follow-on) |
| 63 | [63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md](./63_WO_LOOKS_DECK_LIVE_COMPOSE_PREVIEW_THUMBS.md) | In progress | Looks deck cards show live compose preview when on PGM/PRV (Companion parity); edit mode keeps legacy thumbs |
| 67 | [67_WO_LOGS_MODAL_CATEGORIES_AND_SUPPORT_BUNDLE.md](./67_WO_LOGS_MODAL_CATEGORIES_AND_SUPPORT_BUNDLE.md) | Shipped (v1) | Logs modal toggles, categorized logging + filters, support bundle ZIP — live QA optional |
| 69 | [69_WO_CLEAN_SLATE_FULL_RESET.md](./69_WO_CLEAN_SLATE_FULL_RESET.md) | Draft | Clean-slate reset — wipe internal projects/config; fail-safe skip for all mount-linked media (bridge/USB/drive) |
| 71 | [71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md](./71_WO_LOOK_PGM_PLAYBACK_THUMBNAIL_CACHE.md) | Draft | PGM playback thumbnail cache (~5 s or mid-clip), GUI deck + Companion per-look image, event-driven |
| 72 | [72_WO_COMPANION_COMPOSE_PREVIEW_LAYOUT_AND_POLISH.md](./72_WO_COMPANION_COMPOSE_PREVIEW_LAYOUT_AND_POLISH.md) | Draft | Companion: look label polish, seam-safe quadrant badges, preview traffic gate, custom mosaics, map-only channels |
| 73 | [73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md](./73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md) | Phase A–D shipped | Calamares on eggs ISO; systemd Caspar+scanner; Nuclear install + stop/start Caspar |
| 74 | [74_WO_MIXER_EFFECTS_INSPECTOR_PARAMS_AND_SMOKE.md](./74_WO_MIXER_EFFECTS_INSPECTOR_PARAMS_AND_SMOKE.md) | Shipped | Mixer effects smoke (13→AMCP); inspector primary/advanced params; live PGM/timeline apply |
| 75 | [75_WO_TIMELINE_COMPANION_BUTTON_PREVIEW.md](./75_WO_TIMELINE_COMPANION_BUTTON_PREVIEW.md) | In progress | Companion timeline flags: coords + page picker + Satellite previews shipped; manual QA vs real Companion open |
| 76 | [76_WO_PROJECT_LOAD_AUTOSAVE_HARDWARE_GPU_BOOT.md](./76_WO_PROJECT_LOAD_AUTOSAVE_HARDWARE_GPU_BOOT.md) | Shipped | Autosave merge, looks-only load, boot xrandr GPU snapshot, replication docs/tests |
| 77 | [77_WO_STICK_BOOT_QA_TEST_SUITE.md](./77_WO_STICK_BOOT_QA_TEST_SUITE.md) | Phase A shipped | Read-only post-boot stick QA — `tools/runtime/stick-boot-test/` (10 modules) |
| 78 | [78_WO_REPLICATION_TRUST_HOSTNAME_AND_RSYNC_SSH.md](./78_WO_REPLICATION_TRUST_HOSTNAME_AND_RSYNC_SSH.md) | Phase A–E (single-box QA) | MAC hostname, rsync-only SSH, signed handshake, `project.hotBackup`; two-box pair QA pending |
| 79 | [79_WO_LEADER_AUTOSAVE_LIVE_REPLICATION.md](./79_WO_LEADER_AUTOSAVE_LIVE_REPLICATION.md) | Phase A shipped | Debounced leader autosave → follower project push |
| 79 | [79_WO_DUAL_PANE_FILE_BROWSER_AND_WETRANSFER_PUSH.md](./79_WO_DUAL_PANE_FILE_BROWSER_AND_WETRANSFER_PUSH.md) | In progress | MC-style file browser shipped; cloud Share via Puppeteer (login + live QA pending) |
| 80 | [80_WO_XRANDR_CUSTOM_MODE_FORCE_RESOLUTION.md](./80_WO_XRANDR_CUSTOM_MODE_FORCE_RESOLUTION.md) | Phase A shipped | xrandr custom mode order (newmode/addmode), WxH×fps from Web UI, cold-boot apply-layout persistence |
| 81 | [81_WO_STREAM_RECORD_LOGS_AND_NO_RESTART_DIRTY.md](./81_WO_STREAM_RECORD_LOGS_AND_NO_RESTART_DIRTY.md) | Phase A–C shipped | Stream/record logs in inspector; no false Apply dirty on output CRUD |
| 82 | [82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md](./82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md) | Phase A–D shipped | Simple wiring mode + no full reload on tab switch / partial save |
| 88 | [88_WO_HOST_CHANNEL_LIVE_SOURCES.md](./88_WO_HOST_CHANNEL_LIVE_SOURCES.md) | Draft | Dedicated host channel per webpage/NDI/DeckLink; Device View matrix; operator video fullscreen route |
| 89 | [89_WO_CEF_OPERATOR_CONTROL.md](./89_WO_CEF_OPERATOR_CONTROL.md) | Draft | CEF X11 bridge retarget to host CDP tab; HTTP API; depends on WO-88 registry |
| 90 | [90_WO_ISO_THIRD_PARTY_LICENSES_FOLDER.md](./90_WO_ISO_THIRD_PARTY_LICENSES_FOLDER.md) | In progress | `licenses/` + COMPLIANCE-ISO (NVIDIA/NDI/BMD); collector + ISO build hook |
| 91 | [91_WO_TAILSCALE_SETTINGS_AND_OPERATOR_UI.md](./91_WO_TAILSCALE_SETTINGS_AND_OPERATOR_UI.md) | Phase A–D shipped | Tailscale Settings tab + API + operator-monitor login; wiki API docs; live QA pending |
| 92 | [92_WO_DECKLINK_EXFAT_VENDOR_INSTALL.md](./92_WO_DECKLINK_EXFAT_VENDOR_INSTALL.md) | Draft | Operator-supplied BMD tarball on exFAT `vendor/decklink/`; idempotent boot install + API (no DeckLink in ISO) |
| 93 | [93_WO_TIMELINE_ENHANCEMENTS.md](./93_WO_TIMELINE_ENHANCEMENTS.md) | Draft | Timeline labels, clip/layer drag-and-drop reorder |
| 94 | [94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md](./94_WO_ETHERNET_LINK_LOCAL_FALLBACK.md) | Draft | NM link-local fallback when DHCP absent (egg networkd has it; runtime does not) |
| 95 | [95_WO_EXFAT_NETWORK_CONFIG_FILE.md](./95_WO_EXFAT_NETWORK_CONFIG_FILE.md) | In progress | exFAT `network/network.conf` — operator DHCP/static IP at boot (T95.1–T95.3 shipped) |
| 110 | [110_WO_LOOKS_CANVAS_THUMBNAIL_ACCURACY_AND_OPERATOR_NETWORK.md](./110_WO_LOOKS_CANVAS_THUMBNAIL_ACCURACY_AND_OPERATOR_NETWORK.md) | In progress | Looks canvas thumb fixes (T110.1/3/5–7 shipped); WO-94/95 stick network pending |
| 121 | [121_WO_USB_WEBCAM_V4L2_INPUT.md](./121_WO_USB_WEBCAM_V4L2_INPUT.md) | In progress | USB/UVC webcam input — Phase A shipped (bridge + API + Settings tab); Device View / Live tab pending |
| 122 | [122_WO_SPLIT_REMAINING_PRODUCTION_FILES_OVER_500.md](./122_WO_SPLIT_REMAINING_PRODUCTION_FILES_OVER_500.md) | Done (re-scoped) | File-split campaign — completed via WO-140; templates/shell installers re-scoped out, scene-state.js deferred |
| 138 | [138_WO_STABILIZE_TREE_TDZ_CHUNK_CYCLE_AND_GATES.md](./138_WO_STABILIZE_TREE_TDZ_CHUNK_CYCLE_AND_GATES.md) | Done | 2026-07-07 stabilization — UI-blocking TDZ fixed, split regressions repaired, chunk hygiene, all gates green |
| 139 | [139_WO_TIMELINE_TAKE_SMOOTHNESS.md](./139_WO_TIMELINE_TAKE_SMOOTHNESS.md) | Code complete | Frame-locked look→timeline take (preset, single-commit crossfade); operator PGM QA pending |
| 140 | [140_WO_122_COMPLETION_AND_RESCOPE.md](./140_WO_122_COMPLETION_AND_RESCOPE.md) | Done | Final WO-122 splits (gpu modeline, launcher renderer) + record correction |
| 141 | [141_WO_COMMIT_PARTITION_STASH_MIRROR_STATUS.md](./141_WO_COMMIT_PARTITION_STASH_MIRROR_STATUS.md) | In progress | Jul 5-7 work partitioned onto main (6 commits); stash resolved; mirror push pending |
| 142 | [142_WO_SYSTEM_DEPENDENCY_AUDIT.md](./142_WO_SYSTEM_DEPENDENCY_AUDIT.md) | Analysis done | Dependency audit — Zoom purge + tailscale snap dup flagged; gaps G3/G4 → WO-143 |
| 143 | [143_WO_SCRIPT_REORGANIZATION_IN_PLACE.md](./143_WO_SCRIPT_REORGANIZATION_IN_PLACE.md) | Done | Script map (scripts/README.md), deprecations, eggs-wrapper consolidation, CI path guard |
| 144 | [144_WO_COMPOSE_PREVIEW_DEFECTS.md](./144_WO_COMPOSE_PREVIEW_DEFECTS.md) | Implemented (restart pending) | Preview ch3/ch5 ADD 400s + consumer recycle churn (visible PGM hitch) |
| 145 | [145_WO_VCAM_STREAM_MODE_SPIKE.md](./145_WO_VCAM_STREAM_MODE_SPIKE.md) | Planned | Vcam real-motion spike: Caspar STREAM udp → ffmpeg → /dev/video10 (jpeg fallback kept) |
| 146 | [146_WO_STATE_MONITOR_STRENGTHENING.md](./146_WO_STATE_MONITOR_STRENGTHENING.md) | Implemented (restart pending) | Caspar health ping default-on, reconcile-diff visibility, WO-84 decision note |
| 147 | [147_WO_HOT_BACKUP_ROBUSTNESS.md](./147_WO_HOT_BACKUP_ROBUSTNESS.md) | Code complete (2-box QA via runbook) | Single-box hardening (reconnect, parity gate, playhead correction) + two-box QA runbook |
| 148 | [148_WO_BOOT_BRANDING_HARDENING.md](./148_WO_BOOT_BRANDING_HARDENING.md) | Planned | Branding-safe produce path enforced + Calamares slideshow branding |
| 149 | [149_WO_OPERATOR_GUI_ON_LIVE_OUTPUT_DESIGN.md](./149_WO_OPERATOR_GUI_ON_LIVE_OUTPUT_DESIGN.md) | Draft (design) | GUI on live Caspar output — 4 routes analyzed; rec: stream-into-GUI → tiled → CEF spike |
| 150 | [150_WO_LOOKS_PRESETS_OPERATOR_BUGS.md](./150_WO_LOOKS_PRESETS_OPERATOR_BUGS.md) | Planned | Owner bug sweep: PRV-after-transition, editor resolution, PGM-only PRV arm, preset delete/overwrite/recall, simultaneous 2-screen recall |
| 151 | [151_WO_MULTIVIEW_TIMERS_AND_SIZING.md](./151_WO_MULTIVIEW_TIMERS_AND_SIZING.md) | Planned | MV timer correctness + window sizing after timer apply |
| 152 | [152_WO_TIMELINE_POLISH_FROM_LOOK_AND_KEYFRAME_DND.md](./152_WO_TIMELINE_POLISH_FROM_LOOK_AND_KEYFRAME_DND.md) | Planned | Timeline-from-look transition (completes WO-139) + keyframe drag-and-drop |

## WO-33 — Device view (split)

| ID | File | Status | Last touch |
|----|------|--------|------------|
| 33 (parent) | [33_WO_DEVICE_VIEW_INDEX.md](./33_WO_DEVICE_VIEW_INDEX.md) | In progress | 2026-04-24 |
| 33a | [33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md) | In progress | 2026-04-24 |
| 33b | [33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md](./33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md) | Draft | 2026-04-23 |
| 33c | [33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md) | In progress | 2026-04-24 |
| 33d | [33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md](./33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md) | In progress | 2026-04-24 |
| 33e | [33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md](./33e_WO_DEVICE_VIEW_EDID_MATCH_AND_APPLY.md) | Draft | 2026-04-23 |
| 33f | [33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md](./33f_WO_DEVICE_VIEW_SETTINGS_MIGRATION.md) | Draft | 2026-04-23 |
| 33g | [33g_WO_DEVICE_VIEW_QA_DOCS_ACCESSIBILITY.md](./33g_WO_DEVICE_VIEW_QA_DOCS_ACCESSIBILITY.md) | In progress | 2026-04-24 |
| 82 | [82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md](./82_WO_DEVICE_VIEW_SIMPLE_WIRING_MODE.md) | Phase A–D shipped | 2026-06-29 |

### WO-33 recent updates (2026-04-24)

- Expanded server PixelHue API coverage in `src/api/routes-pixelhue.js` and `src/pixelhue/client.js` to include:
  - screen ops (`take`, `cut`, `ftb`, `freeze`)
  - layer ops (`select`, `source`, `zorder`, `window`, `umd`, `layer-preset apply`)
  - read endpoints (`layer-presets`, `source-backup`)
  - firmware fallback for layer select (`/layers/select` -> `/screen/select`)
- Added frontend PixelHue service layer in `client/lib/pixelhue-api.js`.
- Added modular Device View PixelHue controls in `client/components/device-view-pixelhue-controls.js`:
  - global and per-screen controls
  - show preset apply to preview/program
  - layer select/source/z-order/window/UMD/style apply
  - source-backup read/write panel
- Added backend payload validation hardening for PixelHue write routes (`take`, `cut`, `preset-apply`, `source-backup`, plus existing layer array checks).
- Added smoke script `tools/smoke/smoke-pixelhue-validation.js` and npm script `smoke:pixelhue-validation`.
- Device View follow-up updates:
  - destination inspector now supports editable labels (names)
  - destination video mode now supports standard Caspar presets plus `custom` width/height/fps editing
  - destination main index is no longer hard-capped to 4 in Device View data model and channel intent mapping
  - added destination input/output node dots; destination input dot can be used as a cable endpoint
  - fixed cable cancellation and expanded connector-id resolution so output-to-input cabling works in more cases
- UX backlog note: cable rendering should support a natural hanging/gravity style (curved sag) for connected lines.

*Legacy link:* [33_WO_DEVICE_VIEW_CASPAR_AND_PIXELHUE.md](./33_WO_DEVICE_VIEW_CASPAR_AND_PIXELHUE.md) (redirects to index)

## WO-34 — Switcher-style bus transition rebuild

| ID | File | Status | Last touch |
|----|------|--------|------------|
| 34 | [34_WO_SWITCHER_BUS_TRANSITION_REBUILD.md](./34_WO_SWITCHER_BUS_TRANSITION_REBUILD.md) | Draft | 2026-04-25 |

### WO-34 initial scope (2026-04-25)

- New 3-channel per-screen architecture: `PGM bus`, `PRV bus`, `OUT` channel.
- Bus-level TAKE behavior for CUT/MIX (switcher-like transitions).
- Clip start policy matrix:
  - `restart_on_take`
  - `continue_from_prv`
  - `sync_with_pgm_same_layer`
- Migration + compatibility flag from legacy layer-transition model.

Update the table when a WO’s shipping state changes.

## WO-37 — Simulation Mode Placeholders (Preshow Prep)

| ID | File | Status | Last touch |
|----|------|--------|------------|
| 37 | [37_WO_SIMULATION_PLACEHOLDERS.md](./37_WO_SIMULATION_PLACEHOLDERS.md) | Not started | 2026-04-30 |

### WO-37 initial scope (2026-04-30)

- Add "Placeholders" tab to Sources Browser in simulation mode.
- Dropdown templates for generating virtual sources with specific resolutions/labels.
- Offline-only visibility (Simulation Mode).
