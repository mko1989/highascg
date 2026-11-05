# WO-965 — A media file dropped into the look editor brings the new layer's Inspector page forward

**Area:** godot-client
**Status: DONE (05.11.26 — GUI e2e 21 5/5 in the sandbox, failing step reproduced first; owner QA)**

Owner 05.11: *"droping a media into looks editor should auto open the layers inspector"*

Related: [WO-816](./816_WO_drop_media_on_layer_exchange.md) (drops on the look editor),
[WO-952](./952_WO_layer_presets_tab.md) (the Layer presets tab that stays in front on layer clicks),
[WO-783](./783_WO_look_presets_right_column_tab.md) (the right column's tabs).

## 1. Investigation

- A Sources drop on the editor's frame or list goes through `features/live/look_layer_drop.gd`.
  - `add()` appends the server-built layer and calls `ed._select(last)`.
  - `exchange()` calls `ed._select(i)`.
  - `look_editor.gd` `_select` presents the layer page (`InspectorPanel.current.present(_page)`).
- `app/inspector_panel.gd` `present()` switches the column to its "Inspector" tab, unless the tab in front was added
  with `keep_on_select`. "Layer presets" is such a tab (WO-952), so clicking layers and pressing Apply works without
  losing the tab.
- **Reproduced** in a new GUI e2e (`21_wo965_drop_opens_layer_inspector`):
  - A drop with the Inspector tab in front opened the layer page; this already worked.
  - With Layer presets in front, a drop added the layer and loaded its page behind the tab. The column stayed on
    Layer presets (`tab 2`): "the Inspector column stayed on Layer presets". To the operator, nothing opened.
- Dragging from Sources also selects the dragged file, so its media page shows first. A drop with the Inspector tab in
  front did replace it with the layer page, and it stayed there 1.5 s later (checked).
- A drop on the deck's "+" makes a new look but does not open the editor. That path never had a layer page and is
  not changed here.

## 2. What was done

- `look_layer_drop.gd` `reveal(ed)` runs after the select in both `add()` and `exchange()`. When the editor's layer
  page is the one shown, it brings the column's Inspector tab forward (`show_tab(0)`).
  - A media drop is a new layer, not a layer click, so the WO-952 "stay on Layer presets" rule for clicks is kept.
  - It is guarded for the unit tests' fake editor (`ed is Node`).

## 3. Verified

- **GUI e2e** `21_wo965_drop_opens_layer_inspector` (sandbox, hidden Xvfb): 5/5.
  - A clip makes a look, and the editor opens on it.
  - Selecting the still in Sources shows its media page; dropping it into the frame shows layer 2's page, still
    there after 1.5 s (screenshot: the layer Inspector beside the editor).
  - With Layer presets in front, a clip drop makes layer 3 and the column switches to the Inspector tab with its page.
    This step failed before the change.
- Godot suite: 25981 passed; the 1 failure is another in-progress scenario (WO-961), not this change.

Owner QA: drop a file into an open look with Layer presets / Look presets in front.
