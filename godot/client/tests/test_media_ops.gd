extends RefCounted
## WO-603 slice 2 — media-tree operations: picker folders, request bodies, result lines (server shapes from
## src/api/routes-media.js runBatchMediaOp).

const O := preload("res://features/live/media_ops.gd")
var t


func test_picker_folders_are_on_disk_rows() -> void:
	var rows := [{"id": "b", "isDir": true}, {"id": "a/x", "isDir": true}, {"id": "PROJECTS/AIRPORT/CLIP", "type": "MOVIE"},
		{"id": "a/x", "isDir": true}, {"id": "a", "isDir": true}, {"id": "a/x/f.mov", "isDir": false}]
	t.eq(Array(O.folders(rows)), ["a", "a/x", "b"], "isDir rows only, sorted, deduped — no CLS folders")


func test_paths_and_bodies() -> void:
	t.eq(O.clean_folder(" /a//b \\c/ "), "a/b/c", "slashes + spaces")
	t.eq(O.join_folder("", "New"), "New", "root")
	t.eq(O.join_folder("projects/airport", " Akt 2 "), "projects/airport/Akt 2", "nested")
	t.eq(O.transfer_body(["a.mov"], "/x/y/"), {"sourceIds": ["a.mov"], "targetId": "x/y"}, "copy/move")
	t.eq(O.transfer_body(["a.mov"], ""), {"sourceIds": ["a.mov"], "targetId": ""}, "'' = the media root")
	t.eq(O.delete_body(["a", "b"]), {"ids": ["a", "b"]}, "delete")


func test_result_lines() -> void:
	t.eq(O.result_text("Moved", 3, {"ok": true, "data": {"ok": true, "moved": 3, "count": 3}}), "✓ Moved 3 files", "all")
	t.eq(O.result_text("Copied", 1, {"ok": true, "data": {"ok": true, "copied": 1, "count": 1}}), "✓ Copied 1 file", "one")
	t.eq(O.result_text("Moved", 3, {"ok": true, "data": {"ok": false, "count": 1, "errors": [{"id": "x/a.mov", "error": "Source is already in target folder"}]}}),
		"✗ Moved 1 of 3 — a.mov: Source is already in target folder", "partial (HTTP 200)")
	t.eq(O.result_text("Deleted", 2, {"ok": false, "error": "Source not found", "data": {"error": "Source not found"}}), "✗ Deleted 0 of 2 — Source not found", "refused")


func test_tree_merges_cls_folders_into_disk_spelling() -> void:
	var rows := [{"id": "PROJECTS/AIRPORT/1. GŁÓWNE TŁO", "type": "MOVIE"}, {"id": "projects", "isDir": true},
		{"id": "projects/airport", "isDir": true}, {"id": "projects/airport/a.mov"}, {"id": "empty", "isDir": true}, {"id": "ROOTCLIP", "type": "STILL"}]
	var e := O.tree_entries(rows)
	var dirs := e.filter(func(x: Dictionary) -> bool: return x.kind == "dir").map(func(x: Dictionary) -> String: return x.folder)
	t.eq(dirs, ["projects", "projects/airport", "empty"], "one folder per path, on-disk spelling, empty folders kept")
	var files := e.filter(func(x: Dictionary) -> bool: return x.kind == "file").map(func(x: Dictionary) -> Array: return [x.parent, x.label])
	t.eq(files, [["projects/airport", "1. GŁÓWNE TŁO"], ["projects/airport", "a.mov"], ["", "ROOTCLIP"]], "CLS clip files under the disk folder")
	var f := O.tree_entries(rows, "główne")
	t.eq(f.map(func(x: Dictionary) -> String: return x.label), ["projects", "airport", "1. GŁÓWNE TŁO"], "filter (unicode lower): only the match's folders, still on-disk spelling")
	t.eq(f[1].folder, "projects/airport", "New folder… / drops under a filtered folder use the disk path")
	t.eq(O.tree_entries([{"id": "a/b.mov"}]).map(func(x: Dictionary) -> String: return x.kind), ["dir", "file"], "parent before child")


func test_rename_plan_body() -> void:
	t.eq(O.plan_body(["a/01_X.mov"], "Y", false, 1, 1, 2), {"ids": ["a/01_X.mov"], "title": "Y", "renumber": null}, "title only")
	t.eq(O.plan_body(["a"], "", true, 10.0, 5.0, 3.0), {"ids": ["a"], "title": "", "renumber": {"start": 10, "step": 5, "pad": 3}}, "renumber ints")


func test_drag_payload_multi_only_from_the_selection() -> void:
	var a := {"type": "media", "value": "a.mov", "label": "a.mov", "row": {"id": "a.mov"}}
	var b := {"type": "media", "value": "b.png", "label": "b.png", "row": {"id": "b.png"}}
	var c := {"type": "media", "value": "c.mov", "label": "c.mov", "row": {"id": "c.mov"}}
	t.eq(O.drag_payload(a, [a, b]), {"type": "multi", "items": [{"type": "media", "value": "a.mov", "label": "a.mov"}, {"type": "media", "value": "b.png", "label": "b.png"}]}, "dragged row is selected → all of the selection (web multi)")
	t.eq(O.drag_payload(c, [a, b]), {"type": "media", "value": "c.mov", "label": "c.mov"}, "dragging an unselected row drags only it")
	t.eq(O.drag_payload(a, [a]), {"type": "media", "value": "a.mov", "label": "a.mov"}, "a single selection stays a single payload")


func test_folder_drop_ids_web_rule() -> void:
	var a := {"type": "media", "value": "x/a.mov", "label": "x/a.mov"}
	var b := {"type": "media", "value": "y/b.png", "label": "y/b.png"}
	t.eq(O.folder_drop_ids(a, "y"), ["x/a.mov"], "one file into another folder")
	t.eq(O.folder_drop_ids(a, "x"), [], "already there → no drop")
	t.eq(O.folder_drop_ids({"type": "multi", "items": [a, b]}, "y"), ["x/a.mov", "y/b.png"], "any movable → all ids (the server reports the one already there)")
	t.eq(O.folder_drop_ids({"type": "multi", "items": [a, {"type": "effect", "value": "blur"}]}, "z"), ["x/a.mov"], "media items only")
	t.eq(O.folder_drop_ids({"type": "route", "value": "route://3"}, "z"), [], "live sources never move")
	t.eq(O.folder_drop_ids({"type": "media", "value": "x"}, "x"), [], "a folder onto itself")
