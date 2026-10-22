extends RefCounted
## WO-681 — mvr_model.gd drop_scene / content_text: a scene going off (another pick, none, Remove) takes its patched
## fixtures and the LED walls mapped from it; hand-made fixtures, walls and other scenes' walls stay.

const M := preload("res://features/previs/mvr_model.gd")
var t


func _project() -> Dictionary:
	return {"fixtures": {"patch": [{"id": "mvr-a"}, {"id": "mvr-b"}, {"id": "hand-1"}, {"id": "mvr-z"}], "groups": [{"name": "g", "ids": ["mvr-a"]}]},
		"previs": {"stage": {"version": 1, "objects": [{"id": "led_wall_1", "mvr": "S1"}, {"id": "led_wall_2"},
			{"id": "led_wall_3", "mvr": "S2"}]}}}


func test_drop_takes_the_scenes_fixtures_and_walls() -> void:
	var p := _project()
	var copy := p.duplicate(true)
	t.eq(M.drop_scene(copy, "S1", ["a", "b"]), [2, 1], "counted on a copy")
	t.eq(p, _project(), "… the project itself untouched")
	t.eq(M.drop_scene(p, "S1", ["a", "b"]), [2, 1], "two fixtures, one wall")
	t.eq(p.fixtures.patch, [{"id": "hand-1"}, {"id": "mvr-z"}], "hand patch and other scenes' fixtures stay")
	t.eq(p.previs.stage.objects.map(func(o: Dictionary) -> String: return o.id), ["led_wall_2", "led_wall_3"],
		"hand-made walls and other scenes' walls stay")
	t.eq(p.fixtures.groups, [{"name": "g", "ids": ["mvr-a"]}], "groups keep their ids (a re-import revives them)")
	t.eq(M.drop_scene(p, "S1", ["a", "b"]), [0, 0], "nothing left the second time")
	t.eq(M.drop_scene({}, "", []), [0, 0], "no project, no scene")
	t.eq(M.drop_scene(_project(), "", []).back(), 0, "no scene id never takes walls")


func test_content_text() -> void:
	t.eq(M.content_text([52, 3]), "its 52 patched fixtures and 3 LED walls mapped from it")
	t.eq(M.content_text([1, 0]), "its 1 patched fixture")
	t.eq(M.content_text([0, 1]), "its 1 LED wall mapped from it")
	t.eq(M.content_text([0, 0]), "")
