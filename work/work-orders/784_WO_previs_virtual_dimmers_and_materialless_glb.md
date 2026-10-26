# WO-784 — Previs: MAC Aura PXL never lights (virtual dimmers read as 0) and its body draws white (glb without materials)

**Status: DONE (26.10 — smoke 2/2 (fails without the fix), offline suite, decode sweep of every stored GDTF, off-screen render of an Aura with the owner's programmer values; owner QA = the Auras in their running client after a relaunch)**

Owner, 26.10:
> mac aura pxl doesnt luminate, also they stay white. ive even tried importing a gdtf myself.
> the base color stays white

Parents: [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) T5 (DMX → previs decode, `gdtf-visual.js`), [WO-767](./767_WO_gdtf_glb_mm_units_heads_huge.md)
(the same Aura GDTF: glb in mm). Follow-up for the GDTF Share matching ("auto recognition"): WO-785; matching itself: [WO-637](./637_WO_gdtf_share_auto_resolve.md).

## Investigation

- **The type is right.** The MVR's Capture placeholder `19cfcd71f9f2` is aliased (WO-633/637) to the real GDTF Share file
  `87d69e37fbe1` (Martin Professional MAC Aura PXL, DataVersion 1.2); all 14 heads are patched with it, mode Basic.
  An import by hand gives the same file, and so the same id. That is why re-importing changed nothing.
- **The wire is right.** Outgoing frame of "MAC Aura PXL 601" (universe 5 @ 163), with the owner's programmer values
  (Dimmer full, Tokyo Blue):
  - shutter 30 (Open);
  - Beams dimmer 65535;
  - Beams RGB full;
  - colour wheel 25;
  - Auras dimmer and RGB full.
- **Not lighting.** The GDTF has three *virtual* dimmers (`Offset=""`, `Default="0/4"`): `Head_Dimmer` on the head and
  `BeamPixel_Dimmer` / `AuraPixel_Dimmer` on every pixel (`description.xml:1213`). `gdtf-visual.js` put them in each
  beam's scope and read a virtual channel at its default (`raw()`, "virtual = its default"). So intensity was
  `… × 0` for all 160 beams: decoding that frame gave **0/160 lit**.
  - A virtual channel is the console's own value. It is folded into the real channels before they are sent and never
    appears in DMX, so a decode from DMX must not read it.
- **Sweep of every stored type × mode** (all slots full, shutters on an Open set):
  - Virtual dimmers at default 0 also kept Brighter Pixel Strobe (61/71 and 11/71 lit) and X-DOT (28/35, 7/35, 0/35)
    partly or wholly dark.
  - ACME Pixel Line's virtual `ColorAdd_W` (default 255) adds white to every pixel.
  - Robin LEDWash virtual zone dimmers default to 255, so they had no effect.
- **"Base colour stays white".** The Aura's `base.glb`, `head.glb` and `yoke.glb` have **no materials at all** (no
  `materials` array, primitives without `material`); the server's WO-767 rescaled copy is the same. Godot's GLTF
  importer gives such surfaces its default white `StandardMaterial3D`, checked headless:
  `surface_get_material(0)` is a StandardMaterial3D, not null.
  - It is the only stored GDTF with a material-less glb (sweep of all 63 archives).
  - No type or layer body colour is set in the project (WO-641 / WO-678), so nothing else tints it.

## What was done

- **`src/fixtures/gdtf-visual.js`** `compileVisual`: a channel without offsets (virtual) is left out of every beam's
  scope. That fixes both directions (a virtual 0 dimmer blacks out, a virtual 255 colour whitens).
  - A beam reached only by virtual channels stays dark (the existing "no channel in scope" rule).
  - Rejected alternative: read virtual dimmers as full and keep the others. Every virtual channel has the same
    problem (it is not on the wire), so special-casing dimmers would leave ACME's white.
- **`godot/client/features/previs/fixtures/fixtures_3d.gd`** `_from_glb`: when the glTF state has no materials, every
  surface gets the body grey that the placeholder box already uses (0.22, 0.22, 0.24, double-sided like
  `model_tint.gd`).
  - It is a surface override, so a type or layer body colour (`material_override`) still wins.
  - It survives the `duplicate()` each head gets.
- **`godot/client/app/fixture_shot_probe.gd`** (dev, new): `--probe-fixture=<type id>:<png prefix>` with `--tab=1`.
  - It puts the Previs orbit camera close on the first head of that type, from the front and from below, saves two
    screenshots, and prints what the client received for "Beam Pixel 1" / "Aura Pixel 1" plus the lens emission.
  - Registered in `main.gd`'s probe table.
- Smoke `tools/smoke/smoke-wo784-virtual-channels-not-on-wire.test.js` (curated list `offline-test-files-2.js`): an
  Aura-shaped mode (a virtual head dimmer at 0, a real Beams dimmer + RGB, a virtual pixel W at 255).
  - Full red decodes as `{i: 1, c: [1, 0, 0]}`, and the real dimmer still dims.
  - Scopes hold no virtual channel; a beam reached only by virtual channels is dark.

Not changed: the Aura is a "cell rig" (more than 4 beams, `fixtures_3d_model.gd` CELL_BEAMS), so its 160 pixels draw
as glowing cells with no cones or spot lights. A real Aura also throws a beam; drawing one cone for the centre pixels
would be a separate change.

## Verified

- Smoke 2/2. With the `gdtf-visual.js` line removed it fails 0/2, so it guards the fix.
- WO-615 visual / programmer and WO-700 smokes still pass: 27/27 together with the new one.
- Offline suite 3382 tests: 3380 pass, 0 fail, 2 skipped. Lint 215 warnings (budget 216), prettier OK, no file over
  500 lines, no new unwired exports.
- Godot: tests 21884 passed / 0 failed; `run-client.sh --check` boot OK.
- Decode sweep, before → after:
  - Aura Basic / Extended / Ludicrous: 0/160 → 160/160 lit.
  - X-DOT 51 / 107 / 128 ch (both variants): → 35/35.
  - Pixel Strobe 44 / 244 ch: → 71/71.
  - Every other type × mode unchanged.
- Live frame of Aura 601 through the new decode: Beam pixels `i 1, c [0.265, 0, 1]` (Tokyo Blue), Aura pixels
  `i 1, c [1, 1, 1]` (their RGB is at full).
- Headless Godot on the Aura `base.glb` as served: 0 glTF materials; after `_from_glb` the duplicate's active material
  is albedo (0.22, 0.22, 0.24).
- **Off-screen client** (server restarted, `--probe-fixture=87d69e37fbe1:…`, 20:52):
  - The client received Beam Pixel 1 `{i 1, c [0.265, 0, 1]}` and set it as the lens emission.
  - The screenshot from below shows the Aura heads with 19 blue beam cells inside the white aura dots, a violet
    glow, and a dark grey body. The body was white before.
- **Side effect of the server restart:** the programmer is in memory only, so the restart released every head's
  programmed values. DMX output was off (no universe live), so nothing on the wire changed.
  - The 14 Auras were put back to the owner's values recorded just before: Dimmer full, Pan 180.43, Tilt 48.9,
    Tokyo Blue.
  - The other heads are at defaults.
- Owner QA: relaunch the Godot client (the glb fix is client side); the Auras light with the programmer's colour and
  the bodies are dark.
