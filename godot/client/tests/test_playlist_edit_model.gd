extends RefCounted
## WO-603 slice 6 — playlist_edit_model.gd: the layer-inspector playlist editor's request bodies, labels, row-drop
## splice index and which drags it accepts (the edits themselves are planned in node, engine/playlist-edit.js).

const M := preload("res://features/live/playlist_edit_model.gd")
var t


func test_tables_and_bodies() -> void:
	t.eq(M.index_of(M.TRANSITIONS, "WIPE"), 3)
	t.eq(M.index_of(M.ADVANCE, "nope"), 0, "unknown → first")
	t.eq(M.index_of(M.MODES, "list"), 1)
	var layer := {"layerNumber": 10}
	t.eq(M.edit_body("s1", layer, "move", {"from": 0, "to": 2}), {"sceneId": "s1", "layer": layer, "op": "move", "from": 0, "to": 2})
	t.eq(M.edit_body("s1", layer, "describe"), {"sceneId": "s1", "layer": layer, "op": "describe"})


func test_row_name() -> void:
	t.eq(M.row_name({"name": "logo.png", "missing": true}), "⚠ logo.png")
	t.eq(M.row_name({"value": "AMB"}), "AMB", "falls back to the value")


func test_drop_index_matches_a_splice() -> void:
	# remove at `from`, insert at the returned index == the order the operator sees after the drop
	t.eq(M.drop_index(0, 2, 1, 3), 2, "first → below the last")
	t.eq(M.drop_index(0, 2, -1, 3), 1, "first → above the last")
	t.eq(M.drop_index(2, 0, -1, 3), 0, "last → above the first")
	t.eq(M.drop_index(2, 0, 1, 3), 1, "last → below the first")
	t.eq(M.drop_index(1, 1, 0, 3), -1, "onto itself")
	t.eq(M.drop_index(0, 0, 1, 3), -1, "just below itself = same place")
	t.eq(M.drop_index(0, -1, 0, 3), 2, "empty space under the rows → end")
	t.eq(M.drop_index(2, -1, 0, 3), -1, "the last row to the end")
	t.eq(M.drop_index(5, 0, 0, 3), -1, "stale from")


func test_droppable() -> void:
	t.ok(M.droppable({"type": "media", "value": "clip.mov"}), "one file")
	t.ok(M.droppable({"type": "route", "value": "route://3"}), "a live input")
	t.ok(not M.droppable({"type": "effect", "value": "blur"}), "effects are not items")
	t.ok(not M.droppable({"playlist_row": 1}), "an internal reorder is not an add")
	t.ok(not M.droppable("clip.mov"), "plain strings")
	t.ok(M.droppable({"type": "multi", "items": [{"type": "effect", "value": "x"}, {"type": "media", "value": "a.png"}]}), "multi with one usable item")
	t.ok(not M.droppable({"type": "multi", "items": [{"type": "effect", "value": "x"}]}), "multi of effects only")
