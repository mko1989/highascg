extends RefCounted
## WO-1100 (owner 16.11: "there is no way in the previs to deselect a clicked object") — one selection in the previs 3D
## view, the rule every 3D editor has. `m` is move_targets.gd (it holds the parts): `sel` (fixture_selection.gd, the
## Programmer's heads), `fixtures3d` (click), `builder` (pick), `stage_panel` (select / deselect / selected_id) and
## `mvr_section` (click / selected_uuids, its walls `_screens`). Pure of autoloads (tests pass fakes).
## - A click (no drag: the caller's 4 px) on a head, else a stage object, else an MVR object selects that one thing; a
##   plain click clears the other kinds (one "thing I am working on" — the Position card, Delete and the nudge keys
##   already act on the last kind picked, so a leftover highlight of another kind only misleads). Ctrl / shift adds or
##   removes within its kind; clicking the selected thing again keeps it (no toggle: double-click and drag-start).
## - A click on empty space clears everything; Esc too (previs_tab.gd, 3D mode, no drag; dialogs, menus and fields
##   take their Esc first). The console's selection (WO-857) is a separate set and never cleared here.
## - While a floor tool owns the clicks (calibration "Place mark", the Programmer's "Point at" with heads), a click goes to
##   the tool as before and neither an empty click nor Esc clears anything; the tool's own button turns it off.


static func tool_owns_click(sel: Object) -> bool:
	return bool(sel.mark_pick) or (bool(sel.point_at) and not (sel.ids as Array).is_empty())


## A left click at `at` → "heads" | "stage" | "mvr" (picked), "tool" (a floor tool took it), "none" (empty space:
## everything cleared) or "" (an add-click on nothing: left alone).
static func click(m: Object, cam: Camera3D, at: Vector2, add: bool) -> String:
	var tool := tool_owns_click(m.sel)
	var alone := not add and not tool
	if m.fixtures3d.click(cam, at, add):
		if tool:
			return "tool"
		if alone:
			_clear(m, "heads")
		return "heads"
	var id: String = m.builder.pick(cam, at)
	if id != "":
		if alone:
			_clear(m, "stage")
		m.stage_panel.select(id)
		return "stage"
	if m.mvr_section.click(cam, at, add):  # a plain click on nothing clears the walls itself
		if alone:
			_clear(m, "mvr")
		return "mvr"
	if not alone:
		return ""
	clear(m)
	return "none"


## Whether anything is selected (heads, a stage object, MVR objects).
static func any(m: Object) -> bool:
	return not (m.sel.ids as Array).is_empty() or str(m.stage_panel.selected_id()) != "" \
		or not (m.mvr_section.selected_uuids() as Array).is_empty()


## Esc: clears everything unless a floor tool owns the clicks. → whether it did (else Esc goes on: view focus …).
static func escape(m: Object) -> bool:
	if tool_owns_click(m.sel) or not any(m):
		return false
	clear(m)
	return true


static func clear(m: Object) -> void:
	_clear(m, "")


static func _clear(m: Object, keep: String) -> void:
	if keep != "heads" and not (m.sel.ids as Array).is_empty():
		m.sel.set_ids([])
	if keep != "stage" and str(m.stage_panel.selected_id()) != "":
		m.stage_panel.deselect()
	if keep != "mvr" and not (m.mvr_section.selected_uuids() as Array).is_empty():
		m.mvr_section._screens.clear()
		if m.has_signal("changed"):
			m.changed.emit()  # move_targets: the Position card hides (walls emit no pick when they clear)
