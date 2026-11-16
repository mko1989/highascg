# Human puppet bodies (WO-1103)

`woman.*` and `man.*` are the realistic bodies a previs **test puppet** can wear (Tracking → Markers → Test people →
Look: Woman / Man / Mixed). They are for previs only — never a tracked person's look, never inferred from a camera.

- **Source and licence: Microsoft Rocketbox Avatar Library, MIT** ("Copyright (c) 2020 Microsoft"; pinned commit
  `0943055db6ec570bcef9f2c8b41c9e5467c808f9` of https://github.com/microsoft/Microsoft-Rocketbox). The woman is
  `Business_Female_04`, the man `Business_Male_02` (artist-made characters); the motion is the library's own
  motion capture (`Assets/Animations`, same licence). Per-file sources: `LICENSES.json`; the MIT text: the repo-root
  `THIRD_PARTY_NOTICES`.
- **Made by** `tools/people/rocketbox_build.sh` (fetch at the pinned commit → `rocketbox_bake.gd` in a throw-away
  Godot project → `rocketbox_tex.py`); recipe in `tools/people/README.md`.
- **What is inside:**
  - `<body>.scn` — a native Godot scene: one skinned mesh (≈ 7–8k triangles, three surfaces `body` / `head` /
    `opacity` with generated LODs) on the 81-bone 3ds Max "Bip01" biped (eye-blink, jaw and lip bones included);
    metres, feet at y 0, facing +Z, the person's left +X; no images, no animation.
  - `<body>_moves.res` — an AnimationLibrary: `idle`, `walk_slow` / `walk` / `walk_fast` (in place, a 1 s cycle each
    starting on the left heel strike; metadata `speed`, `stride`), `turn_left/right_60/90` (root yaw as metadata
    `yaw` + `yaw_curve`).
  - `<body>_<map>.webp` — colour (`body`, `head`, 2048²), normal (`_n`), specular (`_s`), and `hair` (the RGBA
    opacity sheet: hair cards, eyelashes).
- The client reads the textures at run time (`human_body.gd`: Image from raw bytes), not through the editor import;
  each `.webp` has a `"keep"` `.import` so an export packs it as it is. The `.scn` / `.res` are native resources.
