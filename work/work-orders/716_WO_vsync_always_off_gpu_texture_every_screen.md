# WO-716 — Screen consumers: vsync always off, gpu-texture on every channel

**Area:** video-io, caspar-build
**Status: DONE (23.10.26). Verified: the WO-716 smoke 6/6, vsync/gpu-texture smokes 34/34, the offline suite
3041/3044 (1 failure: a live-hardware probe, explained below), Godot 21462/0. Box: channel 1's live consumer was
re-added with GPU (`gpu_texture true`); Caspar at 3.9 % CPU.**

Owner, 23.10 (answering WO-715 D1): *"Fix the vsync, it should always be off, while Nvidia gltexture needs to
enabled per channel."*

## Investigation

- WO-715 measured a vsync-on screen consumer at ~78 % of a core. The cause is NVIDIA spin-waiting in
  `glXSwapBuffers`, called from SFML `display()` (`screen_consumer.cpp:544`). With vsync off it costs ~2 %.
- Before this WO, the generator's `<screen>` emitters were:

  | emitter | vsync | gpu-texture |
  |---|---|---|
  | PGM, `custom_live` (`config-generator-screen-xml.js`) | `screen_N_vsync`, default false (WO-447) | forced true (WO-502) |
  | PGM, stock profile (same file) | `screen_N_vsync` | **missing** |
  | multiview, `custom_live` / stock | `multiview_vsync`, **default true** (`config-generator-consumer-attach.js:51`, `defaults-caspar-server.js:63`) | forced true / **missing** |
  | PRV head (WO-364, inline in `config-generator-consumer-attach-screen.js`) | `screen_N_vsync` | **missing** |
  | operator GUI (`config-generator-operator-gui.js:88`) | **hard-coded true** | forced true |
  | `config/casparcg.config.iso` (first boot, every produce) | **true** | **missing** |

  So gpu-texture was not "per channel": it was missing on the PRV head, the stock profile and the ISO template.
  The ISO template is the config the box runs after every produce. Today it ran with vsync on and
  `gpu_texture: false` (`log/caspar_2026-10-23.log`, 15:50:02).
- The 2.5.1 build reads both settings (`screen_consumer.cpp:1109/1113`). AMCP `ADD … SCREEN` takes a `GPU`
  flag (`:1059`). AMCP vsync is always off (struct default `:103`).
- Nothing in `src/` adds screen consumers over AMCP, so the generator and the ISO template cover every case.

## What was done

- `config-generator-screen-xml.js`: added `SCREEN_VSYNC_XML` (`<vsync>false</vsync>`) and `SCREEN_GPU_TEXTURE_XML`,
  exported. Both are written by the PGM and multiview builders in both profiles. `vsync` was dropped from their
  ctx.
- `config-generator-consumer-attach-screen.js`: no longer reads `screen_N_vsync`. The PRV-head `<screen>` now uses
  both constants.
- `config-generator-consumer-attach.js`: no longer reads `multiview_vsync`.
- `config-generator-operator-gui.js`: uses both constants.
- `config/casparcg.config.iso`: `vsync false`, added `gpu-texture true`.
- `defaults-caspar-server.js`: `multiview_vsync` set to false, and both vsync defaults marked as ignored.
  - The keys stay, because saved settings and the web-parity goldens (`godot/client/tests/golden/devices_*.json`)
    carry them. They are inert data, the same as WO-502's dead `screen_N_gpu_texture`.
- UI: the V-sync checkbox is gone from the Godot GPU-output page (`gpu_output_controls.gd` `BASE_CHECKS`) and
  from the web inspector (`device-view-inspector-gpu.js`).
  - Both still send the saved value back unchanged, so the golden save bodies don't change. A control that
    changes nothing would be a lie (minimalism).
- New `tools/smoke/smoke-wo716-vsync-off-gpu-texture-every-screen.test.js` (in the curated list). It checks every
  emitter with every vsync key true, a full generated config, the ISO template, and that neither UI has a V-sync
  control.
- `smoke-wo447-vsync-default-off.test.js`: "an explicit true survives" changed to "is ignored", since this
  decision supersedes it.
- Comments updated in `tools/runtime/highascg-nvidia-x-apply.sh` and `docs/reference/screen-consumer-vsync-nvidia.md`.

## What was VERIFIED

- WO-716 smoke: 6/6. Together with WO-447, WO-502, routing-3 and port-resolve: 34/34.
- Offline suite: 3041 / 3044 pass. One fails:
  - `smoke-wo308-pointer-confine-split` "'auto' … multiview" fails on this box, with or without this change.
  - The cause: `resolveOperatorMonitorPort` falls through to the live GPU map (`hardware-info`; the 3 s is the
    probe) and finds port 3's operator monitor here. CI is headless, so the probe comes back empty there.
- Godot: 21462 passed, 0 failed. ESLint on the changed files: clean (all 214 warnings are older, under the cap of
  216). Prettier and the 500-line check are clean. `npm run build:client` passes.
- Box: `REMOVE 1-600` + `ADD 1-600 SCREEN 1 BORDERLESS NON_INTERACTIVE GPU X 0 Y 0 WIDTH 1280 HEIGHT 720` →
  `INFO 1` shows `<gpu_texture>true`, and the log has no "Enabled vsync". Caspar used 3.9 % CPU over 10 s
  (82.7 % with the ISO's vsync on).
- Owner QA: tearing. Pacing comes from GL sync (WO-407/444, owner-verified smooth with vsync off in WO-447).
  Confirm on the next show config with all screens: Apply, then restart Caspar.
