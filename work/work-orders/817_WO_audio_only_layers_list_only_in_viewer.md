# WO-817 — Godot look editor: audio-only layers transparent and not pickable in the viewer (list only)

**Status: DONE (29.10, Godot suite 22733/0 + boot check + demo-mode Xvfb render; owner QA owed on the real viewer) · live e2e 29.10: PASS on the real viewer**

Owner (29.10): "audio only layers should be transparent in the editor and not pickable in the viewer (the looks
editor) as it doesnt make sense to select them there. only in the list."

## Investigation

- **The viewer** is the look editor's compose frame, `godot/client/features/live/look_editor.gd` (not
  `compose_tiles.gd`, which is the Live preview's PGM/PRV operator windows). `_draw_frame()` drew an outline + "L# name"
  label for every layer with a source (`look_editor.gd:212-234` before the change); a left press went to
  `_begin_drag()` → handles of the selected layer, then `_layer_at()` = `look_layer_ops.gd layer_at()` (topmost box
  under the pointer) → `_select(hit)` + move drag (`look_editor.gd:278-304`). There is no hover selection in this
  view (mouse motion only moves an active drag). The list (`_list`, an ItemList) selects through `item_selected → _select`.
- **No stored per-layer audio flag exists.** A layer's source is stored as `{type: "media", value: "x.wav", label}`
  (live project `mhp_harder`: look "Intro" has `PK BACK TRACK.wav` / `PK CLICK.wav`, look "Audio test 8ch" four
  `tone_pair*.wav`, all `type: "media"`). The stored markers that do exist:
  - the look's `audioOnlyLook: true` (WO-572, `src/engine/audio-only-look.js:36` `isAudioOnlyLook`): the whole look
    plays as audio on layer 200, nothing goes on screen;
  - source `type` `audio` / `live_audio` (web `client/lib/scene-look-kind.js` NON_CG_SOURCE_TYPES; a `live_audio`
    layer is put on air at opacity 0, web `scenes-compose.js:203`, Godot `look_layer_drop.gd exchange_patch`).
- **Web reference** (read-only): `client/lib/media-audio-kind.js isLikelyAudioOnlySource` = media row `type ===
  'audio'` else the extension set `.mp3 .wav .aac .m4a .flac .ogg .opus .wma`; used by the timeline compose preview
  (`preview-canvas-draw-stacks.js:312`, audio beds are not drawn). The Godot look editor has no media list in the
  Store (media rows live only in `media_panel.gd _rows`), so the row-type tier is not available there; the extension
  set covers every audio layer found in the live projects.
- Drop: `look_editor.gd _drop()` (WO-816, another agent's work in progress) also calls `_layer_at()` to find the layer
  to exchange; it was left untouched.

## What was done

- **New `godot/client/features/live/look_layer_audio.gd`** (32 lines, pure):
  - `is_audio_only(layer, look = {})` (line 17): true when the layer has a source and (the look has
    `audioOnlyLook == true`, or the source type is `audio` / `live_audio`, or the source value's extension is one of
    the web AUDIO_EXT). An empty layer is never audio-only. Existing fields only — no new stored field.
  - `pick(layers, look, rect_of, at)` (line 31): `look_layer_ops.gd layer_at()` with every audio-only layer given an
    empty Rect2, so a click over one falls through to the video layer under it or the empty frame. `look_layer_ops.gd`
    itself is unchanged (its `layer_at` is shared with the WO-816 drop).
- **`godot/client/features/live/look_editor.gd`** (490 → 492 lines), picking and drawing lines only:
  - `:220` `_draw_frame` skips audio-only layers (no outline, label, crop line or handles — transparent).
  - `:282` `_begin_drag` grabs the selected layer's handles only when it is not audio-only (none are drawn for it).
  - `:298` the click-to-select uses `Audio.pick` instead of `_layer_at`, so the viewer never selects an audio-only layer.
  - `:313` `_others_fills` (snap targets of a move / resize) leaves out audio-only boxes, which are no longer visible.
- **Unchanged:** the layer list (audio-only rows select and edit as before, the Inspector page opens for them), the
  drop code (`_can_drop`, `_drop`, `_layer_at`, `look_layer_drop.gd`), the server, take, audio routing, layer data.

**Follow-up (not done, WO-816's area):** a Sources drop still exchanges an audio-only layer when it lands inside that
layer's now-invisible box (`_drop` → `_layer_at`). If that is unwanted, the drop can use `Audio.pick` too.

## Verified

- New test `godot/client/tests/test_look_layer_audio.gd` (15 assertions): helper (.wav/.MP3/live_audio/audio type,
  movie and still not audio, every layer of an `audioOnlyLook`, empty layer not audio) and the viewer pick (audio layer
  on top skipped → the video under it; audio only → -1; a video layer on top picked; an audio-only look's layer → -1).
- Godot suite: **22733 passed, 0 failed** (baseline 22698; +15 mine, the rest from parallel work).
- `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- Boot check `./run-client.sh --check`: `boot OK (no script errors)`.
- Render: a second client on a private Xvfb display (`:97`, never on :0) in the simulated server
  (`--demo --probe-edit=look-opener --probe-perf=1 --probe-shot=…`, nothing reaches the box's server): the demo look
  "Opener" (L10 opener.mov, L11 backing_track.wav, L12 click.wav) shows only the L10 box in the viewer, all three rows
  in the list — `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/audio_only_viewer/demo_opener_editor.png`.
- The owner's client was restarted on :0 (`--autostart --tab=0`) and comes up normally —
  `…/scratchpad/audio_only_viewer/after_relaunch.png` (the look editor is not open there; no clicks were made on :0).
- No look was taken, cleared or played; Caspar was not restarted.

**Owner QA owed:** open a look with a .wav layer (e.g. "Intro") in the editor: the wav layers draw nothing and a click
where they sit selects the video layer under them or deselects; selecting a wav row in the list still opens its
Inspector (volume, route, trim).

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** In the Intro editor the viewer draws only L10 INTRO_HAP; the .wav layers L11/L12 draw nothing
(q817_editor.png). A click in the viewer selects L10 under the wavs (q817_viewer_click.png). The L11 wav row still
selects from the list and opens the inspector (q817_row_click.png).

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).
