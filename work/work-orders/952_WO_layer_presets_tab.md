# WO-952 — Layer presets: a tab of the right column, like Look presets

**Area:** godot-client
**Status: DONE (05.11.26 — Godot suite 25895/0 (+40), boot check OK; save / apply / drag-onto-layer / duplicate / rename / remove used in a test client against the sandbox server, values read back from the layer fields and from /api/project) — owner QA**

Owner 05.11: *"add layer presets similarly to looks presets, also a tab in the inspector where users can store configs
of layers to be easily recalled to other media etc."*

Related: [WO-851](./851_WO_look_and_layer_presets.md) (the web's Inspector | Layer presets | Look presets modes, the
`layerPresets[]` data), [WO-601](./601_WO_godot_port_inspector.md) (the Godot layer-style row), [WO-783](./783_WO_look_presets_right_column_tab.md) (the
right column's tabs), [WO-816](./816_WO_drop_media_on_layer_exchange.md) (drops on a layer).

## 1. Investigation

- The data already exists and syncs: `project.scenes.layerPresets = [{id, name, data}]`.
  - It travels in the deck sync (`core/project_sync.gd:116`).
  - `data` is the layer style: everything but the source (`features/live/layer_style_model.gd` `style_data` /
    `style_patch`, a golden-tested port of the web's `getLayerStyleDataFromLayer` / `applyLayerStyleData`). That
    covers fill, opacity, rotation, loop, audio, keyer, content fit, start, effects, transition, fade-on-end and PIP
    overlays.
- In Godot the presets are reachable only through the "Layer style" row of the layer page
  (`features/live/layer_style_row.gd`):
  - Copy and Paste;
  - "Save preset…";
  - an "Apply preset…" OptionButton that shows names only.
  There is no list, rename, overwrite or remove. The web had a Layer presets mode (WO-851); the Godot port did not.
- The right column already has tabs: Inspector, plus panes added with `InspectorPanel.add_tab()` (WO-783 "Look
  presets", registered in `features/live/live_tab.gd`). `present()` (a new selection) brings the Inspector tab back.
- Applying a preset writes the selected layer through `look_editor.gd` `_apply_layer(patch)`, the same call every
  layer field makes, followed by the PRV push.
  - `_apply_layer` patches `_sel`, the editor's selected layer.
  - `_select(i, false)` selects a layer without taking the column back to the Inspector.
- Drops on the look editor's frame and list go through `_can_drop` / `_drop`, which delegate to
  `look_layer_drop.gd` (WO-816).
  - `Ops.drop_sources` keeps only media-like payloads.
  - `look_editor.gd` is at the 500-line cap, so any change there must be line-neutral.
- Headless Godot tests cannot compile scripts that use autoloads (Store, ProjectSync, Api). Pure logic therefore goes
  in models, as `layer_style_model.gd` / `look_preset_model.gd` already do.

## 2. What was done

- **`features/live/layer_preset_page.gd`** (new) is the "Layer presets" tab, registered beside Look presets in
  `live_tab.gd`. Its target is the look editor's selected layer ("Target: L11 e2e_bars.mp4 · look …"; a warning when
  no look is open). It offers:
  - "Save selected layer…" (the name is prefilled with the media name and selected, RULES.md input 1);
  - a card per preset: a 16:9 thumbnail of the box, the name, a summary line ("33%×33% at 65%, 63% · opacity 60% ·
    MIX auto …"), **Apply** (also double-click), and ⋯ → Rename / Overwrite with the selected layer / Duplicate /
    Remove (with confirmation);
  - cards that can be dragged.
  The records are the existing `layerPresets` ones, so the web, the deck sync and the layer page's picker all keep
  working. An edit emits `project_changed`, then deck sync and autosave.
- **`features/live/layer_preset_model.gd`** (new, pure): `summary`, `make`, `rename` (unique, its own name allowed),
  `overwrite`, `duplicate_preset` (a deep copy right after the original), `remove`, `find`, and the drag payload. The
  payload carries the style itself, so the drop needs no project read.
- **Drag a preset onto a layer.** `look_layer_drop.gd` gains `can_take` and `drop_data`: a preset card dropped on a
  layer's box or row applies there, or to the selected layer when it lands on no layer. The media stays.
  `look_editor.gd`'s `_can_drop` / `_drop` delegate to them, a line-neutral change (the file is at 500).
- **The tab stays while layers are clicked.** `app/inspector_panel.gd` `add_tab(title, pane, keep_on_select)`:
  `present()` still swaps the Inspector page underneath but no longer switches tabs when the shown tab keeps.
  - Only Layer presets uses it.
  - Without it, every layer click took the column back to the Inspector, so "select, Apply, select the next, Apply"
    needed a tab click per layer. Found on the test client.
- `layer_style_row.gd` (the layer page's picker) refills on `project_changed` and announces its own saves, so both
  views list the same presets.

## 3. Verified

- Godot suite: 25895 passed, 0 failed.
  - New: `test_layer_preset_model` (summary, make / rename / overwrite / duplicate / remove, a preset dropped on a
    layer keeps its media and does not take the column, a drop on no layer uses the selected one).
  - New: `test_inspector_panel::test_keep_on_select_tab`.
- `run-client.sh --check`: boot OK.
- The 5 smokes that read the touched files: 16/16. `check-max-file-lines` OK.
- Test client (`tools/test-agent/ui`, sandbox server):
  - L10 set to 640×360 at 1240,680, opacity 0.6, and saved as "Corner PIP". The card read "33%×33% at 65%, 63% ·
    opacity 60% · fit: native".
  - L11 clicked: the tab stayed, with Target "L11 e2e_bars.mp4". After Apply, L11's fields read X 1240, Y 680,
    W 640, H 360, opacity 0.6, with its media unchanged.
  - L11 reset to full frame, then the card dragged onto its row: the same values again.
  - Duplicate gave "Corner PIP (2)"; Rename, then Remove with confirmation, worked.
  - The layer page's "Apply preset…" lists "Corner PIP". `/api/project` and `/api/state` carry the record.
- Seen on the way, not caused by this WO: in a brand-new sandbox project the look editor closes itself a few
  seconds after the first look is created. The WO-918 F12 stale check most likely sees the slug change at the
  first autosave.

Owner QA: the tab on the operator screens, and whether a preset should also apply to several selected layers at once
(the look editor selects one layer today).
