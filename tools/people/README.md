# Building the human puppet bodies (WO-1103)

Output: `godot/client/assets/people/{woman,man}.glb` + `<body>_<part>.webp` (licences: that folder's `LICENSES.json`).
Everything here runs on the box without root; the tools are build-time only and nothing of them is shipped.

1. **Blender 4.5.9 LTS**, portable: `https://download.blender.org/release/Blender4.5/blender-4.5.9-linux-x64.tar.xz`
   (unpack anywhere).
2. **MPFB 2.0.18** (GPL-3.0 code, CC0 data):
   `https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip`
   — install into an isolated user dir so the box's own Blender settings are untouched:
   `export BLENDER_USER_RESOURCES=$PWD/bl_user` then
   `blender -b --command extension install-file -r user_default mpfb.zip` (or unzip it into
   `$BLENDER_USER_RESOURCES/extensions/user_default/mpfb`).
3. **MakeHuman system assets (CC0)**:
   `https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip`
   (≈ 280 MB) — unzip and copy its folders (`skins`, `clothes`, `hair`, `eyes`, `eyebrows`, `eyelashes`,
   `proxymeshes`, …) into MPFB's user data dir, `$BLENDER_USER_RESOURCES/extensions/.user/user_default/mpfb/data/`.
4. Bodies (one Blender run each; `woman.json` / `man.json` hold the macros — gender, age, muscle, weight, proportions,
   height, race mix —, the proxy, the parts, the clothes and the decimation per part and level of detail):

       blender -b --python tools/people/build_human.py -- tools/people/woman.json woman.glb
       blender -b --python tools/people/build_human.py -- tools/people/man.json man.glb

   It builds LOD0 (the full base mesh, the clothes' hidden-skin groups deleted, decimated) and LOD1 (the CC0 proxy
   mesh + lighter parts, low-poly eyes) on one `game_engine` skeleton, applies the shape keys, names the meshes
   `lod<n>_<part>` with one material per part, and exports a GLB without images (+ `<out>.stats.json`: triangles,
   height, bones, the texture files it used).
5. Textures: `python3 -I tools/people/pack_tex.py <unzipped system assets dir> <out dir>` — resized WebP per part; the
   "mid" skin is a 50/50 blend of the light and dark skins (same base-mesh UVs), the woman's suit has 70 % of its
   baked occlusion multiplied in.
6. Copy the `.glb` and `.webp` files into `godot/client/assets/people/` (each keeps its `importer="keep"` `.import`) and
   update `LICENSES.json` if a part changed; `tools/smoke/smoke-wo1103-puppet-humans.test.js` checks the two agree.
