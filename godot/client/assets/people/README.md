# Human puppet bodies (WO-1103)

`woman.glb` and `man.glb` are the realistic bodies a previs **test puppet** can wear (Tracking → Markers → Test people →
Look: Woman / Man / Mixed). They are for previs only — never a tracked person's look, never inferred from a camera.

- **Licence: CC0 1.0** — every file is made only from the MakeHuman system assets (base mesh, targets, proxies, the
  `game_engine` rig, skins, eyes, eyebrows, eyelashes, hair, clothes), which MakeHuman released as CC0 in 2020:
  "All core assets are shared under Creative Commons, CC0. […] You do not need to pay anything, include any copyright
  notices nor give attribution." (https://static.makehumancommunity.org/about/license.html). Per-file sources, URLs and
  quotes: `LICENSES.json`; summary in the repo-root `THIRD_PARTY_NOTICES`.
- **Made by** `tools/people/` (Blender 4.5.9 LTS + the MPFB 2.0.18 extension, both build tools only; recipe in
  `tools/people/README.md`).
- **What is inside:** one skinned mesh on MPFB's 53-bone `game_engine` skeleton (metres, feet at y 0, facing +Z, the
  person's left +X), two levels of detail (`lod0_*` ≈ 21–24k triangles, `lod1_*` ≈ 6k), one material per part (skin,
  clothes, shoes, eyes, hair, eyebrows, eyelashes) and no images; the parts' textures are the `<body>_<part>.webp` files
  (skin in three tones: light, mid, dark).
- The client reads them at run time (`human_body.gd`: GLTFDocument + Image), not through the editor import; each file
  has a `"keep"` `.import` so an export packs it as it is.
