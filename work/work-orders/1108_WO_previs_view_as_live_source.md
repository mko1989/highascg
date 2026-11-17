# WO-1108 — The Previs view as a Live source (shm ring `previs`), so it can be recorded or streamed

**Area:** godot-client, tracking-vr, video-io
**Status: DONE (17.11.26 — built by an agent, Godot suite 30093 / 0; lead, on the box: ring `previs` listed by `/api/shm/sources` (1920×1080 @ 50, writer godot, signal true) 8 s after `previs.output.enabled` was stored; played on the preview channel (`PLAY 3-10 SHM NAME previs`) and photographed twice 6 s apart — clean picture, the slider move travelling; ring gone after disabling. COST: with the output on, the client measured 39 fps against its 100 fps publishing target (WO-1088: 2× the 50 fps show) on the 252-head gutmanny 26 scene at Quality Low — the stage is rendered twice, so the ring gets fewer than 50 new frames a second there (open: render the output at the channel rate only, or share one render when the output follows the view). Not driven by hand: the fold's controls, a look layer + TAKE, Size change)**

Owner 17.11 (verbatim): "id also like to be able to use the previs view as a source so it can be recorded or streamed."

Related: [WO-1109](./1109_WO_previs_camera_slider.md) (camera slider moves the output can play),
[WO-743](./743_WO_godot_shm_writer.md) (SubViewport → shm ring), [WO-744](./744_WO_shm_ring_live_source.md) (rings as Live
sources), [WO-883](./883_WO_shaders_only_in_visuals_live_source_screen_size.md) (a ring while a Live source),
[WO-1051](./1051_WO_visuals_layers_as_sources_live_picks.md) (solo rings), [WO-1088](./1088_WO_client_fps_target_and_keeping_up_signal.md)
(pacer), [WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md) (render only while shown),
[WO-797](./797_WO_previs_fixtures_decoded_only_while_watched.md) (fixtures decoded only while watched).

## Investigation

- **Publishing a viewport is solved.** `features/shm_out/viewport_publisher.gd` `start(vp, ring, fps)` opens
  `/dev/shm/highascg-<ring>` (HshmSink GDExtension), sets the viewport `UPDATE_ALWAYS`, reads back asynchronously, skips
  (counts `skipped`) rather than queues, re-opens itself on a viewport resize, and tells the pacer (WO-1088). The
  Visuals tab is the full pattern (`features/visuals/visuals_tab.gd`: `can_publish()` — only on the box, libhshm_sink
  loaded; `_fps()` from `channelMap.programResolutions[<screen>].fps`; `_sync_ring()`; `--visuals-ring` dev flag).
- **A ring is a Live source with no server change.** `src/api/routes-shm-sources.js listShmSources()` lists every valid
  ring whose writer is alive and not Caspar; `features/live/shm_sources_model.gd rows()` made the row label the raw ring
  name (`"label": str(s.get("name", s.value))`, line 20 before this WO); the live panel polls every 3 s (WO-883). A look
  layer `shm://previs` plays as `PLAY … SHM NAME previs` (WO-744).
- **The previs scene.** `previs_tab.gd:82-85`: the stage lives in its own SubViewport `_sv` with `own_world_3d = true`;
  the stage adds a `WorldEnvironment` (`previs_stage.gd:45-47`), so any viewport sharing that World3D renders with the
  same Environment (house lights, haze, quality). `camera_overlay.gd attach()` and `xr_walk.gd` already share it this way.
- **When the tab builds:** `app/shell.gd:97` creates the Previs tab at shell start (a hidden TabContainer page still runs
  `_ready`), so the stage, the stage objects (`stage_panel.bind`), the MVR scene (`mvr_section.bind`, on
  `Store.project_changed`) all load with the project, shown or not. No eager build needed.
- **What stops while the tab is hidden** (`previs_tab.gd _apply_mode`, lines 357-389 before this WO):
  `_sv` → `UPDATE_DISABLED` (WO-617); `builder.set_live(false)` (stage walls release their VideoSurfaces roles and
  `_texture()` returns null — `stage_builder.gd:255-285`); `mvr.set_live(false)` (MVR VideoScreens, `mvr_scene.gd:166`);
  the GLB screens' role released; `cards.set_shown(false)` (people cut-outs). And the rig: `fixtures_watch.gd:21` holds the
  server's `tracking:fixtures` watch only while `fixtures_3d_model.gd renders(get_viewport())` (lines 151-152 before:
  "the SubViewport is not UPDATE_DISABLED"); `fixtures_3d.gd:387` picks the real spot lights by the same test. So a
  second viewport alone would show dark walls and frozen heads.
- **Helpers in the picture** (what a clean output must drop), all GeometryInstance3D on the default layer 1:
  stage selection box (`stage_builder.gd:139-166`, ImmediateMesh lines), projector frustum lines (`:370-381`), MVR
  selection boxes (`mvr_scene.gd:372-392`, translucent BoxMesh), head selection / console marks (`fixtures_3d.gd:184-200`,
  ImmediateMesh), tracking frustums + coverage (`tracking/coverage_3d.gd`, lines + Label3D), hub marker pins
  (`tracking/marker_pins_3d.gd`, poles, balls, Label3D), stage calibration marks (`fixtures/calib_marks_3d.gd`),
  handover lines (`tracking/handover_3d.gd`), test-puppet / human tags (Label3D, `person_avatar.gd:262`,
  `person_human.gd:138`). Only `FLOOR_LAYER` (1 << 19, `previs_stage.gd:9`) was in use, by the camera overlay's cull
  mask (`camera_overlay.gd:97`).

## What was done

- **Model — `godot/client/features/previs/output/previs_output_model.gd` (new, pure):** `project.previs.output =
  {enabled, size (1280×720 | 1920×1080 default | 3840×2160), camera: "view" | <move id>}` normalize (unknown keys kept),
  `fps_of(channelMap)` (programResolutions[0].fps, else 50), `ring_name(args)` (`--previs-ring`, `previs-probe` for the
  probe, else `previs`; the ring-name rule enforced), `may_autostart(args)` (a `--check` or another probe's client never
  starts the operator's ring from the project), the Camera picker items, the move lookup and the status line.
- **Output — `features/previs/output/previs_output.gd` (new):** its own SubViewport on the stage's World3D
  (`vp.world_3d = stage.get_viewport().find_world_3d()`) with its own Camera3D; quality per `previs_quality.gd` in compact
  mode (MSAA / SMAA per level, scale 1.0, shadow atlas ≤ 4096) and on the GPU meter. Camera: "My view" copies the
  operator camera's transform, fov, near/far each frame; a move plays on the output's own clock (ping-pong / loop /
  once) while the operator's view stays free. Renders only while the ring runs (or the probe asks). While it runs it
  sets meta `previs_output` (`fixtures_3d_model.gd FEEDS`) on the stage's SubViewport and emits `feeding_changed`.
- **Keeping the stage live while hidden:** `fixtures_3d_model.gd renders()` also answers true for a viewport carrying
  `FEEDS` (one place: the fixtures watch and the spot-light pick both follow). `previs_tab.gd _apply_mode` reads the meta
  (`out`) and keeps `builder.set_live`, `mvr.set_live` and the GLB role held while it is set; `_sv` itself stays off
  when hidden (WO-617 kept).
- **Clean picture — `features/previs/output/clean_layer.gd` (new):** one constant `LAYER = 1 << 18`; the output camera's
  `cull_mask = 0xFFFFF & ~LAYER`. Helpers are classified by rule, not by edits in each helper file: every Label3D, every
  ImmediateMesh line mesh, anything marked `previs_helper`, and the subtrees of coverage_3d / marker_pins_3d /
  calib_marks_3d / handover_3d. They move to LAYER (and stop casting shadows). While the output runs, meshes joining the
  stage later are classified a frame after they arrive (`SceneTree.node_added`). The operator camera (all 20 layers)
  and the camera overlay (drops only FLOOR_LAYER) see them as before. One line in `mvr_scene.gd mark()` tags the MVR
  selection boxes (`mi.set_meta("previs_helper", true)`).
- **UI — `features/previs/output/previs_output_section.gd` (new):** Inspector fold "Output" under "Camera slider":
  "Send as a source", Size, Camera ("My view" + the slider moves; a deleted move shows "(move gone) — my view") and one
  status line — on: `On: shm://previs, 1920×1080 at 50 fps. It is in Sources ▸ Live as "Previs".`; not possible: the
  Visuals wording ("Sending works on the box itself …", "libhshm_sink is not loaded …"), the sink's error, or "This
  client does not send (it was started for a check or a probe)". Saved through `ProjectSync.mark_dirty()`.
- **Start without opening the tab — `features/previs/camera/previs_cinema.gd`:** applies the slice on
  `Store.project_changed` and on `channelMap` changes (rate change → the ring re-opens at the new rate); the tab is built at
  shell start, so an enabled output starts when the project loads.
- **Sources ▸ Live label — `features/live/shm_sources_model.gd`:** `LABELS = {"previs": "Previs"}`: the row reads
  "Previs", drags `shm://previs` as before; other rings keep their name.
- **Dev flags:** `--previs-ring=<name>`; `--probe-previs-output=<dir>` (`output/previs_output_probe.gd`): waits for the
  project, turns the output on in that client only (never saved), renders 2 s, saves `<dir>/previs_output.png`, prints
  `[probe-previs-output] ring … · WxH · skipped n · sink open|closed · png … · <status>` and quits. Ring `previs-probe`
  unless `--previs-ring` is given.
- **Video feedback:** an LED wall showing the program inside the previs while the previs is on that program is a
  tunnel — physically right. Nothing in this path allocates per frame beyond the publisher's bounded readbacks
  (MAX_IN_FLIGHT 2), so it cannot grow.
- **Tests — `godot/client/tests/test_previs_output_wo1108.gd` (new, 64 asserts):** normalize, rate, ring names,
  autostart rule, camera items / missing move, status lines, the Live row label, clean-layer rules on a built node tree
  (wall stays, line / label / marked / subtree go, lights untouched, layer ≠ floor layer, helper scripts exist),
  `renders()` with FEEDS, and source pins of the hooks (tab, stage, mvr_scene, output camera mask and shared world).

## What was verified

- Godot suite `run-client.sh --test`: **30077 passed, 0 failed** (baseline 29901; +64 this WO, +112 WO-1109).
- `run-client.sh --check`: boot OK (no script errors) — that boot builds the Previs tab and the output node, with no
  project (server :9). `node tools/ci/check-max-file-lines.js`: 0 over 500 (`previs_tab.gd` exactly 500).
- No server file changed (no node smoke needed); `tools/ci/offline-test-files.js` untouched (Godot tests are
  auto-discovered by `tests/run_tests.gd`, CI runs the whole folder).

## What is NOT verified (the lead's on-glass list)

Nothing ran on the box from this session (no GUI, no ring, no Caspar). For the lead:

1. **Probe (optional):** `cd godot/client && ./run-client.sh --probe-previs-output=/tmp/pv` (ring `previs-probe`). It is a
   second Godot instance, which the owner's 05.11 rule (no extra Godot on the box) forbids unless he allows it; otherwise
   skip to 2 and judge the picture on the program. Expect one `[probe-previs-output]` line with `sink open`, `skipped` small, and
   `/tmp/pv/previs_output.png` the stage from the operator camera's start pose with walls lit and NO selection box,
   frustum lines, marker pins, labels.
2. On the owner's GUI (relaunched): Previs ▸ 3D ▸ Inspector "Output" ▸ "Send as a source" → status `On: shm://previs,
   1920×1080 at <PGM rate> fps …`. Sources ▸ Live within ~3 s: a row **"Previs"** (1920×1080 · fps · godot).
3. Drag the Previs row onto a look layer, take it: the program shows the previs view; orbit in the Previs tab → the
   program follows. Select a wall / a head: the selection box shows in the tab, NOT on the program.
4. Switch to the Live tab (Previs hidden): the program keeps moving — LED walls keep their live pictures, the heads keep
   following MagicQ / the programmer (fixtures watch held), house lights / haze as in the tab.
5. Camera ▸ a camera slider move (WO-1109): the program plays the move by itself (ping-pong); the operator's own view
   stays free to orbit.
6. Size 1280×720 / 3840×2160 → the Sources row's resolution follows (ring re-opens); watch the Quality menu's GPU ms.
7. Untick "Send as a source": the ring ends (Caspar holds the last frame), the row disappears; with the tab hidden the
   walls release their surfaces again (WO-617 behaviour back).
8. Relaunch the GUI with the output enabled and the Live tab in front: the ring comes back without opening Previs.
9. Not covered: person cut-outs / avatars (`person_cards.gd`) still draw only while the tab shows 3D; a WO-1109 move
   played on the operator view while "My view" is the output camera is also a cinematic output (by design).
