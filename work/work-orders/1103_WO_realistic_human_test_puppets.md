# WO-1103 — Realistic woman / man test puppets (Rocketbox MIT bodies + motion capture; bring-your-own / MetaHuman DNA slot)

**Area:** tracking-vr, godot-client
**Status: DONE (16.11.26 — exit-134 heap corruption from 5e9c8fb2 fixed, full Godot suite exit 0 ×5; Godot human tests 147/147, smokes 9/9 (puppet 6 + DNA converter 3); on glass in the running GUI: contact + comparison sheets Low / Ultra × house 100 / 35 %, stride feet metrics, frame times 0 / 1 / 3 / 9 humans, own FBX puppet live; MetaHuman DNA route built against the format — NOT tested with a real DNA file, none on the box)**

Owner 16.11: *"try to create a woman and man avatars but try to make them as much human like as possible. just one per
gender is fine."* — *"the hq avatars are for previz purposes only as a 'puppet'"* — then, on the first version: *"the
human avatars are walking weird. also i cant belive we cant get better quality meta humans"* — and, on Fab's
OpenRigLogic Sample Content: *"lets use this model"*. Licence rule (owner): *"we cant bake anything into iso that i have
no right to distribute"*.

Scope: Test puppets only (WO-1087), previs only; Cartoon stays the default; no `modules/**`, no People style, no
camera-derived traits / gender, no three.js twin.

## Investigation

### Baseline (what was on glass until 680dbd08, 16.11 ~15:30)

MakeHuman CC0 bodies (MPFB 2.0.18, 53-bone game rig) with a procedural planted-feet gait + two-bone leg IK (commits
3af59570, 5e9c8fb2, 65d104da, 5c8d65d5). The feet never slid (0.000 m), but the owner judged the walk "weird": an IK
gait without real body mechanics (no heel-toe roll timing, arm / shoulder / spine motion synthetic) reads as robotic,
and MakeHuman faces / skin read as plasticky close up. Both points were acceptance failures → the route was replaced.

### Asset routes compared (licence first)

- **Chosen: Microsoft Rocketbox Avatar Library — MIT.** `LICENSE.md` at the pinned commit
  `0943055db6ec570bcef9f2c8b41c9e5467c808f9`: *"MIT License / Copyright (c) 2020 Microsoft / Permission is hereby
  granted, free of charge…"*; README: *"November 2020 License Update — The library of avatars is now released under
  MIT License"*, *"4/2022: Release of 417 animations…"* (motion capture, same skeleton). 115 rigged, textured, dressed
  avatars (hi-poly ~10k tris, 81-bone 3ds Max biped incl. face / lid bones), generic people, none depicting a real
  person. Redistribution incl. ISO is allowed with the notice (THIRD_PARTY_NOTICES + per-file `LICENSES.json`).
  Candidates on glass (Ultra, house 100 / 35, front / three-quarter / face): Business_Female_01 (f014),
  Business_Female_04 (f020), Business_Male_02 (m008), Business_Male_03 (m020) — all four read as human; picked
  **F04 + M02** (M02's navy reads better on the dark deck than M03's grey).
- **Rejected:** MakeHuman (the baseline: CC0 but the look and the procedural walk were the complaint); Quaternius / Kenney
  (CC0 but stylised); CMU mocap (free, but BVH on another skeleton — Rocketbox ships clips on its own rig); Godot demo
  characters (stylised / no adult humans); SMPL / SMPL-X (non-commercial); Mixamo, ReadyPlayerMe, MetaHuman, DAZ,
  Character Creator OUTPUT (EULAs forbid redistributing raw assets → never shipped; usable only per machine, below).

### Why native .scn and not GLB

A glTF round trip turns Rocketbox's unweighted root bone `Bip01` into a node; the clips' `Bip01` tracks then resolve
to nothing. The bake (`tools/people/rocketbox_bake.gd`) keeps FBXDocument's skeleton and packs a native scene.
Skeleton quirks found: thighs parent to `Bip01 Spine` (biped), clavicles to the neck; rest pose is an A-pose.

### MetaHuman / OpenRigLogic (sources actually read)

- github.com/EpicGames/OpenRigLogic — `LICENSE` *"MIT License / Copyright (c) 2026 Epic Games, Inc."*; README:
  *"OpenRigLogic contains the RigLogic and DNA libraries…"*; *"Sample assets and the MetaHuman Faceboard Control Rig
  may be acquired separately via the OpenRigLogic Sample Content listing on Fab (available under the Fab Standard
  License)"*; *"The exported package contains a DNA file for the head and a DNA file for the body… The character's
  textures are also included. Groom and clothing information is not currently part of this package."* Branches: `main`
  (experimental), `5.8` (production-ready, `d3d329bbd6992ac38adc1c1b24203ceb998f75c0` on 16.11). The repo holds no
  characters. Read: README, LICENSE, `include/dna/layers/{Definition,Geometry,Descriptor}Reader.h`, `src/dna/DNA.h`,
  `python/dna/{CMakeLists.txt, examples/demo.py, tests/test_dna.py}`, `include/tdm/Types.h`, root `CMakeLists.txt`.
- DNA format (`src/dna/DNA.h`, 59.5 KB): terse-serialised, versioned v21 … v28 dispatch, section lookup / index tables,
  layered (descriptor, definition, behaviour, geometry, ML / RBF / twist-swing). A clean-room port is possible in
  principle (MIT allows it) but every version / layer path would be untestable here without a real file — tests would
  only prove agreement with our own reading of the headers.
- **Fab listing "OpenRigLogic Sample Content"**: *"Sample MetaHuman assets ready to be used with the OpenRigLogic
  repository for testing and validation."* Included formats: **Unreal Engine** + **Additional files**. *"Allows usage
  with AI: No."*
- **Fab Standard License** (fab.com/eula — the static page carries only the summary; the full EULA text loads by
  script and was not reachable, so this rests on Fab's published summary, which itself says *"This summary of license
  terms is for your convenience only and is not legally binding"*): You may *"Use the assets commercially or
  privately"*, *"Modify and adjust the assets in order to incorporate them into your Projects"*, *"Commercially
  distribute your Projects with the Fab assets incorporated into it"*, *"Use the assets with any compatible tools
  (usage is not limited to Unreal Engine)"*, *"Share the asset (directly, via a private repository or in the Project)
  with your collaborators that are working on the Project with you"*. You may not: *"Resell or redistribute the asset
  for free on a standalone basis or allow others to do the same"*.
  → **Conclusion:** fine to USE on the owner's machines; never committed to the public repo, never in a release or the
  ISO. Converted / cached outputs (GLB, textures) are derivatives and stay beside the source outside the repo. A
  second box gets it only by a deliberate private copy. Test fixtures are synthetic files of our own. The asset is
  never fed to an external AI / vision service (local conversion code only).
- **Sample on the box:** NOT present (checked ~/Downloads and the session uploads 16.11 at three points). Needed from
  the owner: the Fab **Additional files** download (the DNA files + textures), not the Unreal Engine format — `.uasset`
  cannot be read outside Unreal.

## What was done

### Shipped bodies (commit 680dbd08)

- `tools/people/rocketbox_build.sh <work> [--install]` (pinned commit) → `rocketbox_bake.gd` (Godot headless:
  FBXDocument → `<body>.scn` with LODs from `ImporterMesh.generate_lods`, clips → `<body>_moves.res`: root motion
  out, walks cut at the left heel strike to a 1 s cycle with `speed` / `stride` metadata, turns with yaw curves) →
  `rocketbox_tex.py` (TGA → WebP: colour 2048², normal / specular 1024², opacity RGBA). Re-run gave byte-identical
  WebP; the recipe's exact outputs are installed.

  | body | source | bones | tris (LOD0) | LODs per surface | height | files |
  |---|---|---|---|---|---|---|
  | woman | Business_Female_04 (f020) | 81 | 8 270 | 6 | 1.717 m | scn 228 KB, moves 608 KB |
  | man | Business_Male_02 (m008) | 81 | 7 448 | 5–6 | 1.791 m | scn 205 KB, moves 531 KB |

  `godot/client/assets/people/` total 4.1 MB (+ 7 WebP per body). 8 clips per body: idle, walk_slow / walk /
  walk_fast, turn_left/right_60/90 (Rocketbox `all_animations_max_motextr_xy/_static/_xyz`).
- Look: body / head / opacity materials with normal + specular maps, light SSS on the head
  (`person_human.gdshaderinc`), hair / lashes from the opacity sheet with alpha scissor + alpha-to-coverage, shadows on
  High / Ultra (contact via the quality level's spot shadows), LODs, lit by the WO-1099 stage rule (no glow with the
  house up).
- Motion (`human_motion.gd`): AnimationTree (manual advance) — BlendSpace1D of the three walks by speed blended with
  idle (0.06–0.32 m/s start / stop ramp, MOVE_RATE 4.5 → ~0.22 s transitions); **cycle rate locked to ground speed**
  (TimeScale = speed / stride(speed)); standing turns play the turn clips when the heading error > 0.6 rad.
- **Blink** (`human_blink.gd`, 4a3ce352): the Rocketbox lid bones swing round the eyeball's centre every 2.2–6 s
  (0.07 s close / 0.04 hold / 0.13 open).
- Server: `body` cartoon | woman | man | mixed | own:<slug>; `walk`; heights WOMAN_M / MAN_M / OWN_M from the same draw.
- UI: Tracking → Markers → Test people → Look (Cartoon / Woman / Man / Mixed / Own: …), Walk, "?" help.

### Bring your own (bdbb6d5e, 07288015) — per machine, never shipped

- Folder `~/.local/share/highascg/puppets/<name>/` (always under $HOME — run-xr.sh moves XDG_DATA_HOME). `.glb` /
  `.gltf` / `.fbx` (+ textures), optional `puppet.json` {name, moves}.
- `human_own.gd`: runtime GLTFDocument / FBXDocument import; 150k-tri warning / 1M refusal; textures > 2048 px scaled;
  LODs generated; importer helpers (AnimationPlayer, BoneAttachment3D) removed; `human_rig_map.gd` maps humanoid
  bones by normalised name (Unreal / MetaHuman, Mixamo, Max biped / Rocketbox, Rigify, VRM, Godot humanoid; spine by
  structure) and refuses a non-humanoid naming the missing bones; placed to face +Z, soles at 0, height from the
  **skinned rest pose** (a skinned mesh's own AABB is in bind space — gave 0.31 m for an FBX); stable node names
  (`Model`, `N1…` — generated `@Node3D@27` names broke the clip paths after duplicate()); `human_retarget.gd`
  retargets the shipped clips (global = Δ·A·rest, hips travel × hip-height ratio, speed / stride metadata × k);
  `human_own_tex.gd` matches FBX textures by file name (words every image shares ignored, so hair never takes the
  body's normal map); hair / lash / opacity surfaces alpha-cut with A2C, skin SSS, Unreal-only overlay surfaces hidden.
  Report per load (file, tris, bones mapped / missing, height, moves, warnings, ms) under the Look row.
- Never distributed: eggs exclude lists name `home/*/.local/share/highascg/puppets(/*)` (inside the WO-1094 exclude of
  the whole `.local/share/highascg`); `verify-iso-detection-runtime.sh` fails on that path and on any `*.dna`;
  `exfat-sync-map.js` never syncs `*.dna`; `.stignore` + `.gitignore` `*.dna` (**mirror the .stignore line on the Mac**).
  The loader code only reads (smoke asserts no write API in it).

### MetaHuman DNA route (6843473b, 9369dfd4)

- Decision (option a vs b): **a — the owner builds Epic's own DNA library once per machine and an offline Python
  converter uses it.** A clean-room port (b) of a v21–v28 versioned layered format cannot be validated without a real
  file; Epic's reader is authoritative for every version. Revisit (b) once a real file exists here: the owner-built
  library can then produce golden dumps to test a port against, on this machine only.
- GDExtension vs offline bindings: a GDExtension (RigLogic in-engine) would allow live facial expressions but costs a
  C++ build per Godot version / platform, a binary per machine, and days of work — for a puppet that walks with a
  neutral face it buys nothing. Offline bindings: ~0 runtime cost, one 5–10 min owner build. **Recommended: offline.**
- `tools/people/openriglogic_build.sh` (OWNER-RUN; agents do not clone / build): pinned 5.8 commit, static library +
  `dna` Python module, Epic's DNA Python test, → `~/.local/share/highascg/openriglogic/`. Needs
  `sudo apt install git cmake g++ swig python3-dev`.
- `tools/people/dna_to_glb.py <folder>`: reads every `.dna` in the folder; neutral joints (translation unit, rotation
  unit, axes, Euler sequence / signs from the descriptor; a "mirrored" axis declaration caught from the `_l` / `_r`
  joint sides); one LOD (default 1); polygons fan-triangulated with the winding the stored normals agree with; 4
  heaviest skin weights; head + body joints merged by name; materials named by the mesh word (head / body / teeth …)
  so textures match by file name → `<folder>/<name>.converted.glb` + `convert.json` progress. Stdlib only, sends
  nothing anywhere.
- GUI: a DNA-only folder is listed; picking it starts the converter in the background (`human_own_dna.gd`), the row
  shows progress / failure (dead process → failed), and the body loads without a restart once the GLB is there.
- Help page `godot/client/help/own-test-puppet.md` (marked untested with a real MetaHuman export): folder, needs,
  never shipped, **"MetaHuman: what is and is not possible here"** (Unreal-export route, DNA route, what looks worse,
  the Fab quotes above, sources).

**What looks worse than in Unreal** (stated on the help page): no hair / eyebrow / beard strands (no groom in the DCC
export or the sample), no clothes (body mesh only), neutral face (no RigLogic expressions, no correctives), previs
shading instead of MetaHuman skin / eye shaders (eye edge / occlusion / tear meshes hidden), one LOD and ≤ 2048 px
textures, the shipped puppets' moves retargeted.

## What was VERIFIED

- **Godot tests** (`run-client.sh --test`, HIGHASCG_TEST_ONLY=test_human): **147 passed / 0 failed** —
  `test_human_puppet_wo1103.gd` (bodies, ≥ 2 LODs per surface, maps, heights 1.72 / 1.79, clips, card / layer, walk:
  stance share > 30 %, 7–14 plants in 6 s, planted drift < 4 cm, cadence × stride = speed, standing still, turn
  clips turn on the spot, height scaling, blink closes briefly with the lid in front of the eye) and
  `test_human_own_wo1103.gd` (bone names of every convention, MetaHuman spine, refusal names missing bones, a
  **synthetic Mixamo-named T-pose humanoid of our own** written as GLB → listed, turned, height 1.76, walks with toes
  on the floor and drift < 8 cm; FBX textures by name survive the look pass; DNA folder → converter start / missing
  library message / dead job / progress text / converted GLB loads). Help tests 70 / 70.
- **Smokes**: `smoke-wo1103-puppet-humans.test.js` 6/6 (API incl. own:<slug> refusals, never-distributed excludes —
  the ISO verifier fails on `…/puppets/…glb`, a converted GLB and a `*.dna`, sync map / Syncthing / git —, shipped
  files + MIT manifest + notices + recipe, wiring); `smoke-wo1103-dna-convert.test.js` 3/3 (stand-in `dna` module
  answering from a synthetic character of our own: valid glTF 2.0, 29 merged joints, left on +X despite a mirrored
  declaration, IBM × global = I, vertices at their joints, metres, LOD pick, CCW fronts, 90° Euler joint, progress
  file, refusals). The converted synthetic GLB loaded in Godot: 22/22 humanoid bones mapped (MetaHuman names), walks
  1.2 m/s with cadence 0.88.
- **On glass** (running GUI, Hilton Wawer project, stand-ins at PSN (11.05, −3.5, 0.639); scratchpad
  `wo1103/sheet_contact.png`, `sheet_compare.png`, `blink_sheet.png`, `own_live_sheet.png`):
  - contact sheet woman / man at Ultra, house 100 %: front, three-quarter, face, three stride frames — natural
    heel-toe gait with arm swing; faces read as people (Rocketbox quality: good at stage distance, game-like close up).
  - comparison: cartoon / woman / man fronts at Low and Ultra × house 100 % and 35 %; at 35 % the suits go dark like
    the rest of the stage (no glow), still readable.
  - stride at 1.2 m/s, Ultra (feet json over 4 s): woman L 33 % still / 3 plants / drift 0.018 m / median stance speed
    0.057 m/s; R 43 % / 4 / 0.028 / 0.084; man L 44 % / 4 / 0.034 / 0.053; R 43 % / 4 / 0.015 / 0.034; cadence woman
    0.84 Hz, man 0.88 Hz — the stance toe roll (heel-toe) is the residual motion, no skating.
  - blink: lids shut / open on both faces (held-closure probe).
  - own puppet live: Rocketbox F01 FBX as `own:rb_f01` in the real puppets folder, server node restarted for
    `own:<slug>`: report "8966 triangles, 81 bones (22 mapped), 1.74 m, moves woman", textured, walking.
  - frame cost (stage view 9 m, 240 frames, 100 Hz display): Low GPU 0.31 (0) → 0.37 (1) → 0.43 (3) → 0.41 ms (9);
    Ultra 2.03 → 2.40 → 2.46 → 2.36 ms; render-CPU 0.14–0.31 ms; window 100 fps throughout (one 93 fps row at
    Ultra / 3, p95 10.08 ms).
- **Not verified / owner**: a real MetaHuman DNA or Unreal export (none on the box) — the converter's axis / Euler /
  winding handling follows the headers and is proven only on synthetic data; `openriglogic_build.sh` not run (agents
  do not build external projects) — syntax-checked, CMake options read from the 5.8 tree; the Fab EULA full text
  (summary only).

**Verdict:** the walk is now real motion capture, rate-locked, feet planted within 2–3 cm, smooth start / stop and
turns on the spot — it no longer looks weird. The shipped Woman / Man are the best redistributable humans found
(Rocketbox MIT): convincing people at previs distance, clearly game-grade in a face close-up (no MetaHuman skin /
hair). MetaHuman-level quality cannot be shipped (Fab licence); it can be used per machine through the DNA route once
the owner downloads the sample's Additional files and runs the build script — with no hair, clothes or expressions.

**Switch:** Tracking → Markers → Test people → Look; or `POST /api/tracking/puppet/people
{"body":"cartoon"|"woman"|"man"|"mixed"|"own:<name>","walk":true}`.

## Follow-up: exit 134 at the end of the Godot test run (introduced here, fixed 16.11)

**Investigation.** CI on main went red after the push (run 43926522432, job godot: `[tests] 29422 passed, 0 failed`,
then glibc `corrupted size vs. prev_size while consolidating` → `Aborted` → exit 134). I had reported this as
"pre-existing (clean HEAD too, WO-676)" — **wrong**: the coordinator's bisect over today's commits puts the first bad
commit at **5e9c8fb2** (this WO; 3af59570 and earlier exit 0). Narrowed on the box with a copy of the runner that runs
chosen files / methods (13 s per full run):
- full suite without `test_human_*` → exit 0; without `test_human_own_wo1103` → 134; without `test_human_puppet_wo1103` → no abort;
- bisecting the other 303 files against `test_human_puppet_wo1103`: `test_camera_overlay.gd` + it → 134 every time —
  even with none of the overlay's methods run (only its preloads): the overlay only shifts the heap layout, it is not
  the cause; alone, the puppet file exits 0 (why "only my files" looked clean);
- inside the puppet file every test that builds a body instance aborts; a scratch test narrowed it to
  `Body.material()` → to its one-time `House.shared().changed.connect(func(_h): house())`: setting `_house_hooked`
  first → exit 0; a static func that only connects a lambda to `House.shared().changed` → 134; the same with a
  static-method Callable → exit 0 (3/3).
- **Root cause:** a GDScript lambda created inside a **static** function, left connected to the signal of a
  **static-held RefCounted singleton** (`house_lights.gd` `_shared`). Both live until script teardown at exit, where
  the lambda (owned by the static context of `human_body.gd`) and the singleton are released in an order that frees
  the lambda's memory twice → glibc abort. No valgrind on the box (`sudo apt install valgrind` if wanted); gdb's
  backtrace (stripped binary) only showed `_int_free` under `main` teardown; found by elimination.
- **Live GUI exposure:** same code in the GUI (any human puppet shown makes the material and the hook). Teardown-only:
  while the process runs the lambda is valid. A clean quit (window close) after humans were shown could abort / corrupt
  on the way out; a TERM (how the run loop / relaunches stop it) ends without script teardown — no crash in
  gui.log … gui6.log. Not exposed mid-show.

**Done.** `human_body.gd`: the hook is the static method `_on_house(_h)` → `house()` (a plain Callable on the script,
which the engine disconnects safely), with a comment why never a lambda there. Test `test_house_relights_through_a_static_hook`
(`test_human_puppet_wo1103.gd`): the connection is `_on_house` and not a custom (lambda) Callable, house down → the
readability floor on the shared material, back again. Also `test_dna_folder_converts_then_loads` now clears its
`user://wo1103_dna` scratch folder before and after (the direct CI command on the box uses the real user dir, where a
leftover converted GLB failed 3 asserts) and frees the template it loads.

**Verified.** Pair `test_camera_overlay` + `test_human_puppet_wo1103`: 134 → 0. `run-client.sh --check` boot OK.
Full suite `run-client.sh --test` five times in a row: exit 0 / 0 / 0 / 0 / 0, `[tests] 29442 passed, 0 failed`, no
glibc message. The exact CI command from the repo root (`godot --headless --path godot/client --script
res://tests/run_tests.gd`) twice: exit 0, 29442 passed. WO-1104 and WO-1105 carried the same wrong "clean HEAD /
WO-676" note — corrected there. Other static-func lambdas on static singletons exist (e.g. `previs_quality.gd:251`
on `Haze.shared().changed`) — not exercised by the suite, not changed here.
