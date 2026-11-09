# WO-1024 — GDTF fixture models missing in the previs (built-in primitives drawn as boxes; Pixel Strobe head file missing)
**Area:** lighting, godot-client
**Status: IN PROGRESS (09.11 — primitive shapes + Narvil Pixel Strobe swap done and live; a "get better models from GDTF Share" action in the UI is OPEN)**

Owner, 09.11: "i also noticed there are some gdtf models missing, there should be a get them now by official highascg
account from gdtf share and replace."

## Investigation

- **The MVR scene vs the live rig:**
  - The MVR scene (`src/stage/mvr-scene.js`) draws fixtures from the stub GDTFs Capture embeds. They have no model, so
    every fixture is a 0.3 m box (`report.gdtf_no_model`, all 5 Narvil types).
  - Patched fixtures are drawn by the live rig (`fixtures_3d.gd` from `GET /api/fixtures/types/<id>/rig`), using the
    real GDTFs the WO-637 aliases point at. Narvil is 90/90 patched, so what the owner sees is the rig.
- **The rig per Narvil type (patched mode), 09.11:**

  | Type (alias target) | Body |
  |---|---|
  | MAC Quantum Profile (c24ac67a2350) | 3 meshes (3ds) |
  | Robin 600 LEDWash+ (289fa8cde237) | meshes |
  | Pixel Line IP (6ad826d14d1b) | 2 meshes + a box body (a bar: correct) |
  | **Brighter Pixel Strobe** (0db39dd819da, mfr rid 110457) | yoke mesh; the Head model references `head`, which **is not in the archive** → box |
  | **Brighter X-DOT Max** (d3963b9eeb1e, mfr rid 147669) | Base / Yoke / Head use GDTF **built-in primitives** (`Base1_1`, `Yoke`, `Head`, no File) → 3 boxes; only the 19 LED lenses have a mesh |

- **Why the boxes:** `src/fixtures/gdtf-rig.js` `meshOf` drew every model without a file as `prim:box`, whatever its
  `PrimitiveType`.
- **GDTF Share, with the box account (`highascg`), list refreshed 09.11 (13577 revisions):**
  - X-DOT Max: rid 147669 (manufacturer) and 155674 (OGSON, user). X-DOT: 82333 and 147670.
    **None has body meshes.** All use the built-in primitives, so Share cannot fix this type.
  - Pixel Strobe: rid 110457 (manufacturer, head file missing) and 143982 "OGSON fixtures | Brighter Pixel Strobe ogi_v3"
    (user upload, `models/3ds/Body.3ds` + `Yoke.3ds`, complete).
  - **OGSON vs manufacturer, channel by channel:**
    - "Advanced 1 (15ch)" = "15 Ch" on channels 1–12: Dimmer, Shutter1 and ColorAdd R/G/B/W for the foreground and
      background sections.
    - Channels 13–15 differ: Macro, Macro Speed, DimmerMode vs Gobo1, Gobo1Pos, DimmerCurve.
    - "4ch RGBW" matches 4/4.
    - 12 Ch, 44Ch and 244Ch have no equal-footprint counterpart.

## What was done

- **`src/fixtures/gdtf-rig.js` `primOf`:** a file-less model is drawn as the shape of its built-in primitive:
  - Yoke → `prim:yoke`;
  - Head, Cylinder, Conventional, Conventional1_1 → `prim:cylinder`;
  - Sphere → `prim:sphere`;
  - everything else stays `prim:box`.
  It keeps the same size box (`mesh_xf`), and a mesh file still wins.
- **`godot/client/features/previs/fixtures/prim_shapes.gd` (new):** the unit shapes, cached and shared.
  - The yoke is a U with its bar at the top and its arms hanging down, because GDTF models fixtures hanging (X-DOT: yoke
    −0.21 m under the base, head −0.12 m under the yoke).
  - `fixtures_3d.gd` `_mesh` uses it for every `prim:` key. That file is now 489 lines; it gained one line.
- **Narvil's Pixel Strobe, as a data change (owner: "get them now … and replace"):**
  1. Imported rid 143982 via `POST /api/fixtures/types` → type `b6c4b750cbc7`.
  2. Aliased **Narvil's stub id only** (`POST /api/fixtures/types/23c7df8166f2/replace`
     `{"15 Channel": "Advanced 1 (15ch)", "4 Channel RGBW": "4ch RGBW"}`). The box-level by-name alias `525199c6088c`
     (Pabianice, manufacturer file, all 6 modes) is untouched, so other projects keep the manufacturer's DMX.
  3. Repointed the 12 patched Pixel Strobes in `projects/narvil.json` (`typeId 0db39dd819da / "15 Ch"` →
     `b6c4b750cbc7 / "Advanced 1 (15ch)"`) via `POST /api/project/autosave`.

  Backup: `/tmp/claude-1000/-home-casparcg/f090f1fe-27a9-499e-9de3-49634b7e60e6/scratchpad/narvil.before-pixelstrobe.json`
  (scratch only).

## What was verified

- **`tools/smoke/smoke-wo1024-gdtf-primitive-shapes.test.js` (new, curated):** Yoke / Head / Sphere / Base1_1 / Cube /
  file → their keys, and the size box is unchanged. With the WO-615 / 612 / 1006 rig smokes: 77/77.
- **Godot `tests/test_wo1024_prim_shapes.gd`:** each shape fills the unit box (the sphere within its facets), unknown →
  box, shared mesh, yoke open below. Suite 26593 / 0.
- **Live:**
  - The OGSON rig ("Advanced 1 (15ch)") has `models/3ds/Yoke.3ds` + `Body.3ds` and 3 beams.
  - `/api/fixtures/dmx` shows all 12 Pixel Strobes at 15 channels with no problem.
  - Node was restarted for the rig change and the owner's GUI relaunched; there are no errors in the client log.
- **Not verified:** a close-up screenshot of an X-DOT Max yoke and head. They are small from the audience view.

## Open

- **The owner's "get them now" as a UI action.** A server pass over the alias targets whose rig still has file-less
  bodies or missing files, which looks for another Share revision with meshes and equal modes (same footprint, matching
  attributes) and offers it per type. It must offer a swap, not apply it: the only candidate here was a user upload
  with different macro channels.
- **The unpatched MVR fixture boxes** (`mvr-scene.js`) still use the Capture stubs, not the alias targets.
