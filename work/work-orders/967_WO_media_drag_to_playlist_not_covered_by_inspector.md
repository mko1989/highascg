# WO-967 — Dragging a media file into a layer's playlist: the file's Inspector page no longer covers the drop target

**Area:** godot-client
**Status: DONE (05.11.26 — Godot suite 26002/0, boot check OK; owner QA on the box: no GUI e2e by owner rule 05.11)**

Owner 05.11: *"when i try to drag media into a playlist, the clip is being inspected, so i cant drag it into a playlist.
works second time."*

Related: [WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md) (one Inspector column; a single selected file
shows its page there), [WO-766](./766_WO_playlist_preview_pick_manual_no_loop_fade_down.md) (playlist workflow),
[WO-965](./965_WO_media_drop_opens_layer_inspector.md).

## 1. Investigation

- A layer's playlist is edited in the layer's Inspector page (`features/live/playlist_section.gd`). Its drop hint and
  item tree take Sources drops (`set_drag_forwarding` at `playlist_section.gd:61,75`).
- In Sources → Media (`features/live/media_panel.gd`), the Tree selects a row on mouse **press**. `multi_selected` →
  `_on_selection` (deferred, same frame) presented the media file's own page right away:
  `InspectorPanel.current.present(inspector)`. That page covers the layer page (WO-608: one column).
- So the first drag from an unselected file replaced the layer page, and with it the playlist section, before the
  pointer had moved. The drag had nothing to drop on.
- On the second try the file was already selected, so the press changed nothing and no page was presented. The
  operator had re-selected the layer in the meantime, so its page and playlist were showing, and the drop worked.
  That matches "works second time".
- Only the media list presents a page on selection. Templates, Live and Timelines rows do not.

## 2. What was done

`media_panel.gd`:
- When `_on_selection` runs while the left button is held (a mouse press), it only remembers the file (`_press_row`).
- The Tree's left-button **release** (`_tree_input`) then shows the page through the new `show_file(row)`. That is a
  click.
- `_drag_data` clears `_press_row`. When the press turns into a drag, the file's page is never shown, and the drop
  target (the layer page with its playlist, the look editor, …) stays in the Inspector.
- A keyboard selection, or a selection made with no button held, still shows the page at once.
- Multi-select is unchanged.

This keeps the click behaviour the owner asked for in WO-608 (a single file shows its page) and fixes only the press
that starts a drag. The file stays at 500 lines (two header comment lines merged).

## 3. Verified

- Godot suite 26002 passed, 0 failed; `run-client.sh --check` boot OK.
- No GUI e2e: owner 05.11, *"dont spin other caspars and guis. work on whats already running"*. The owner's GUI was
  relaunched on this code.

Owner QA:
- With a layer's page open, drag an unselected media file straight into its playlist; it adds on the first try.
- A plain click on a file still shows its page.
