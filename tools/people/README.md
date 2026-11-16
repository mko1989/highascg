# Building the human puppet bodies (WO-1103)

Output: `godot/client/assets/people/{woman,man}.scn`, `<body>_moves.res`, `<body>_<map>.webp` (licences: that
folder's `LICENSES.json`; the MIT text: repo-root `THIRD_PARTY_NOTICES`). Build-time only, no root.

    tools/people/rocketbox_build.sh <work dir> [--install]

1. Fetches, at the pinned commit `0943055db6ec570bcef9f2c8b41c9e5467c808f9` of the Microsoft Rocketbox library (MIT),
   the two avatars (`Assets/Avatars/Professions/Business_Female_04`, `…/Business_Male_02`: `Export/<name>.fbx` + the
   seven `Textures/<id>_*.tga`) and eight motion-capture clips per gender from `Assets/Animations`
   (`all_animations_max_motextr_xy/<g>_walk_{slow_01,neutral_01,fast_01}.max.fbx`,
   `…_static/<g>_idle_neutral_01.max.fbx`, `…_xyz/<g>_turn_{left,right}_{60,90}.max.fbx`) into `<work dir>/src`.
2. `rocketbox_bake.gd` (Godot 4.7, headless, in a throw-away project under `<work dir>/gp`): FBXDocument → the avatar as a
   native scene with generated LODs (`<body>.scn`; not GLB — a glTF round trip turns the unweighted `Bip01` root bone
   into a node and the clips lose it) and the clips → `<body>_moves.res` (root motion out, walks cut at the left heel
   strike to a 1 s cycle with `speed` / `stride` metadata, turns with `yaw` / `yaw_curve` metadata; the root height
   scaled from the clip actor's hips to the avatar's).
3. `rocketbox_tex.py` (Pillow): the TGA maps → WebP (colour 2048², normal / specular 1024², the RGBA opacity sheet).
4. `--install` copies the results into `godot/client/assets/people/`; the WO-1103 smoke checks `LICENSES.json` lists
   every shipped file.

Other Rocketbox avatars can be tried by changing `AV` / `PRE` in the script (the texture prefix is the `<id>` of the
avatar's `Textures/<id>_body_color.tga`).

## Own characters and MetaHuman DNA (per machine, never shipped)

An operator's own character lives in `~/.local/share/highascg/puppets/<name>/` (help page
`godot/client/help/own-test-puppet.md`; loader `godot/client/features/previs/tracking/human_own.gd`). Nothing from
there is ever copied into the repo, a release, the ISO, a stick, the bridge disk or a sync peer (eggs exclude lists +
`verify-iso-detection-runtime.sh`, `exfat-sync-map.js`, `.stignore`, `.gitignore` all name it or `*.dna`).

- `openriglogic_build.sh` — OWNER-RUN, once per machine: Epic's OpenRigLogic (MIT) at the pinned 5.8 commit, the
  static DNA library + `dna` Python module → `~/.local/share/highascg/openriglogic/`. Needs
  `sudo apt install git cmake g++ swig python3-dev`.
- `dna_to_glb.py <folder>` — a head + body DNA (+ textures) → `<folder>/<name>.converted.glb` (neutral joints, one
  LOD, skin weights, merged skeleton; progress in `<folder>/convert.json`). The Test people Look row starts it when a
  DNA folder is picked. Tested only against a synthetic stand-in (`tools/smoke/fixtures/wo1103-fake-dna/`,
  `tools/smoke/smoke-wo1103-dna-convert.test.js`) — never with an excerpt of a real MetaHuman.
