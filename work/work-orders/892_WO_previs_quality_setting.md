# WO-892 — Previs render quality setting (Low / Medium / High / Ultra)

**Area:** godot-client
**Status: DONE (31.10 — Godot suite 24246 passed / 0 failed, boot check clean, every level rendered off-screen on the real GPU against a synthetic stage and the live project's 199-head rig; owner QA = the "Quality" picker in the Previs toolbar, a look at the beams on a real show)**

Owner, 31.10:
> can we make the previs scene has a quality setting. right now it looks like a low quality render, im sure we can get better look out of it.

Parents: [WO-786](./786_WO_previs_haze.md) (haze, the picker pattern; found the 64 cube fog too coarse),
[WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) T5 (beam cones, spot lights, gobo shadows),
[WO-689](./689_WO_godot_mac_previs_crash.md) (Mac crash, still open: Macs are held at Low).

## Investigation

Why the 3D views look like a low quality render (all lines are of the code before this WO):

- **No anti-aliasing anywhere.** `project.godot:31-33` sets only `forward_plus`; a SubViewport does not inherit the
  window's AA anyway, and the Previs one is made bare at `features/previs/previs_tab.gd:77-80`, the Live 3D one at
  `features/live/live_stage_3d.gd:32-35`. Edges of walls, truss, models and cones stair-step.
- **LED walls shimmer / moire.** `features/previs/led_screen.gdshader:8` samples with `filter_linear` and no mipmaps, and
  `video/shm_texture.gd:93-101` creates the picture texture with one mip: a wall far from the camera is point-sampled
  at 1 : N and any fine detail crawls.
- **Flat light.** `previs_stage.gd:27-52`: flat ambient 0.25, a sun with no shadow, no SSAO / SSIL / SSR, a floor that is
  a default `StandardMaterial3D` (roughness 1, nothing to reflect). Glow only at intensity 0.6, threshold 1.0, and
  `TONE_MAPPER_LINEAR` (kept: filmic washed the LEDs out, WO-595).
- **Beams.** `fixtures_3d.gd:17-31` the cone shader is `blend_add, unshaded, depth_draw_never` and never reads depth, so a
  cone ends in a hard line where it meets the floor / a wall; 24 radial segments (`:63-70`) facet at close range; from
  inside a cone the back faces fill the screen.
- **Shadows.** Spot lights `shadow_enabled = false` (`:373`); only gobo spots shadow (`:477`, max 16, because a gobo
  projects through the shadow map), all in the default 2048 positional atlas. Sun without shadow.
- **Haze fog** uses Godot's default 64 x 64 x 64 froxel grid (`haze.gd:38-46`; WO-786 already saw it as too coarse).

Environment facts that decided the design:

- Godot 4.7.2 here has `Viewport.SCREEN_SPACE_AA_SMAA` and every RenderingServer call below (checked headless).
- A probe client on a private Xvfb (`:90`) gets **Vulkan on the real NVIDIA RTX PRO 4000 Blackwell**
  ("Vulkan 1.4.351 - Forward+ - Using Device #0: NVIDIA"), so measured GPU ms are real (see Verified for the noise).
- `Shader.code` of a `load()`ed `.gdshader` can be edited at runtime, but only while something holds the resource: the
  resource cache alone does not keep it, and a later `load()` returned the original text (found when the unit test failed).

## What was done

**New `features/previs/previs_quality.gd`** (pattern of `haze.gd` / `projector_beams.gd`: `shared()`, `level`, `changed`,
`picker()`). One level per client, stored in `ui.cfg [previs] quality` (`"low" | "medium" | "high" | "ultra"`, default
Medium), never in the project. `current()` = the preset of `min(level, max_level())`; `max_level()` is 0 on macOS and on any
renderer but `forward_plus` (WO-689). The pure functions:

| function | sets |
|---|---|
| `apply_viewport(vp, p, compact)` | `msaa_3d`, `screen_space_aa` (SMAA), `use_debanding`, `scaling_3d_mode/scale`, `positional_shadow_atlas_size`; `compact` (camera overlay, VR mirror) = no supersampling, atlas <= 4096; XR viewports are never scaled |
| `apply_env(env, p, glow)` | SSAO, SSIL, SSR, glow threshold (`glow` false for the camera overlay) |
| `apply_floor(mat, p)` / `apply_sun(sun, p)` | floor roughness / sun shadow (2 splits) |
| `apply_globals(p)` | RenderingServer: SSAO + SSR quality, positional + directional soft shadow filter, directional atlas, volumetric fog volume size + filter, and the LED shader's anti-moire switch; only what changed is sent |
| `spot_shadow_budget(p)` | how many rig spots cast a shadow |
| `picker()` | `OptionButton` "Quality: Low .. Ultra" (items above the machine's maximum disabled, Ultra's tooltip "Not while on air ...") + a label with the **measured GPU ms** of the views that render (`viewport_get_measured_render_time_gpu`, summed over the registered, rendering stage viewports, refreshed every second) |

Presets (Low is the base; each level lays its changes over the one below):

| | Low | Medium (default) | High | Ultra |
|---|---|---|---|---|
| AA | none | SMAA | MSAA 4x + SMAA | same |
| debanding | on | on | on | on |
| 3D scale | 1.0 | 1.0 | 1.0 | 1.5 bilinear |
| positional shadow atlas | 2048 | 4096 | 4096 | 8192 |
| beam cone | as before, 24 seg | depth soft-fade + fade when the camera is inside, 48 seg | same | same |
| LED wall | as before | 4-tap rotated grid where minified | same | same |
| floor roughness | 1.0 | 0.4 | 0.35 (+ SSR) | same |
| SSAO | off | off | on, half size, medium | high, full size |
| SSIL | off | off | off | on |
| SSR | off | off | on (medium) | on (high) |
| glow threshold | 1.0 | 1.0 | 0.85 (LED bloom) | 0.85 |
| sun shadow | off | off | 2 splits | 2 splits |
| rig spot shadows | gobo spots only | gobo spots only | first 16 + gobo | first 32 + gobo |
| soft shadow filter | low | low | medium | high |
| haze fog grid | 64 | 64 | 96 | 128 |
| directional atlas | 4096 | 4096 | 4096 | 8192 |

Not used, on purpose: TAA / FSR2 (ghosting on video and beams), SDFGI.

**Hooks (kept minimal, `previs_tab.gd` stays at its 500 lines):**

- `previs_stage.gd` — `_on_quality()`: Environment, sun, floor material, and its own viewport when that is a SubViewport.
  Both Previs and Live 3D build a `PrevisStage` inside their SubViewport, so **neither `previs_tab.gd` nor
  `live_stage_3d.gd` needed an edit for the viewport**; the stage also registers its viewport for the GPU meter.
- `previs_tab.gd` — only the picker added to the toolbar list next to Haze (same line, line count unchanged).
- `fixtures/beam_cone.gd` (new) — the cone shader moved out of `fixtures_3d.gd` (which was at 499 lines) in two variants
  built from one source (`code(soft)`): plain = the old shader; soft = + `hint_depth_texture` fade over 0.8 m and a
  smooth fade as the camera enters the cone (camera position in the cone's unit frame). `apply()` sets the variant, the
  cone's `radial_segments` and the spot shadows on the existing lights in place (no rig rebuild); a `qshadow` meta on each
  light keeps `_assign` (gobo load) from switching a budgeted shadow back off.
- `fixtures_3d.gd` — `_quality()` (connected to `changed`, also run after every rebuild) and the one-line `_assign` change.
- `led_screen.gdshader` — `#define LED_AA` + `#ifdef LED_AA` block: where `max(|dFdx|,|dFdy|) * texsize > 1` the picture is
  the mean of 4 rotated-grid `textureLod` taps (no mipmaps needed). Low removes the define from the shader text at
  runtime (`apply_led`); the shader resource is held in a static var for the reason in the Investigation.
- `tracking/camera_overlay.gd` — AA + Environment effects follow the level (glow stays off).
- `xr/xr_walk.gd` — the VR mirror viewport gets the compact settings once, when made. `xr/xr_panel.gd` is a 2D UI
  panel (no 3D content), so there is nothing for these settings to act on; left alone.
- `app/previs_quality_probe.gd` + `.tscn` — a dev probe (below); not wired into `main.gd`.

**A bug found by the High level and fixed for every level:** with MSAA on, big white blobs with black dotted rings sat
above the rig. Bisected off-screen (MSAA off, glow off, cones hidden each removed it; fog, SSAO, SSR, sun, spots did
not): the cone shader's `pow(1.0 - along, ...)` — MSAA evaluates the varying `along` extrapolated past 1 at a
triangle's edge, `pow(negative)` is NaN, and glow spreads the NaN. Now `pow(max(1.0 - along, 0.0), ...)`; the same value
everywhere else, so Low is unchanged.

**Tests** — `tests/test_previs_quality.gd` (8 tests): the preset table (every level, clamping, no key Low lacks), level
names, `apply_viewport` (incl. compact and null), `apply_env` / sun / floor / budget, the LED shader switch following the
level, both cone shader variants (and the NaN guard), `Cone.apply` shadows (first N + the gobo spot, Low = only the gobo
spot), the level stored as a string in a private cfg file, the picker's items and Ultra tooltip.

## What was VERIFIED

- `./run-client.sh --test`: **24246 passed, 0 failed**; `--check`: boot OK, no script errors. `node tools/ci/check-max-file-lines.js`:
  0 files over 500. Offline JS suite (`node tools/ci/run-offline-tests.js`): 5050 of 5053 pass; the 3 failures are not this WO's: WO-710 and WO-789 smokes pin `live_tab.gd` / `timeline_tab.gd` source that another change (second-monitor tab hosting) rewrote, and the WO-846 hygiene smoke says INDEX.md is stale until `node tools/wo/build-index.js` runs for this WO's row.
- **Off-screen renders on the real GPU** (private Xvfb `:90`, probe client with its own `XDG_DATA_HOME` so it never
  touched the owner's `ui.cfg` or the project; Godot reported the NVIDIA device). `app/previs_quality_probe.tscn`:
  levels changed live in one process (no restart), 1920 x 1080 viewport, 4 cameras each, GPU ms = mean of 90 frames
  of `viewport_get_measured_render_time_gpu` on the wide view.

  | | Low | Medium | High | Ultra |
  |---|---|---|---|---|
  | synthetic stage (LED wall, 8 spot heads, boxes) | 0.43 ms | 0.53 ms | 1.53 ms | 4.93 ms |
  | live project's rig (199 heads, 64 lights, haze 0.35) | 1.04 ms | 1.70 ms | 2.30 ms | 5.62 ms |

  These are **real GPU numbers** but noisy (an earlier pass read 0.46 / 0.63 / 2.62 / 6.34 on the synthetic stage): the
  GPU was serving Caspar at ~50 % at the same time, which is the situation on air. Read them as orders of magnitude:
  Low/Medium ~ free, High a few ms, Ultra ~ 5 ms+ at this size (and Ultra renders 2.25x the pixels).
- **Looking at the frames** (`/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/qp/qN_{wide,low,inside,far}.png`,
  N = level, synthetic stage; `.../qr2/` = the live rig; contact sheets `qp/sheet_*.png`): Low shows the heavy
  moire on the 1 / 2 px test patterns when the wall is far, Medium's is mostly gone, High / Ultra are nearly clean; beams
  end softly on the floor and walls instead of in a line; with the camera inside a cone (`inside`) Medium is calmer than Low (cone fade + LED taps), but that case is
  the least tested by eye; High shows the floor reflecting the beams / LED wall (SSR), shadows of the boxes and the
  heads, a little AO; Ultra adds the supersampled edges.
- **The real Previs tab on the Xvfb client** (`--tab=Previs --probe-perf`): the picker reads "Quality: Medium" beside Haze
  with a "GPU 0.3 ms" label.
- The dead end worth keeping: the first High renders had the NaN blobs (above); they were not the new effects but a latent
  shader bug that MSAA exposed. After the fix all four levels of the live rig are clean (`qr2/`).

Not verified / owner QA:
- **Spot shadows on fixture bodies**: a head's spot light sits at its lens, inside the body mesh; at High the shadow
  caster could in principle black the spot out. The live rig's heads (GDTF bodies) rendered fine at High with 16 shadowed
  spots (`qr2/q2_*.png`), but only the project's own head types were seen; if some model blocks its own beam, the
  fix is `cast_shadow = off` on that rig's body meshes (not done, nothing seen).
- Mac / Compatibility renderer: the cap to Low is the unit-tested logic (`max_level`) but was not run on a Mac.
- VR: the mirror viewport takes the quality when it is made, it does not follow a later change during a session.
- The globals (shadow filter, fog grid, SSAO / SSR quality, directional atlas) are RenderingServer-wide, so they also
  apply to the Visuals tab's own worlds while a level is active.
- Frame time of Ultra on the box's operator display while Caspar is on air — the picker's GPU label is there for that.

Run the probe yourself:
`setsid -f Xvfb :90 -screen 0 1920x1080x24 -nolisten tcp`, then
`DISPLAY=:90 XDG_DATA_HOME=<private dir with a copy of app_userdata> godot --path godot/client res://app/previs_quality_probe.tscn -- --out=<dir> [--levels=0,1,2,3] [--real] [--haze=0.65] [--off=glow,sun,ssr,ssao,msaa,smaa,spots,deband,lens,cones,lights,plaincone,noglow]`
(`--real` builds the live project's heads by GET only and lights every beam locally; nothing is sent to the server).
