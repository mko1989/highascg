extends RefCounted
## WO-771 — the Programmer's groups view (programmer_groups_view.gd): rows per group with its fixtures, row colours for
## the selection, clicks → picked; and the VR panel's list highlight / scroll (programmer_section.gd, xr_panel.gd).

const V := preload("res://features/previs/fixtures/programmer_groups_view.gd")
var t


func _typed() -> Array:
	return [{"id": "a", "name": "Spot 1"}, {"id": "b", "name": "Spot 2"}, {"id": "c", "name": "Wash 1"}]


func test_state() -> void:
	t.eq(V.state(["a", "b"], []), 0, "none")
	t.eq(V.state(["a", "b"], ["b"]), 1, "some")
	t.eq(V.state(["a", "b"], ["b", "a", "c"]), 2, "all")
	t.eq(V.state([], ["a"]), 0, "an empty group is never lit")


func test_fill_and_mark() -> void:
	var v: Tree = V.new()
	var sections := [["", [{"name": "Spots", "ids": ["a", "b", "gone"]}]], ["By address", [{"name": "Universe 1", "ids": ["a", "b", "c"]}]], ["By position", []]]
	t.ok(v.fill(_typed(), sections), "first fill builds")
	t.ok(not v.fill(_typed(), sections), "same content: rows (and their folds) kept")
	var root := v.get_root()
	t.eq(root.get_child_count(), 2, "a saved group at the top, one section header, empty sections dropped")
	var spots := root.get_child(0)
	t.eq(spots.get_text(0), "Spots (2)", "unpatched ids are left out of the group")
	t.eq(spots.get_child(1).get_text(0), "Spot 2", "the group's fixtures under it")
	t.ok(spots.collapsed, "folded")
	var header := root.get_child(1)
	t.ok(not header.is_selectable(0), "a section header is not a pick")
	v.mark(["a", "b"])
	t.eq(spots.get_custom_bg_color(0), V.LIT, "all of a group selected: lit")
	t.eq(header.get_child(0).get_custom_bg_color(0), V.PART, "some: dim")
	t.eq(spots.get_child(0).get_custom_bg_color(0), V.LIT, "a selected fixture row: lit")
	v.mark([])
	t.ok(spots.get_custom_bg_color(0) != V.LIT and spots.get_custom_bg_color(0) != V.PART, "cleared")
	v.free()


func test_hooks() -> void:
	var p := FileAccess.get_file_as_string("res://features/previs/fixtures/programmer_section.gd")
	t.ok(p.contains('b.text = "Groups" if groups else "Fixtures"'), "Fixtures | Groups switch")
	t.ok(p.contains("_list.ensure_current_is_visible()"), "a stage pick scrolls the list to it")
	t.ok(p.contains("sel.set_ids(sel.ids + ids if add else ids)"), "a group click selects (grip adds)")
	var x := FileAccess.get_file_as_string("res://features/previs/xr/xr_panel.gd")
	t.ok(x.contains('t.set_stylebox(style, "ItemList", lit)'), "VR list: selected rows in accent")
