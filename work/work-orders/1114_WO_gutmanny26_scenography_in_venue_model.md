# WO-1114 — gutmanny 26: scenography from the renders in the venue model

**Area:** godot-client, tracking-vr
**Status: IN PROGRESS (17.11.26 — statue, light bars, step / catwalk light strips, 48 guest tables in the previs; LED content in; footlights, band not made)**

Owner 17.11, with four scenography renders: "this is how the stage should look. try adding the elements from it to the previs".

## Investigation

- The project's venue model is `media/projects/gutmanny_26/Guttmanny 2026 venue.glb` (`previs.mvr.venue_glb`), layers
  are glTF nodes with a layer name; the client loads it by file name.
- The Capture model already has the stage steps (nodes 2, 3) — a first build added a second set on top; rebuilt.

## What was done

- New glTF nodes appended to the venue model (nothing existing changed; 2113 → 2120 nodes): layer **Statue** (gold
  figure, 3 m, audience left of centre), **Light bars** (vertical gold bars between the LED stripes), **Step and
  catwalk lights** (strips under the existing treads, stage front edge, catwalk sides and tip), **Guest tables**
  (48 round tables: cloths, chairs, candles, flowers). Build + validator scripts are in the session scratchpad
  (`tools/build_scenography.py --capture-steps`, `tools/validate_scenography.py`); not in the repo.
- Installed over the project file (old file kept in the scratchpad `snap/venue_before_scenography.glb`), client
  relaunched.

- **LED content** (owner: "can you try recreating what was on the photos to display on the screen?"):
  `media/projects/gutmanny_26/Guttmanny gala 11520x1536.png` drawn by `work/notes/gutmanny26-build/led_content.py`
  on the wall layout (wings, three stripes each side, centre): navy ground, gold rays and dust, frames, "GUTTMANNY
  2026" as text (no logo artwork). Playing on PGM 2-10 (`PLAY … MIX 25`); a still, not an animation.

## What was verified

- Validator: structure, support (every part rests on something) and no intersection with the 2113 existing nodes.
- Previs on the box: tables with candles in the room, rig and LED walls unchanged (screenshots).

## Not done / not verified

- Statue, light bars and step lights were not looked at close up on the glass.
- Footlights, band backline; the LED content is a still.
- Seen in the previs window (second screen screenshot): content on all nine walls, statue in front of the centre wall.
