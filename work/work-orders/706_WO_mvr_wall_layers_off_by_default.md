# WO-706 — MVR wall layers: empty ones say so, wall layers start hidden on import

**Area:** godot-client, lighting
**Status: DONE (23.10.26: Godot 21223/0, smoke-wo706 3/3, boot check OK; owner QA in the Layers fold of the
Pabianice scene + any MVR that carries its walls)**

Owner, `next.md` 23.10: *"you did something that walls in the imported mvr are listed as layers but they ccant be
turned on. id like them to be turned off by default on import but with the ability to turn them on."*

## Investigation

- The scene with wall layers is **Pabianice Final Patch** (`projects/_mvr/d74a223cd12a`, imported 21.10). Its layer
  list has 34 layers, including **Ściana frontowa, Ściany boczne, Ściana z głownym ekranem, Ściana UB1+UB2, …**
  ("ściana" means wall in Polish), plus floors (Podłoga …), screens (Ekran …) and chandeliers (Żyrandole).
- **In the file, every one of those layers is empty.** I checked `GeneralSceneDescription.xml` (header: *Created by
  Capture 2025.1.15*): each Ściana / Podłoga / Ekran layer has 0 children in its `<ChildList>`. There are no
  classes (`<Class>`) either.
  - All geometry sits in **Default Layer**: 238 objects, the stage deck, trusses and fixtures.
  - The unnamed layer that the importer calls **Layer 34** holds 136 small objects, all under 3 m.
  - The four fixture layers hold the remaining objects.
- **No wall geometry anywhere.** All 57 meshes in the zip are referenced, and the largest object in the scene is the
  10 × 5 m stage deck (bounding boxes measured from the 3DS meshes; scratch script `an/big-objs.js`).
- **Why the eyes did nothing.** The importer (`src/stage/mvr-scene.js`) is faithful: it lists the file's layers and
  puts each object on its own layer. The Layers fold (WO-647, `color_rows.gd`) gave every layer an eye. On an empty
  layer that eye can never show anything. The owner read that as "can't be turned on".
  - The walls were never exported by Capture: the layer names came out, their contents did not.
- **Nothing hid wall layers by default.** A new scene started with `hidden_layers: []`
  (`mvr_model.gd import_cfg`, `mvr_section.gd _on_pick`).

## What was done

- **`mvr_scene.gd`:** `layer_sizes`, the number of objects per layer, counted while the scene is built.
- **`mvr_model.gd`:**
  - `is_wall_layer(name)` matches word starts in en / pl / de / fr / es / it: wall, ścian / scian, wand / wänd, mur,
    paroi, pared, parete.
  - `wall_layers(layers, sizes)` returns only the wall layers that hold something.
  - `empty_layers` and `layer_labels` produce "‹name› · empty in the file".
- **`color_rows.gd`:**
  - `fill(…, off)`: rows listed in `off` get a disabled eye, colour picker and reset.
  - Rows are rebuilt when the labels change.
- **`mvr_section.gd`:**
  - `_fill_layers()` labels the empty layers.
  - A scene new to the project starts with its wall layers hidden (`_walls_for`), and their eye still turns them on.
    "New to the project" means Import of another scene or picking a scene; picking the shown scene again applies it
    at once.
  - A new version of the shown scene (WO-643) keeps the hidden layers it had.
- **`mvr_import.gd` (new):** Import… / upload moved out of `mvr_section.gd`, the same way `mvr_export.gd` was
  (WO-681), because the section was at 499 lines. It reports `fresh` to the section. The section is now 494 lines.

For the Pabianice file, this means the Ściana rows read "· empty in the file" with no eye. Nothing is hidden, because
the file carries no walls. To have walls in the previs, re-export from Capture with the venue geometry included.
Those layers then fill, start hidden, and turn on with their eye.

## Verified

- Godot `run_tests.gd` **21223 passed, 0 failed**.
  - New `test_mvr_wall_layers.gd`: the owner's Polish names and other languages, non-walls (Ekran, Podłoga,
    Żyrandole, fixture layers), and the Pabianice layer counts. With those counts nothing is hidden and three rows
    are labelled; a filled wall layer is hidden.
- `smoke-wo706` **3/3** (wiring pins; added to the CI list). `run-client.sh --check` boot OK.
- Owner QA:
  - Previs → MVR → Layers on Pabianice: the Ściana rows say "empty in the file".
  - Import an MVR whose wall layers hold geometry: they start with a closed eye and open on click.
