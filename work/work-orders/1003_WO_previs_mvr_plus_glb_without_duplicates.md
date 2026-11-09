# WO-1003 — Previs: MVR for patch and lights + a Capture .glb for everything else, without duplicates
**Area:** godot-client, tracking-vr
**Status: DONE (09.11 — venue model built and run in the owner's GUI on Narvil: 3302 MVR objects drawn from the .glb, 853 .glb-only objects added, fixtures and patch from the MVR, one copy in the MVR place; Godot suite 26581/0, smokes green)**

Owner, 08.11: "So we need a way to be able to combine MVR for patch and lights and glb for all other models in a way
it doesnt duplicate etc."
Owner, 09.11: "ive added the glb for the project in the project folder. (it shows in the browser as "3") test how glb
import works and how can we keep mvr patch, fixtures and use glb models for the rest. you can drive the client
directly if needed." Then: "you were meant to add it to the project like user would", and "i hope you see it that the
glb is rendering in a different place then the mvr models. also they shouldnt be displayed simultainusly, only best
parts from both."

## Investigation

### 08.11 (design only, no sample)

- **Why both files:**
  - Capture's MVR export carries 3DS geometry only: one flat colour per material, no textures.
  - A `.glb` keeps the textures and PBR materials.
  - Patching, fixture heads and DMX need the MVR (GDTF links, fixture ids, addresses).
- **Two separate loaders that both draw everything:**
  - `previs_stage.gd` `load_glb_bytes` (the WO-607 Models list) puts a model at the stage origin and ignores the MVR
    place.
  - `mvr_scene.gd` `show_scene` draws the MVR at `project.previs.mvr.place` (Narvil: X −13.16, Y −30.9, Z 0.88).

### 09.11, with the owner's sample: `media/projects/narvil/narvil ide Marcin.glb` (61.2 MB) + `Narvil IDE 11.2026.mvr`

- **What the "3" was.** In Sources ▸ Media (project only), the GLB row's info column read "3". That is
  "3D model · 61.2 MB" clipped.
  - `media_panel.gd` sizes the column from media rows only. Document rows (`media_docs.gd` `decorate`) `continue`d
    before `_info_w` counted them.
  - So in a folder holding only documents, the column stayed 12 px wide. The MVR row's "MVR scene · 9.7 MB" showed
    nothing at all.
- **The file is a Capture export (generator "Capture 2025.1.16") with exact uuids:**
  - 5614 nodes, 4245 meshes, 86 materials, 26 embedded images. Node names are all empty; there are no extras.
  - Every node carries `extensions.CAPTURE_model.identifier`, and layers come by `layer_identifier`.
  - **All 5614 identifiers are MVR uuids:** 4104 SceneObjects + 1369 GroupObjects + 90 Fixtures + 51 Trusses.
  - The 4245 mesh nodes are exactly the 4104 scene objects + 90 fixtures + 51 trusses, one mesh each.
  - The 21 Capture layers share their uuids and names with the MVR's layers.
  - So no distance or name heuristics are needed (the old design's step 3). Matching is by uuid.
- **Same frame, to the millimetre.**
  - The GLB is the MVR's (x, z, −y) in metres. Fixture f54b08d7: MVR (10052, 59102, 5725) mm, GLB
    (10.052, 5.726, −59.102).
  - That is exactly the frame the server converts the MVR into (`GET /api/stage/mvr/<id>`: part xform origin
    10.052125, 5.725096, −59.101906).
  - So the GLB goes under the MVR scene node with an identity transform, and the MVR place moves both.
- **What the GLB adds:**
  - The server's scene has 3392 objects; the MVR has 4245.
  - The 853 missing are SceneObjects that Capture wrote with an empty `<Geometries/>`: 561 "Klimat ledowy",
    199 "Krata na dole", 90 without a layer, 3 others.
  - They exist only in the GLB.
  - The MVR's 5 GDTFs have no 3D model (report `gdtf_no_model`), so unpatched fixture bodies are 0.3 m boxes. Patched
    heads are drawn by the live rig (fixtures_3d.gd).
- **The old path, live in the owner's GUI.** Previs ▸ Models ▸ double-click "narvil ide Marcin.glb" gave
  "4245 meshes, 0 screens":
  - the whole venue at the stage origin, offset from the MVR by its place and drawn on top of it (every truss and deck
    twice);
  - the Screens list filled with 4245 tick boxes ("Mesh, Mesh2…");
  - nothing saved to the project.

  Three faults on the way:
  1. **The Models list did not show the file.** It refreshes in `_ready`, on a `projectFiles` WS event and on a
     project switch. A GLB uploaded through Sources (the media upload) sends no `projectFiles` event.
  2. **"download failed: server not reachable (restarting or offline)".**
     - Godot printed `ERROR: HTTP Chunk too big!! >16mb` (core/io/http_client_tcp.cpp:642 → RESULT_CONNECTION_ERROR).
     - `src/server/http-server.js` writes headers first and then `res.end(buffer)`, so Node framed the 61 MB body
       (`/api/project-files/<name>` = `fs.readFileSync`) as ONE chunk. Godot's HTTPClient refuses chunks over 16 MB.
     - curl does not care, so only the client failed. Any buffered API body over 16 MB was affected.
     - (A side note from the repro: Godot decodes `%20` in **command-line** args, which made a first probe look like an
       HTTPRequest URL bug. It is not one; HTTPRequest sends `%20` intact.)
  3. **`generate_scene()` + `GLTFState.get_scene_node(i)` hand back freed objects.** Godot swaps the nodes it first
     builds: "Trying to cast a freed object" in the first live run.
- **Parse cost:** `GLTFDocument.append_from_buffer` takes 1.8 s on this file (headless).

## What was done

- **`godot/client/features/previs/mvr_venue.gd` (new): the venue model.**
  - `fetch(host, name)` downloads the project .glb. The bytes are cached, so the Previs page and the Live 3D view share
    one download.
  - It parses on a WorkerThreadPool task, and the frames keep running.
  - Each mesh is taken from the parsed state (`GLTFMesh.mesh.get_mesh()`, `GLTFNode.xform` up the `parent` chain),
    not from `generate_scene` (fault 3).
  - `meshes_by_uuid` gives `uuid → [{mesh, xf, layer}]`. A node without a uuid is keyed `glb:<index>`.
  - `apply(scene, v)`, per MVR object node:
    - a plain object (not a Fixture, not a bound video screen) drops its MVR parts and draws the GLB meshes of its
      uuid;
    - a fixture keeps the MVR's own, and its GLB model is dropped;
    - GLB meshes that no MVR object owns become new object nodes on their Capture layer, with uuid, kind and model
      metadata.
  - Every per-object feature therefore keeps working on the same nodes: layer eyes and colours, LED-wall hides
    (`hidden_objects`), moves (`moved`), the WO-1002 triangle pick, wall clustering (`model` = the GLB mesh ids).
  - `is_capture(bytes)` checks the first glTF chunk for `"CAPTURE_model"`.
  - `save_venue(name)` writes `project.previs.mvr.venue_glb`. `previs` is in CLIENT_OWNED_SLICES, so web autosaves
    keep it.
- **`mvr_scene.gd`:**
  - `configure()` reads `venue_glb`, and a change rebuilds the scene.
  - `show_scene()` awaits the venue after the MVR objects are built (with the `_gen` guard).
  - `_with_venue()` applies it, adds GLB-only layers and their counts, and re-applies moves, tints and visibility.
  - A bound VideoScreen is tagged `screen`, so it keeps its LED-shader parts.
- **`mvr_model.gd` `summary()`:** adds the line "Venue model X: N objects drawn from it, M more only in it (fixtures
  and the patch stay the MVR's)", or the error.
- **`mvr_venue_row.gd` (new) + one line in `mvr_section.gd`:** the "Venue model" pick under Scene position, with
  None or a project .glb. It is shown only while an MVR scene is picked, and refreshes on project change, on
  `projectFiles` and when shown. `mvr_section.gd` stays at 500 lines (its header comment is one line shorter).
- **The user path:**
  - **`previs_models.gd`:** a project .glb clicked in Models is checked with `is_capture`. While an MVR scene is
    shown, it becomes the venue model (status line says so), and `previs_stage.clear_model()` (new) drops any
    stage-root copy. The owner's "they shouldnt be displayed simultainusly" holds whichever way the file is opened.
    Other .glb files load at the stage root as before.
  - **Fault 1:** the list also refreshes whenever it becomes visible.
- **`src/server/http-server.js` (fault 2):** a buffered (non-stream) API or static body now gets `Content-Length`, so
  there is no chunked framing. 204 and 304 are left alone, and gzip already set its own length. Streams stay chunked,
  with small chunks. This fixes every large buffered download, not just this one.
- **`media_panel.gd` ("3"):** document rows count toward the info column width and use the info font size.

## What was verified

- **Godot suite:** 26581 passed, 0 failed (`run-client.sh --test`). It includes the new `tests/test_wo1003_venue.gd`:
  - uuid keys and lower-casing, `glb:<i>` fallback, Capture layer inherited from the group, parent transforms;
  - swap only plain objects; fixtures, bound screens and objects missing from the GLB keep their parts; extras are
    added; selection marks are left alone;
  - the summary line.

  Boot check `--check` OK.
- **New smoke `tools/smoke/smoke-wo1003-buffered-body-content-length.test.js`:** the real `startHttpServer` on an
  ephemeral port serves a 20 MB Buffer with `Content-Length` and no `Transfer-Encoding`, a UTF-8 string's byte
  length, and a bodiless 204. The WO-497/498 HTTP smokes still pass (16/16).
- **Live on the box after the node restart:**
  - `curl -D -` shows `Content-Length: 64201908` on the GLB.
  - A headless Godot HTTPRequest gets 200 and 64201908 bytes in 138 ms (threaded).
- **Live in the owner's GUI (driven with xdotool, owner's permission 09.11):**
  1. The Models list shows the GLB after the relaunch.
  2. A double-click on the old path gives the doubled, offset picture described above (screenshot glb6).
  3. MVR scene ▸ Venue model ▸ "narvil ide Marcin.glb" saves `previs.mvr.venue_glb` (read back from `GET /api/project`).
  4. After the relaunch (and after the freed-object fix), the summary reads "Venue model narvil ide Marcin.glb: 3302
     objects drawn from it, 853 more only in it". 3302 = 3392 − 90 fixtures.
  5. Fit shows one room in the MVR place, with no second copy.
  6. A close view shows tables and chairs (layer "Fotele", no colour set) with Capture's materials.
  7. The magenta strip along the front edge is Capture's own material `0127_Magenta` in the file, not a load error.
  8. "90 of 90 fixtures patched": the heads stay the MVR rig's.
- **Not verified:**
  - The Live tab's 3D view. It shares `configure()`, so it should load the venue too, but it was not looked at.
  - A Models click with no MVR scene (it falls back to the stage-root load, unchanged code).

## Open (owner's call)

- **Layer colours still repaint the GLB's materials.** `model_tint.gd` overrides per layer, as before. Narvil's
  project sets several layers to black and "Parkiet" to orange; those were picked to make the flat MVR readable.
  Clearing a layer's colour (Layers ▸ colour reset) shows Capture's own look for that layer.

### Follow-up 09.11 ~15:15 — the owner still saw the .glb in another place

Owner: "glb still loads in a different place then the mvr already is. also loading the glb should merge with the mvr so
from mvr stays fixtures and patch and ability to move them etc, also models from gdtf. and the rest should be matched and
merged from the glb."

- **What the owner's GUI showed:** the Models line read "4245 meshes, 0 screens". The Models click had taken the old
  stage-root load, so a second copy sat at the stage origin, on top of the merged venue.
- **Why:**
  - `is_capture()` looked only at the first 64 KB of the glTF JSON.
  - Capture writes `extensionsUsed` at the end. Narvil's JSON chunk is 3,199,756 bytes, and the first
    `"CAPTURE_model"` is past 64 KB. So the check said "not Capture".
- **Fix:** `is_capture()` reads the whole JSON chunk.
- **Test:** `test_is_capture_reads_the_whole_json_chunk` puts the marker after 80 KB of padding.
- **Verified:**
  - Godot suite 26584/0.
  - After relaunching the owner's GUI, the venue loads alone: one room, MVR fixtures on the GLB truss.
  - An xdotool click on Models ▸ "narvil ide Marcin.glb" now shows "…is a Capture export of the scene: it is now the
    MVR scene's venue model", and the 3D view is unchanged, with no second copy.
- **The owner's merge rules (already how the venue works):**
  - From the MVR: fixture nodes (patch, moves, GDTF models). Narvil's 5 GDTFs carry no model, so unpatched fixtures stay
    boxes, and patched heads come from the live rig.
  - From the .glb: every other object, matched by uuid, plus the .glb-only ones.

### Follow-up 09.11 ~15:30 — "when loading glb i still have mostly mvr models"

- **What was wrong:** Capture's textured materials (22 of 86) sit on exactly the layers the project colours:
  - wood floor `Drewno_Podloga` on Parkiet (orange);
  - carpet `Dywan` on Podłoga hotelowa;
  - `Truss` on Krata na górze (46/46 meshes);
  - Default Layer.
  `model_tint.gd` replaced them with the flat colour, so the room still looked like the MVR.
- **Fix:** `mvr_venue.gd` `_fill` tags every .glb mesh `no_tint`. A layer colour now paints only what the MVR still
  draws (the fixture boxes). Test: `test_apply_swaps_objects_keeps_fixtures_and_screens`, suite 26585/0.
- **Verified in the owner's GUI after relaunch:** top and front views show Capture's carpet texture, the wood dance floor,
  the table-and-chair sets and the truss, with fixtures hanging on the .glb trusses and one copy of everything.
- **The owner's hidden layers:** the owner had hidden 14 of 21 layers while checking. On "make sure my gui ends up with
  the mvr and glb loaded and everything matched", `hidden_layers` was set back to the earlier `["Sufit"]` (ceiling only)
  via autosave. The GUI was left on the Front view.

### Follow-up 09.11 ~16:30 — "positions only from the glb file … match positions of the objects from glb to mvr"

- **Investigation (every MVR object vs its .glb node by uuid, in the MVR frame `(x, −z, y)`):**
  - 5582 of 5614 objects agree within 2 cm.
  - The rest is one group that was moved in Capture after the MVR export. It sits on Default Layer: 5 Truss (the stage
    towers), 5 SceneObjects, and the 15 fixtures on them. That is MAC Quantum Profile 6–10, Pixel Line IP 1041–1045 and
    Pixel Strobe 708–712.
  - All of it is shifted by exactly **(0, −0.151, +0.61) m** in the .glb. The venue already drew the towers from the
    .glb, but the fixtures came from the patch (MVR), so they hung 0.61 m low, beside their towers.
- **The fixture node vs the GDTF origin differs by a constant per type** (Capture's model pivot, in fixture-local
  metres). This is not a position difference:
  - Pixel Strobe (0, 0, −0.098);
  - Robin 600 (0, 0, −0.01), and Capture's node is also yawed 180°;
  - MAC Quantum, Pixel Line, X-Dot ≈ 0.
  - The .glb also flips Pixel Line roll ±90 and hang truss↔floor. That is a Capture model convention, so the
    **orientation stays from the MVR**.
- **What was done (data, Narvil only):**
  - The 15 patch poses got +(0, −0.151, +0.61) on x/y/z via `POST /api/project/autosave` (rev 65).
  - Yaw/pitch/roll/hang are unchanged.
  - Backup: scratchpad `narvil.before-glb-positions.json`.
- **Verified:**
  - 90 of 90 patched fixtures match their .glb node after the per-type pivot, with 0 off by more than 1 cm.
  - The owner's GUI (Front view) shows the MAC Quantums on top of the .glb towers, with the Pixel Lines on the tower legs.
- **Not done:** an automatic "take positions from the venue .glb" action. Narvil was corrected as data. A tool would
  have to tell a moved group from the per-type pivots, which is what the per-type median does here.
