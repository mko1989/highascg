# WO-1003 — Previs: MVR for patch and lights + a Capture .glb for everything else, without duplicates
**Area:** godot-client
**Status: OPEN (08.11 — investigation and design only; blocked on a Capture .glb export of the same Narvil scene)**

Owner, 08.11: "So we need a way to be able to combine MVR for patch and lights and glb for all other models in a way
it doesnt duplicate etc."

## Investigation

- **Why the owner wants both:**
  - Capture's MVR export carries 3DS geometry only. That is one flat diffuse colour per material and no textures,
    so the venue looks grey and flat.
  - A `.glb` (glTF Binary) export keeps the textures and PBR materials.
  - Patching, fixture heads and DMX need the MVR: GDTF links, fixture ids and addresses (`mvr_scene.gd`
    `fixture_uuids`, the Fixtures slice patch).
- **Today the two loaders are separate and both draw everything:**
  - `previs_stage.gd` `load_glb_bytes` is the WO-607 model library (`/api/previs/models/:id`). It sits at the stage
    origin and is framed on its own (`_frame_model`). Its screen meshes are tagged by name (`*screen*` / `*led*`).
  - `mvr_scene.gd` `show_scene` places the MVR with its own transform (`project.previs.mvr` place: Narvil X -13.16,
    Y -30.9, Z 0.88). It hides patched fixtures, because the rig draws their heads, and hides mapped LED walls
    (`previs.mvr.hidden_objects`, WO-1001 Map).
  - Load both and every truss, deck, wall and un-patched fixture body would appear twice. They would also be offset
    from each other, because the glb ignores the MVR place.
  - A `.glb` embedded inside an MVR is already used as-is (`mvr_scene.gd:70` `_from_glb`). That covers a per-object
    glb, but Capture does not write one.
- **No sample to build against.** `~/Downloads` holds only `.mvr` files, and the model library on the box is empty.
  Capture's glTF export naming (one node per object? the MVR uuid in the node name or extras? layer names?)
  decides which matching works, and it has to be seen, not guessed.

## Design (not built)

1. **One "venue model" per MVR scene.** `project.previs.mvr.venue_glb = <model id>` is drawn as a child of the MVR
   scene root, so the MVR place moves both together.
   - Capture writes both exports in its own world frame. The glb's metres and Y-up map straight onto the MVR's
     mm and Z-up (the same conversion `_from_glb` uses).
2. **When a venue model is set, the MVR draws only what the glb cannot do:** the patched fixtures' heads (the rig),
   and any un-patched fixture objects the owner wants patchable later. Every other MVR object (truss, decks, venue,
   LED panels) is hidden. It still exists for picking, Layers, Map and Tracking-stage Fit, which use the MVR's
   boxes and uuids.
3. **The glb hides its own duplicates:**
   - *Fixtures:* a glb mesh whose centre lies within ~0.15 m of a patched fixture's position, and that is smaller
     than ~1 m, is hidden. The rig draws the head instead. Better, if Capture writes them: match node names or extras
     on the MVR object name or uuid.
   - *Mapped LED walls:* glb meshes inside a WO-614 LED wall's box are hidden (the wall shows the live picture).
4. **Picking stays on the MVR.** Clicks ray-test the (hidden) MVR objects (WO-1002 triangle pick), so selection,
   Layers and Map keep working on uuids. The glb is drawing only.

## To do

- The owner exports Narvil from Capture as glTF Binary (`.glb`), the same scene as the MVR, and drops it in the web
  UI's Previs model dropzone (`client/components/previs-pgm-3d-dropzone.js`).
- Then: read its node tree (names, extras, per-object or merged), pick the matching rule, build 1–4, and test with
  the mouse on Narvil.
