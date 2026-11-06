# WO-975 — NVIDIA "sync to display" auto-on for the first GPU port feeding a PGM

**Area:** os-iso, godot-client
**Status: DONE (2026-11-06 — offline + Godot tests green; resolved sync device verified on the box after a node restart; the AUTO tick shown in the Devices UI is covered by Godot unit tests, not a glass screenshot — see section 3)**
**Source:** owner show note 06.11: "The gpu outputs need the Nvidia sync to display option for them to work properly. It should be automatically enabled for a first connected gpu port to a pgm of a screen destination."
**Related:** WO-407 (GL vblank sync), WO-412 (one tick, two consumers), WO-439 (tick on a mapping rig), WO-888 (no tick = first PGM screen; operator-monitor tick ignored)

## 1. Investigation

- Box config at the time (config/caspar_server.json, read only): `screen_N_nvidia_sync_to_display` was `false` on every
  port when I started (a tick on port 2 appeared at 22:24:51 from somebody else's UI save; I did not touch config).
  Devices: Operator GUI -> gpu_p3 (port 4 / DP-6, `screen_4_operator_monitor`), Dioda (pgm_prv) -> gpu_p1 (port 2 / DP-2).
- The EFFECTIVE sync device was already correct without a tick: WO-888 made `resolveGlSyncDisplay`
  (src/utils/caspar-gl-sync-env.js) fall back to layout-plan screen 1 (= Dioda, DP-2), and the NVIDIA policy
  (`resolveNvidiaSyncToDisplayOutput`) reuses it. Caspar's env showed `__GL_SYNC_DISPLAY_DEVICE=DP-2`.
  What the owner saw: the Devices inspector tick was UNCHECKED on the PGM port (the UI only read the stored flag), so
  it looked off, and nothing told him it was automatic. The auto rule also keyed on "screen 1" rather than on the cable.
- Stored `false` is not a choice: the Godot save loop (`gpu_output_model.gd caspar_patch`) writes `false` to every
  non-selected port, so old configs carry false everywhere. Explicit-off therefore needs its own marker.

## 2. What was done

Rule (written once, implemented twice, tested twice):
1. Explicit ON: any `screen_N_nvidia_sync_to_display: true` (lowest N) — legacy meaning kept, wins over auto.
2. Explicit OFF: `casparServer.nvidia_sync_to_display_off: true` -> no NVIDIA / Caspar sync device at all.
3. AUTO (default; nothing stored, or only false/null): the FIRST screen destination in config order whose mode is
   `pgm_prv`/`pgm_only` and that has a PGM cable (edge outputLayer < 2, through pixel-map hops) to a GPU port ->
   that port (first cable in graph order). Operator GUI / multiview / stream destinations never count, PRV-only cables
   don't, and the operator-monitor port is skipped. One device only (the X screen has one GL sync device), so with
   several PGM screens exactly one is picked.
`caspar_gl_sync_display` (off/name) still outranks everything; the old "screen 1 from layout plan" step remains as a
fallback when the auto port cannot resolve a connector name.

- src/utils/x-display-session-layout-resolve.js: `nvidiaSyncToDisplayMode`, `nvidiaSyncAutoPortIndex` (exported also via x-display-session-layout.js).
- src/utils/caspar-gl-sync-env.js: step 1 uses the tri-state; off -> null; auto port resolves via `screen_N_system_id` / device graph `gpu_p{N-1}` (same chain as the tick). Both consumers (caspar-env + NVIDIA policy) share this one function, so they cannot diverge.
- godot/client/features/devices/gpu_output_model.gd: `nvidia_sync_state` + `auto_sync_port` (GDScript mirror); the tick starts checked on the auto port and its label gets " (auto)" (gpu_output_controls.gd; the marker clears on a hand edit); saving other fields while the auto tick is untouched writes nothing about it (it is not pinned); unticking the shown-ticked port writes `nvidia_sync_to_display_off: true`; ticking writes the explicit port and clears off; "Reset all settings" clears the off marker (back to auto). Tooltip updated.
- No server defaults needed: absent key = auto, so defaults-core.js / factory-starter / factory reset and the settings POST (casparServer slice merges generically, unknown keys kept) behave correctly as-is. `null` posts also read as auto.
- Tests: tools/smoke/smoke-wo975-nvidia-sync-auto.test.js (6, in tools/ci/offline-test-files-2.js; offline-test-files.js is at the 500-line limit); godot test_devices_gpu_output.gd `test_nvidia_sync_auto` (+ the web-port goldens now pin the explicit-off branch, new key stripped from their body compare).

## 3. What was VERIFIED

- Offline node suite: 5337 pass / 17 fail; the 17 are other agents' in-flight areas (preview-push, WO-905 deck scroll, WO-955/961, WO-846 WO hygiene — INDEX stale), none touch sync; WO-975 smoke 6/6.
- Godot `--test`: 26024 passed, 0 failed. 500-line gate clean.
- Live-config simulation (node, live GET /api/settings): as stored (tick on port 2) -> mode on / DP-2; all ports false -> mode auto port 2 / DP-2; explicit off -> no device.
- Node restart under box2.lock (22:43:48): caspar-env `CASPAR_GL_SYNC_DISPLAY=DP-2`, Caspar process env `__GL_SYNC_DISPLAY_DEVICE=DP-2`, journal "[Caspar GL sync] caspar-env written: sync display DP-2" + NVIDIA policy applied; API up. The box has an explicit tick on port 2 (set by someone else 22:24), which resolves identically to auto. Caspar was not restarted by me, so no output-recovery check was needed.
- NOT proven: a glass screenshot of the Devices inspector showing the "(auto)" tick.
