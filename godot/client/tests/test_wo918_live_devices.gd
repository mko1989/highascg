extends RefCounted
## WO-918 F12 / F24 / F7 / F19 — the pure parts: when a look editor goes stale, which look the red PGM outline follows,
## how a look card lays out its missing-media labels, and when a drag released over a connector completes a cable.

const Stale := preload("res://features/live/look_editor_stale.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const TM := preload("res://features/live/look_thumb_math.gd")
const Drag := preload("res://features/devices/cable_drag_release.gd")
var t


func _project(slug: String, ids: Array) -> Dictionary:
	return {"slug": slug, "scenes": {"scenes": ids.map(func(i: String) -> Dictionary: return {"id": i})}}


func test_editor_goes_stale_with_its_project_look_or_bus() -> void:
	var p := _project("show", ["a", "b"])
	t.ok(not Stale.stale("show", p, "a", 1, 2), "same project, look there, main 2 has a destination")
	t.ok(Stale.stale("other", p, "a", 0, 2), "another project was loaded / created")
	t.ok(Stale.stale("show", _project("show", ["b"]), "a", 0, 2), "the look was deleted")
	t.ok(Stale.stale("show", p, "a", 1, 1), "main 2's destination was removed")
	t.ok(Stale.stale("show", {"slug": "show"}, "a", 0, 1), "no scenes at all")
	t.ok(not Stale.stale("show", _project("show", ["a", "b", "c"]), "a", 0, 1), "a background edit of the same project keeps it")
	t.ok(not Stale.stale("", _project("", ["a"]), "a", 0, 1), "unsaved project (no slug) before and after")


func test_pgm_outline_follows_scene_live_not_the_saved_slots() -> void:
	var known := {"a": true, "b": true}
	var saved := {"liveSceneIdByMain": ["a"], "previewSceneIdByMain": ["b"]}
	var cm := {"programChannels": [1], "previewChannels": [2]}
	var r := DeckModel.resolve_bus_look_ids(0, {}, cm, known, saved)
	t.eq(r.pgm, "", "a loaded project's saved live slot does not light the red outline while the server plays nothing")
	t.eq(r.prv, "", "…nor the green PRV one")
	r = DeckModel.resolve_bus_look_ids(0, {"1": {"sceneId": "b"}}, cm, known, saved)
	t.eq(r.pgm, "b", "scene.live decides")
	t.eq(DeckModel.resolve_bus_look_ids(0, {}, {}, known, saved).pgm, "a", "no PGM channel in the map (simulator): the saved slot serves")


func _w(s: String) -> float: return 6.0 * s.length()


func test_missing_media_labels_never_overlap() -> void:
	var box := Rect2(0, 0, 240, 135)
	var s := TM.label_slots([{"vis": box, "label": "No preview"}, {"vis": box, "label": "No preview"}], _w)
	t.eq(s.size(), 2, "two missing layers both get a label")
	t.ok(absf(s[1].pos.y - s[0].pos.y) >= TM.LABEL_LINE, "…on separate lines, not on top of each other")
	var narrow := TM.label_slots([{"vis": Rect2(0, 0, 40, 100), "label": "No preview"}], _w)
	t.eq(narrow.size(), 0, "a box too narrow for the text draws nothing instead of a clipped 'No p'")
	var long := TM.label_slots([{"vis": Rect2(0, 0, 100, 100), "label": "a_very_long_media_file_name.mov"}], _w)
	t.ok(long.size() == 1 and long[0].text.ends_with("…") and _w(long[0].text) <= 88.0, "a long name is elided to fit")
	t.eq(TM.label_slots([{"vis": Rect2(0, 0, 240, 12), "label": "No preview"}], _w).size(), 0, "a box shorter than a line draws nothing")
	t.eq(TM.label_slots([], _w), [], "no missing layers")


func test_drag_release_completes_only_a_real_drop() -> void:
	var d := Drag.new()
	d.arm(Vector2(100, 100), true)
	var far := Vector2(300, 140)
	t.ok(d.completes(true, true, far, "gpu_p1", "dst_in_1", true), "dragged onto a valid port")
	t.ok(not d.completes(true, true, Vector2(103, 101), "gpu_p1", "dst_in_1", true), "released where it was pressed = the click (click-click mode)")
	t.ok(not d.completes(true, true, far, "", "dst_in_1", true), "released over empty space: stays armed")
	t.ok(not d.completes(true, true, far, "dst_in_1", "dst_in_1", true), "released on its own dot")
	t.ok(not d.completes(true, true, far, "gpu_p1", "dst_in_1", false), "a port the cable cannot go to")
	t.ok(not d.completes(true, false, far, "gpu_p1", "dst_in_1", true), "a held cable end has its own drop (unplug_drop)")
	t.ok(not d.completes(false, true, far, "gpu_p1", "dst_in_1", true), "nothing armed")
	d.arm(Vector2(100, 100), false)
	t.ok(not d.completes(true, true, far, "gpu_p1", "dst_in_1", true), "armed without a button down (not a press on a dot)")
	d.arm(Vector2(100, 100), true)
	d.held = false
	t.ok(not d.completes(true, true, far, "gpu_p1", "dst_in_1", true), "only the arming press's own release can drop")


func test_gesture_wiring_and_status_reset() -> void:
	var g := FileAccess.get_file_as_string("res://features/devices/cable_gesture.gd")
	t.ok(g.contains("_drop.arm(get_viewport().get_mouse_position(), Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT))"), "arming notes the press")
	t.ok(g.contains("\tif drop:\n\t\tawait click(key)"), "a drop on a valid connector finishes through the normal click path")
	var lt := FileAccess.get_file_as_string("res://features/live/live_tab.gd")
	t.ok(lt.contains("_action.text = ACTION_HINT"), "the status line resets when another project loads")
	var ed := FileAccess.get_file_as_string("res://features/live/look_editor.gd")
	t.ok(ed.contains("Stale.close_if_stale(self)"), "the look editor checks itself on project / channelMap changes")
