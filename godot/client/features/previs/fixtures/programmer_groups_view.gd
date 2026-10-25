extends Tree
## WO-771 — the Programmer's list as groups (owner 25.10: "toggle to change the list view to a groups view"): the saved
## groups, then the automatic ones (WO-680, By position / By address), each with its fixtures under it (folded).
## A click on a group selects its fixtures (grip / ctrl held adds them), on a fixture picks it (adds / removes). The
## selection is marked by row colour, never by the Tree's own selection: a fixture row lights when it is selected, a
## group row when all of its fixtures are (dimmer when only some are).

const ThemeBuilder := preload("res://app/theme_builder.gd")

signal picked(ids: Array, add: bool, group: bool)

const LIT := Color(0.35, 0.65, 1.0, 0.55)
const PART := Color(0.35, 0.65, 1.0, 0.22)

var _add := false
var _key := ""


func _init() -> void:
	columns = 1
	hide_root = true
	select_mode = Tree.SELECT_ROW
	add_theme_stylebox_override("selected", StyleBoxEmpty.new())
	add_theme_stylebox_override("selected_focus", StyleBoxEmpty.new())
	item_mouse_selected.connect(func(_at: Vector2, button: int) -> void:
		var it := get_selected()
		if it == null or button != MOUSE_BUTTON_LEFT:
			return
		var m: Variant = it.get_metadata(0)
		deselect_all()
		if m is Dictionary:
			picked.emit(m.ids, _add, m.group))


## The grip on the VR panel arrives as ctrl on the pushed click (xr_panel.gd), so it is read off the event here.
func _gui_input(event: InputEvent) -> void:
	var mb := event as InputEventMouseButton
	if mb != null and mb.pressed:
		_add = mb.ctrl_pressed or mb.shift_pressed or mb.meta_pressed


## typed: the Programmer's typed patch entries; sections: [[title, [{name, ids}]], …] (a "" title = top level).
## → whether the rows were rebuilt (then they need mark()).
func fill(typed: Array, sections: Array) -> bool:
	var key := JSON.stringify([typed.map(func(f: Dictionary) -> Array: return [f.id, f.name]), sections])
	if key == _key:
		return false
	_key = key
	var names := {}
	for f in typed:
		names[f.id] = str(f.name)
	clear()
	var root := create_item()
	for s in sections:
		var parent := root
		if str(s[0]) != "" and not (s[1] as Array).is_empty():
			parent = create_item(root)
			parent.set_text(0, str(s[0]))
			parent.set_selectable(0, false)
			parent.set_custom_color(0, ThemeBuilder.TEXT_MUTED)
		for g in s[1]:
			var ids: Array = (g.ids as Array).filter(func(id: String) -> bool: return names.has(id))
			var gi := create_item(parent)
			gi.set_text(0, "%s (%d)" % [g.name, ids.size()])
			gi.set_metadata(0, {"ids": ids, "group": true})
			gi.collapsed = true
			for id in ids:
				var fi := create_item(gi)
				fi.set_text(0, names[id])
				fi.set_metadata(0, {"ids": [id], "group": false})
	return true


## Colour the rows for the selection `sel_ids`; the last picked fixture's first row is scrolled into view (its group
## stays folded unless a fixture row of it is already shown).
func mark(sel_ids: Array) -> void:
	var root := get_root()
	if root == null:
		return
	var it := root.get_first_child()
	var shown: TreeItem = null
	var last: String = str(sel_ids.back()) if not sel_ids.is_empty() else ""
	while it != null:
		var m: Variant = it.get_metadata(0)
		if m is Dictionary:
			var st := state(m.ids, sel_ids)
			if st == 0:
				it.clear_custom_bg_color(0)
			else:
				it.set_custom_bg_color(0, LIT if st == 2 else PART)
			if shown == null and last != "" and (m.ids as Array).has(last) and it.is_visible_in_tree():
				shown = it
		it = it.get_next_in_tree()
	if shown != null:
		scroll_to_item(shown)


## 0 = none of `ids` selected, 1 = some, 2 = all (an empty group is never lit).
static func state(ids: Array, sel_ids: Array) -> int:
	var n := 0
	for id in ids:
		if sel_ids.has(id):
			n += 1
	return 0 if n == 0 else (2 if n == ids.size() else 1)
