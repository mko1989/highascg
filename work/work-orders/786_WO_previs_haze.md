# WO-786 — Haze in the 3D views so the beams read

**Area:** lighting
**Status: DONE (26.10 — Godot tests + boot check, off-screen renders at no / light / thick haze against the live rig; owner QA = the "Haze" picker in the Previs toolbar)**

Owner, 26.10 (during WO-784):
> can we add a fog or something that would make the ligths more visible?

Parents: [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) T5 (beam cones, spot lights), [WO-649](./649_WO_live_preview_2d_3d_toggle_mvr_model.md)
("Lights" toggle).

## Investigation

- The client renders with Forward+ (`project.godot`), so Godot's volumetric fog is available. The stage `Environment`
  (`previs_stage.gd`) has glow, linear tonemap and a 0.6 sun; no fog.
- Every beam draws an additive cone (`fixtures_3d.gd` CONE_SHADER, alpha 0.16, falling off as (1 − along)²). The first
  64 non-Glow beams also get a SpotLight3D (`fixtures_3d_model.gd` MAX_LIGHTS). Cell rigs (more than 4 beams, e.g. the
  Aura) draw glowing cells only.
- Off-screen renders of the live rig (12 MAC Quantum + 10 Sharpy at full for the test, `--probe-fixture`):
  - Volumetric fog alone, at a density that shows scatter (0.004–0.03), mostly **dims the LED walls** (extinction).
  - It adds a **wash around the spots, not single shafts**: at stage distance (~40 m) Godot's fog froxels (64×64×64
    over the fog length) are too coarse for a 24° beam.
  - The fog's scatter from the 0.6 sun turns the whole room grey.
- So the shafts have to come from the cones; the fog can only add the atmosphere around them.

## What was done

- **`features/previs/haze.gd`** (new): one haze level shared by every 3D view, stored in `ui.cfg` `[previs] haze`.
  - `shared()` / `set_level()` / `changed`.
  - `apply_env(env, h)`: volumetric fog, density 0.001 + 0.005·h, near-white albedo, length 64 m, no ambient / sky
    injection.
  - `picker()`: an OptionButton with No haze / Light haze / Haze / Thick haze (0, 0.35, 0.65, 1).
- **`features/previs/fixtures/fixtures_3d.gd`** (the rig in both the Previs tab and Live 3D) follows the shared level.
  - It sets the fog on its world's Environment (`get_world_3d().environment`, set by the stage's WorldEnvironment), so
    `previs_tab.gd` needs no wiring beyond the picker.
  - The cones' alpha becomes `(1 − along)^(2 − 1.2·h) · (1 + 2.2·h)`: brighter and carrying further down the throw.
  - Each spot light's `light_volumetric_fog_energy` = 1 + 3·h.
  - To stay under 500 lines, the glb loader (with the WO-784 grey fallback) moved unchanged to
    `fixtures_3d_model.gd` as `from_glb()`.
- **`previs_stage.gd`**: the sun's `light_volumetric_fog_energy` = 0, so the haze shows the heads' beams, not a lit room.
- **`previs_tab.gd`** toolbar: the picker sits between Fit and VR…. The file is still at 500 lines: Fit, haze and VR
  are added in one loop, and the WO-665-pinned `bar.add_child(cards.picker)` line is kept.
- `app/fixture_shot_probe.gd`:
  - `--probe-haze=<0…1>` sets the level for that run only. It is not saved, because the off-screen instance shares
    the owner's `ui.cfg`.
  - Shot 3 is the whole stage (Fit).
- Rejected: dense volumetric fog as the main effect. It hides the LED walls and still draws no single beams at stage
  distance (see Investigation).

## Verified

- Godot tests 21892 passed / 0 failed, including the new `test_haze.gd`:
  - off = no fog;
  - denser with the level, below 0.01;
  - no ambient injection;
  - a null env is ignored;
  - 4 picker levels, "No haze" first.
- `run-client.sh --check` boot OK. Smokes that pin `previs_tab.gd` / `fixtures_3d.gd` text (WO-665, WO-700, WO-710)
  pass. No file over 500 lines.
- Off-screen renders, Fit view of the live rig, 22 heads at full:
  - **No haze**: as before.
  - **Light haze**: the beams stand out as shafts, and the LED wall content stays readable.
  - **Thick haze**: strong shafts down to the floor, walls still readable. A first pass with a ×4 cone boost blew out
    the floor; it is now ×3.2.
  - Close-up from below (light haze): a soft glow around the spots, with the Aura cells and head bodies unchanged.
- The 22 test heads were released after the renders. The programmer is back to the 14 Auras the owner had programmed
  (see WO-784).
- Owner QA: Previs toolbar "Haze" picker on the panel (relaunch the client). Live 3D follows the same level. Check the
  frame rate on the panel GPU at Thick haze, since volumetric fog has a GPU cost.
