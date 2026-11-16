# WO-1099 — House lights: a 0–100 % slider that dims the room so only the rig lights it (previs + games)

**Area:** godot-client, tracking-vr, lighting
**Status: DONE (16.11.26 — Godot model tests 29151/0, on glass in the Hilton show at Low/Medium/High/Ultra × 100/50/20/0 % with GPU timings; games: server + client smokes, box API round-trip, headless-Firefox shots of the on/off version)**

Owner 16.11 (verbatim): "add the ability to turn off the 'sun' so users can only see the rigs lights." Then: "why are
light beams gray??? like smoke???" (a mid-work regression, below) and "i hope there will be a slider for house lights".

## Investigation

How the previs 3D views were lit (before this WO, `previs_stage.gd`, `previs_quality.gd`, `fixtures/*`):

- **Environment** (`previs_stage.gd:35-45`): background colour, ambient light from a colour (0.25, 0.25, 0.3) at energy
  1.0, glow, linear tonemap (LED colours true, WO-595), no auto exposure. Volumetric fog only as Haze (WO-786).
- **Sun**: one `DirectionalLight3D` at energy 0.6 (`previs_stage.gd:47-50`), shadows from High up (`sun_splits`),
  `light_volumetric_fog_energy` 0 (haze shows beams, not a lit room). The tracking Camera view's stage overlay
  (`tracking/camera_overlay.gd attach`) shares the stage's World3D (so the sun) with a copy of its Environment.
- **The rig** (`fixtures/fixtures_3d.gd`, `beam_cone.gd`): per beam an additive cone (ShaderMaterial, crisp at the lens,
  fading along the throw) and an emissive lens; a real `SpotLight3D` (energy = intensity × 8, gobo projector) only for
  the first `MAX_LIGHTS` = 64 beams **in build order**, shown while lit (`sl.visible = lit`, HEAD `fixtures_3d.gd:419`);
  shadows on the first `spot_shadow_budget` (High: 16). So in a big rig the lights went to whichever heads were built
  first, not to the lit ones — with the room dark that decides where pools appear.
- **Venue**: the venue .glb / MVR objects are StandardMaterial3D (the Hilton hall has no emissive materials — every
  material probed at energy 0); GLB screens and Stage-panel walls are emissive LED pictures (`led_material`,
  `led_screen.gdshader`). Avatars (`person_avatar.gd`, WO-1086) glow at `self_light` 0.3 + rim 0.2 (readable in any light).
- **What the fixtures contributed**: the cones and lenses are self-lit (independent of any room light); the spot lights
  add the pools, lit walls and lit people — with the sun and the 1.0 ambient on, those pools were barely visible on
  the carpet.

**Grey "smoke" beams (owner, mid-work):** the GUI was relaunched (13:43) while this WO's files were half-written —
`beam_cone.gd` used `F.LIT` before `fixtures_3d_model.gd` had it, the cone script failed to compile ("Nonexistent
function 'apply' in base 'GDScript'", `fixtures_3d.gd` `_quality`), the cone `Shader` never got its code and every cone
drew as a default grey opaque mesh. Not a lighting change; a cross-file write order. Fixed by landing the consistent
set (dependencies first), `run-client.sh --check`, relaunch; checked on glass (below). Lesson kept in the memory note
"Godot edits are live for relaunches".

## What was done

**Model — `godot/client/features/previs/house_lights.gd` (new):** one per-client level (ui.cfg `[previs] house_lights`,
0..1, default 1 = the views exactly as before; `house_last` = the level the toggle returns to; `avatar_floor`).
- `gain(level) = level^2.2`: the slider is perceived brightness — every house light scales by it, so 50 % looks about
  half as bright on the sRGB screen (22 % linear light), 20 % is a dim room, 0 % dark. Continuous, no steps.
- **Follows the level:** the stage's ambient energy (`gain`), the sun (`0.6 × gain`; hidden only at 0 where its energy is
  already 0 — no pop), every emissive BaseMaterial3D of the venue/models (their own energy × `gain`; originals kept in
  material meta and restored exactly), the avatars' self-light and rim (`lerp(floor 0.06, 0.3, gain)` — a presenter
  outside every beam still reads, without glowing in the dark).
- **Does not follow (show light):** the rig (`fixtures_3d.gd` marks itself `show_light`): cones, lenses, spot lights;
  LED walls / TVs / projections (`led_material` marks its picture `show_light`; `led_screen.gdshader` and projection
  materials are ShaderMaterials and never touched); camera cut-outs (cards / dummies are unshaded pictures); helpers
  (tracking frusta, marks, labels — unshaded).
- **Camera view overlay does not follow** (it is a geometry aid over the real camera picture): it keeps its own copied
  Environment and takes `overlay_ambient = 1 + 1.5 × (1 − gain)` to stand in for the shared sun when it dims.
- **Live 3D** follows (it is a previs stage; same per-client pref as Quality / Haze). **VR** follows (the XR walk lives
  inside the previs stage).
- Slider steps are cheap: `previs_stage.gd` collects the glowing materials once per tree change (`House.collect`,
  re-collected after a venue/model load via `node_added`, one deferred rescan) and a step only writes numbers
  (`House.dim`). Measured 0.008 ms CPU per step, all listeners.

**UI — `House.control()` beside the Quality menu** (`previs_quality.gd picker()`, so on every toolbar that has the
Quality menu): a flat "House 100 %" button (click: off in one click, again: back to the last level) + a 0–100 % HSlider
(live while dragging, saved once it rests 0.4 s; no keyboard focus, so arrows stay with the 3D nudge keys). The first
version's On / Dim / Off submenu in the Quality menu was replaced by it. Next to the GPU label a hint while below 100 %:
"House lights 50 %" / "House lights off", plus " — rig dark" when no beam is lit at ≤ 30 % (a dark view is on purpose).

**Real lights — `beam_cone.gd pick()`** (called from `Cone.apply` on quality changes and from `fixtures_3d.gd apply()` on
every DMX frame): of the lit beams (intensity > `F.LIT` 0.004) that carry a SpotLight3D, the brightest `cap` shine
(ties: build order), the first `spot_shadow_budget` of them with a shadow (gobo spots keep theirs); the rest are hidden.
Caps per tier (`previs_quality.gd` "lights"): **Low 24, Medium 48, High 64, Ultra 96**; shadows only from High (the
existing budget 16, Ultra 32). `MAX_LIGHTS` (spot nodes built) 64 → 128 so Ultra's cap can be met. The lights shine at
every house level (nothing switches at a threshold).

**Games** (RC / Skirmish / Salad, three.js; `modules/rc-game/client/house.js` shared, Skirmish / Salad via their
`kit/` alias): a host option "House lights" just above "Live lights in the game" — first a checkbox, then (owner's
slider request) a 0–100 % slider (`house-slider.js`: label click = off ↔ last level, posts throttled to 100 ms plus
once on release). Server: `state.house` 0..1 (default 1, kept like lights / wall across disable / enable; boolean `on`
still accepted). Clients (players and spectators share `game.js`): the game objects share the hemisphere + sun with the
room, so the room is darkened on its own materials — lights × (0.3 + 0.7 g), room colours × (0.1 + 0.9 g), venue glow
× g, background lerped to near black, g = level^2.2 (same curve as the previs); 1 restores exactly. The rig's beams /
pools, the LED wall pictures and the games' own objects are not dimmed.

**Dev probe — `app/house_lights_probe.gd`** (`--probe-house=<png prefix>`): through the running client, per tier and
level 100 / 50 / 20 / 0 %: the stage view's measured GPU ms, lit beams, and stage-view PNGs from the Front preset, a
low "pool" camera on the brightest beam's floor hit, and ISO; then the slider-step cost. Levels are set live, not saved.

## What was VERIFIED

- **Godot tests** (`tests/test_house_lights_wo1099.gd` + `test_previs_quality.gd`): default 100 % and ui.cfg
  persistence (temp path), a drag step live but unsaved, the toggle (off → back to the last level, also after a drag to
  0, remembered as `house_last`, nothing remembered → full), the curve (ends 0 / 1, 50 % ≈ 22 % linear, strictly rising,
  no 1 % step above 0.025, clamped), stage ambient + sun on the curve (near 0 still on with ~0 energy — no pop), venue
  glow dims / restores exactly while the rig lens and LED pictures stay, avatar floor and rim, overlay fill, hint
  texts, per-tier light caps [24, 48, 64, 96], pick (the 3 brightest of six get the lights, the shadow on the first, a
  dark rig no lights), the slider control (0–100, no focus), source pins. Client suite **29151 passed, 0 failed**.
- **On glass** (Hilton Wawer project, the running client, `--probe-house`, rig as the engine computed it from live DMX:
  3–4 lit beams of 8 heads). Stage-view shots per tier × 100 / 50 / 20 / 0 % in `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/probe2/`, montages
  `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/s_Low.png`, `s_Medium.png`, `s_High.png`, `s_Ultra.png`, `g_lu.png`; first on/off run `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/probe1/`, `g_front.png`,
  `g_pool.png`. Judged:
  - **Beams at every tier and level: white (the fixtures' colour), additive, crisp at the lens and fading along the
    throw — never grey or smoky.** At 0 % they read strongly against the black room; on High / Ultra at 100 % they look as
    before (same cone shader, untouched by this WO).
  - The dim is even: 50 % reads as a half-lit room, 20 % a dark room with the walls still faintly there, 0 % black; no
    pop between steps (the sun's shadows fade with it on High). LED walls keep their brightness at every level; on
    Ultra at 0 % the walls' red spill shows on the ceiling (SSIL) — a believable dark room.
  - Pools: on the carpet beside the presenter the spot lights draw real pools (`*_000_pool.png`); on the stage deck
    (a near-black material in this venue) they stay faint — the deck's albedo, not the light.
  - The avatar is lit by the beams (face and shoulders from the beam side) and keeps a dim floor outside them.
  - Toolbar: "House 100 %" + the slider beside "Quality: Low" (window shots in `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/wo1099/sel/`).
- **Frame time** (stage view's measured GPU ms, average of 90 frames, same Front view; fps is the window's, vsync-bound):

  | Tier | 100 % | 50 % | 20 % | 0 % |
  |---|---|---|---|---|
  | Low | 0.35 | 0.37 | 0.40 | 0.36 |
  | Medium | 0.44 | 0.41 | 0.39 | 0.41 |
  | High | 1.00 | 1.01 | 1.02 | 0.70 |
  | Ultra | 2.80 | 2.60 | 2.65 | 2.01 |

  Off is cheaper on High / Ultra (no sun shadow pass). A slider step costs **0.008 ms** CPU (101 steps, all listeners).
- **Camera overlay**: not dimmed by design (pinned in the tests; the overlay was not shot on glass in this run).

- **Games:** `smoke-wo1099-house-server` (per game: 409 while disabled, default 1, level clamped, boolean compat, 400s,
  the broadcast carries the level, survives disable / enable) and `smoke-wo1099-house-client` (curve, 0 = old off,
  1 = old on, exact restore, idempotent, toggle helper, source pins on all three host / game pages) — 41 / 41 with the
  host-action pins of WO-1074 / 1081 / 1089; game smokes overall 439 / 439. Box: node restarted, per game enable →
  `house` 0.5 → read back → 1 → disable (all three left disabled). Headless Firefox (private Xvfb :117) shots of the
  on/off version, players and spectators, all three games: `/tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/games/*-grid.png` — the dark room with the cars /
  soldiers / veggies readable and the beams and pools strong (`salad-spect-grid.png` judged: dark room, LED wall
  unchanged, coloured beams vivid).

**Not verified:** the games' slider rendered in a browser (its layout and drag rest on the smokes; the dimming it drives
is the on/off code at intermediate g); a venue with emissive materials (the Hilton hall has none; the dim/restore of glow is covered by the
tests only); VR on the headset; a big rig where the per-tier cap actually bites (this show has 8 heads); a physical
drag of the slider by mouse (the level was driven through the same model the slider calls); Live 3D on glass.
