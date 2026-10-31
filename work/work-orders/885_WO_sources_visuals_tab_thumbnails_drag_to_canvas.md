# WO-885 — Sources ▸ Visuals: every visual with a thumbnail, in folders, dragged onto the Visuals canvas

**Area:** godot-client
**Status: DONE (31.10, Godot 24141/0; box: probe client on a private Xvfb rendered all 190 thumbnails in ~30 s, drags onto
the canvas set Scene and (Shift) Layer 2, double-click runs a row, the live rows highlight — screenshots)**

Owner, 31.10: *"id like to move the list of visuals to choose to a new tab in sources tab with the ability to drag and drop
them on the visuals canvas. they should also have thumbnails to know what im picking and folder style categories"* — and
*"change the title of the tab Templates in the sources browser to CGs"*.

## 1. Investigation

- The pickers were three dropdowns in the Inspector page (`features/visuals/visuals_page.gd`, before this WO lines 55–102):
  Scene / Layer 2 over `visuals_model.gd` SCENES, Shader over the 190 library rows (WO-874), Game over `game_launcher.gd`
  `games()` (WO-876). Names only — nothing to tell the 118 ShaderAmp entries apart.
- The library has no categories: `GET /api/shaders` rows are `{id, name, audio, alpha, casparPath, updatedAt}`; ids carry
  only their source (sh-sa 118, sh-bg 29, others 43) and the list has duplicate ids (sh-audio, sh-3d-meters twice).
- No thumbnails exist anywhere for shaders (the server's thumbnail routes cover media and live channels). They can be made
  on the client: `shadertoy_rd.gd` runs a library shader on the RenderingDevice into a Texture2DRD, and the Visuals stage
  (`visuals_stage.gd`) runs any scene in its own World3D inside a SubViewport (the mixer's decks, WO-877) — so one small
  private stage can render each visual. Godot does not import res:// PNGs when the client runs from source, so static
  thumbnails in the repo were not an option for the scenes either.
- The Sources sidebar's tabs (`features/live/media_panel.gd`): Media, Templates, Placeholders (hidden), Live, Timelines.

## 2. What was done

- `features/visuals/visuals_catalog.gd` (pure): rows `{name, folder, payload, thumb, tip}` —
  *Scenes* (Rings, Particles, Starfield, Tunnel, Spectrum), *Audio-reactive/<theme>* and *Backgrounds/<theme>* for shaders
  (`audio` flag), *Games/<system>* by ROM extension. Themes (Tunnels & flight, Space, Fractals & patterns, Retro & neon,
  Nature, Light & glow, Shapes, Spectrum, Abstract) come from keywords matched against the START of a word of the id or
  name (a substring match put "Revision Qualification" under Shapes via "…cat…"). Filter over name / folder / id; duplicate
  ids once. Payload `{type: "visual", label, scene, shader?, game?}`; `apply_drop(slice, payload, overlay)` (the slice keeps
  one shader and one game: a shader as layer 2 over a Shader main swaps that shader; the main scene never also sits on
  layer 2); `describe()` for the Inspector lines.
- `features/visuals/visuals_thumbs.gd`: a private 192×108 stage in its own World3D, stepped by hand 48 × 1/12 s through a
  fixed synthetic 120 BPM beat (`beat_frame`: kick in the lows, moving mid band, wave) with bursts on the beat, so
  audio-reactive shaders show what they do with music; the frame is saved as `user://visual_thumbs/v1/<key>.png`
  (a shader's key carries a hash of its `updatedAt`). One visual per frame, only rows in open folders, the queue drops when
  the list hides; a shader that fails to compile gets a ⚠ and its error in the tooltip.
- `features/live/visuals_sources_panel.gd`: the new **Sources ▸ Visuals** tab — filter, nested collapsible folders with
  counts (open folders remembered in ui.cfg `[sources] visuals_open`, Scenes open the first time), rows with the thumbnail
  (96 px), drag preview with the thumbnail, double-click = run as the main scene (group call `visuals_canvas`), rows on the
  canvas highlighted (group call `visuals_list` `mark_live` from `visuals_tab._go`). Dev `--visuals-filter=<text>`.
- `features/visuals/visuals_tab.gd`: the canvas takes the drop (`drop_visual`; Shift = layer 2), crossfading like a look;
  an open game window follows a new ROM.
- `features/visuals/visuals_page.gd`: the four dropdowns are gone; *Scene* and *Layer 2* are lines naming what runs
  ("Shader · Ribbons"), both take drops, Layer 2 has ✕. Game keeps Play and its note; the shader note stays.
- `features/live/media_panel.gd`: the Visuals tab after Live (`--sources-tab`: Media 0, CGs 1, Live 3, Visuals 4,
  Timelines 5); the Templates tab's title is **CGs** (the node keeps its name, so the ui.cfg group state is kept).
- `game_launcher.gd`: a missing games folder (media/games) is skipped instead of an ERROR line per listing.
- Tests: `tests/test_visuals_catalog.gd` (folders, themes, order, dedupe, filter, payloads, drops, describe, the fixed beat,
  the tab and page taking drops, ✕, the panel's tree, the CGs title).

## 3. What was verified

- Godot suite 24141 / 0; `run-client.sh --check` after every edit; file-length check 0 over 500.
- Box, a probe client on Xvfb :88 (`--tab=Visuals --sources-tab=4 --visuals-filter=a --visuals-ring=probe885`):
  - thumbnails: 21 after ~10 s, 119 after ~20 s, all 190 after ~30 s (5 scenes + 185 shaders) in `user://visual_thumbs/v1`;
    the screenshot shows the folders with counts and real frames (Warp speed, Cosmic scene, Audio Flight …);
  - drags (xdotool on :88 only): a row onto the canvas → Scene; with Shift → Layer 2 (Particles over Warp speed, the
    Particles row highlighted, ✕ shown); double-click on 3D Audio Visualizer → Scene; ✕ cleared layer 2 on the canvas —
    the Inspector line did not refresh, fixed (the tab re-sets the page) and pinned in the test.
  - The probe shares the project and autosaved the test picks; it was set back to the owner's state through the probe
    (`visuals` = shader sh-sa-3d-audio-visualizer, no layer 2; checked via `GET /api/project`). Probe and Xvfb stopped.
- Not proven: thumbnails and drags in the operator GUI on :0 (relaunched with this code).
