# WO-1103 — Realistic woman / man test puppets (previs "puppet" bodies: MakeHuman CC0, planted-feet walk)

**Area:** tracking-vr, godot-client
**Status: DONE (16.11.26 — 8 Godot tests / 70 asserts + 4-test node smoke; on glass in the running GUI: Hilton Wawer stage, Low / High / Ultra × house 100 / 20 / 0 %, contact sheets, frame times 0–9 humans; three.js twin out of scope)**

Owner 16.11: *"try to create a woman and man avatars but try to make them as much human like as possible. just one per
gender is fine."* — then: *"the hq avatars are for previz purposes only as a 'puppet'"*. Licence rule (owner): *"we cant
bake anything into iso that i have no right to distribute"*.

Scope (coordinator, after the second message): Test puppets only (WO-1087) — not the People style, no per-presenter
body selector, no camera-derived traits / gender, no three.js twin, no `modules/**`.

## Investigation

### What exists

- **Test puppets** — `src/tracking/puppet-people.js` (WO-1087): 1–3 simulated persons with a random look (`traits`),
  wandering inside the tracking stage; `POST /api/tracking/puppet/people`; persons carry `puppet: true`.
- **People layer** — `person_avatars.gd` keeps one node per card; `person_avatar.gd` is the cartoon pebble
  (set_target per snapshot, step per frame, set_tag, shown()); `person_cards_model.gd puppet_cards` builds the cards.
- **Lighting rule** — the pebble's light() (WO-1099) is a saturating diffuse with a ceiling (no blow-out under
  several beams) and a readability floor tied to the house level (`house_lights.gd`); a new body must follow it or
  it glows / burns differently from everything else on the stage.
- **Probe** — `avatar_probe.gd` (`--probe-avatar=<dir>`, WO-1087) shoots the first avatar in the real client.
- **Quality** — `previs_quality.gd` levels Low / Medium / High / Ultra; spot shadows on High / Ultra.

### Asset route (licence read before anything was built)

- **Chosen: MakeHuman system assets via MPFB 2.0.18** (Blender 4.5.9, build-time tools only, not shipped).
  https://static.makehumancommunity.org/about/license.html — *"All core assets are shared under Creative Commons,
  CC0. [...] You do not need to pay anything, include any copyright notices nor give attribution."* The base mesh
  `base.obj` carries a CC0 header; `weights.game_engine.json` `"license": "CC0"`; MPFB2 LICENSE.md and the 2020 FAQ say
  the output of the tool is the user's. Generic, non-identifiable bodies (macro sliders), no real person depicted.
  Every shipped file and its sources: `godot/client/assets/people/LICENSES.json`; repo `THIRD_PARTY_NOTICES` section
  "MakeHuman system assets". (`licenses/` is a symlink — untouched.)
- **Rejected:** Quaternius / Kenney humans (CC0 but stylised — not "as human-like as possible"); Khronos glTF samples
  (no usable dressed adults); SMPL / SMPL-X (non-commercial licence); Mixamo, ReadyPlayerMe, MetaHuman, DAZ, Character
  Creator (EULAs forbid redistribution of raw assets / ISO); "free download" model sites (no provable chain).

## What was done

- **Bodies** (`tools/people/build_human.py`, `woman.json`, `man.json`, `pack_tex.py`, recipe `tools/people/README.md`):
  MPFB humans with the `game_engine` rig (53 bones), elegant-suit clothes, shoes, hair, eyebrows, eyelashes, eyes;
  decimated LOD1; exported GLB + WebP textures to `godot/client/assets/people/` (`.import` = `importer="keep"` so
  exports pack the raw files; loaded at runtime with GLTFDocument / Image.load_webp_from_buffer).

  | body | bones | LOD0 tris | LOD1 tris | height | GLB | textures |
  |---|---|---|---|---|---|---|
  | woman | 53 | 21 000 | 6 345 | 1.677 m | 1 376 648 B | 10 WebP, 708 602 B (skin light/mid/dark 2048², clothes + normal 1024², hair 1024², eyes 512², brows/lashes 256², shoes 512²) |
  | man | 53 | 24 368 | 6 251 | 1.801 m | 1 408 124 B | 11 WebP, 513 120 B (same + hair / shoes normals, no clothes normal) |

  Skin mid = 50/50 of the light and dark MakeHuman litspheres' textures.
- **Server** — `src/tracking/puppet-people.js`: `body` cartoon | woman | man | mixed (mixed: odd puppet woman, even man),
  `walk` (false = stand where they stopped), heights drawn in WOMAN_M 1.60–1.76 / MAN_M 1.72–1.88 m; persons carry
  `body` and `heading`; status reports both. Validated in configure.
- **Godot** — `human_body.gd` (load / cache / instance, parts, three skin tones picked from the puppet look's skin
  luma, materials), `person_human.gd` (the pebble's interface: set_target / step / set_tag / shown; scale = puppet
  height / model height; heading when standing; LOD switch 7 / 10 / 14 / 20 m per quality level),
  `human_gait_model.gd` (feet PLANTED in layer space, only a lifted foot moves; step length
  s·min(H·(0.15+0.18v), v/1.3); swing 0.8 T, lands 0.5 L ahead; standing: adjusting steps when > 7 cm / 0.45 rad off,
  ≤ 0.75 rad per step = turning on the spot; replant on a > 1.2 m jump), `human_pose.gd` (two-bone leg IK with pole,
  heel roll, reach-limited pelvis drop, pelvis sway / twist, spine counter-twist, level head, arm hang + swing, finger
  curl), shaders `person_light.gdshaderinc` (the shared saturating diffuse — the pebble now includes it, unchanged
  output), `person_human.gdshaderinc` / `.gdshader` / `_cards.gdshader` (albedo + normal, bounded sheen, self-light
  only as house lights go down; alpha-scissor hair / lashes). `person_avatars.gd` swaps pebble ↔ human per card
  `body`; `person_cards_model.gd` passes body / heading. UI: `puppet_people_row.gd` — Look: Cartoon / Woman / Man /
  Mixed + Walk checkbox (Tracking → Markers → Test people).
- **Probe** — `avatar_probe.gd` `go` with JSON → `avatar_probe_sweep.gd` (quality × house × view shots of every
  figure; or n local walkers' GPU / render-CPU / frame times); motion rows carry planted feet + drawn foot balls.

Why procedural: no licensed clip set (Mixamo is out), and clips slide unless root-motion-matched to the tracked speed;
planted feet + IK cannot slide by construction and follow any speed / turn the tracker produces.

## What was VERIFIED

- **Godot tests** `tests/test_human_puppet_wo1103.gd`: 8 tests, 70 asserts (bodies/LODs/textures, tone, card body +
  heading, layer pick + swap, feet never slide (planted floor point 0.000 m, drawn ball < 3 cm), faster = longer +
  quicker steps, standing still + turning on the spot, height). Full suite 29223 passed / 2 failed — both
  `test_pixelhue_programming_panel` (known flaky; 326/0 alone). One earlier run showed 42 fails from compile errors in
  another agent's half-written files (test_console_selection_wo857 deps) — gone on the re-run.
- **Node smoke** `tools/smoke/smoke-wo1103-puppet-humans.test.js` (curated, offline-test-files-2.js): 4/4 — API
  body / walk, assets + manifest + notices + recipe, Godot wiring.
- **Headless gait metrics** (10 s runs): steady-state slip 0.000 m; cadence 1.3 / 1.6 / 1.9 / 2.0 steps/s at 0.4 / 0.8
  / 1.2 / 1.4 m/s; pelvis drop woman 3.6 cm @1.2 m/s, man 5.1 cm; CPU 64–95 µs / frame / human.
- **On glass** (running GUI, project "90C PGRP Hilton Wawer", fronts already on Auto / handover 3 heads — the live
  fixtures slice was not changed, output / DMX / PSN masters stayed off; ui.cfg byte-identical after):
  - contact sheets Low + High × house 100 / 20 / 0 % × front / three-quarter / face / side / stage, and humans next to
    the cartoon at High 100 % (scratchpad `wo1103/sheet_High.png`, `sheet_Low.png`, `sheet_vs_cartoon.png`,
    `sheet_walk_woman.png`). Lit by the beams like the stage, dark outside them at house 0 % (as the stage is), no
    glow, no blow-out under 2–3 beams.
  - walking woman (server puppet, 6 s, 454 frames): 576 planted-foot samples, drawn foot ball vs planted point max
    0.00000 m; 9 plantings in 6 s at 0.42 m/s.
  - frame cost (stage view, 100 Hz display, 240 frames): Low GPU 0.37 → 0.40 (3) → 0.42 ms (9); High 0.76 → 0.88 (3)
    → 0.97 ms (9); Ultra 2.13 → 2.44 (3) → 2.35–2.58 ms (9); render-CPU +0.05–0.3 ms; window held 100 fps (p95 10.1 ms)
    on High / Ultra with 9; Low's first rows 85–99 fps right after a relaunch (startup noise, 3 humans = 99 fps).
- **Verdict**: at stage distance clearly a woman / a man in office clothes walking naturally — reads far better than
  the pebble for previz; close up the faces are MakeHuman-plausible (not photo-real: flat-ish skin, hair cards).
- **Not verified**: shadows isolated per quality (they cast — default cast_shadow — but no A/B shot); the Look / Walk
  row seen on glass (tests + smoke only); a 3rd human at count 3 via the server UI; three.js twin (out of scope).

**Switch**: Tracking → Markers → Test people → Look (Cartoon / Woman / Man / Mixed), Walk; or
`POST /api/tracking/puppet/people {"body":"woman"|"man"|"mixed"|"cartoon","walk":true}`. Left on the box: Test people
on, 2 puppets Mixed (one woman, one man) walking, TTL 120 min.
