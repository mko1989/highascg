extends RefCounted
## WO-774 — VR box select (the press ray's view, drag threshold, inside test, order, outline), the fixture-type filter
## (patch types, select a type), the right grip's pan / tilt fan (shares, dead zone, hand move, bases, values) and its
## session (xr_fan.gd: one write per fixture, untouched axes never written, the release announces `aimed`), and the
## trigger's routing (WO-841: a release on the floor no longer aims — the right grip does, test_xr_grip_wo841.gd).

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const Fan := preload("res://features/previs/xr/xr_fan.gd")
const XrWalk := preload("res://features/previs/xr/xr_walk.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
var t


func _close(a: Variant, b: Vector2, eps := 1e-4) -> bool:
	return a is Vector2 and (a as Vector2).distance_to(b) < eps


func test_view_angles_and_threshold() -> void:
	var fr := Walk.view_frame(Vector3(0, 0, -1))
	t.ok(_close(Walk.view_angles(fr, Vector3(1, 0, -1)), Vector2(PI / 4.0, 0.0)), "45° right of the ray")
	t.ok(_close(Walk.view_angles(fr, Vector3(0, 1, -1)), Vector2(0.0, PI / 4.0)), "45° above it")
	t.eq(Walk.view_angles(fr, Vector3(0, 0, 1)), null, "behind the ray: none")
	var rolled := Walk.view_frame(Vector3(0, -0.5, -1))
	t.ok(absf(rolled.x.y) < 1e-6, "the box's x stays level with the floor whatever the pitch")
	var down := Walk.view_frame(Vector3(0, -1, 0))
	t.ok(_close(Walk.view_angles(down, Vector3(0, -1, -0.2)), Vector2(0.0, atan(0.2))), "straight down: upstage is up")
	t.eq(Walk.dragged(Vector2(deg_to_rad(1.0), deg_to_rad(-2.0))), false, "a hand tremor is a click")
	t.eq(Walk.dragged(Vector2(0.0, deg_to_rad(-Walk.BOX_MIN_DEG - 0.1))), true, "past BOX_MIN_DEG either way is a box")
	t.eq(Walk.dragged(null), false, "a ray swung behind is no box")
	t.ok(Walk.in_box(Vector2(-0.2, 0.1), Vector2(-0.1, 0.05)), "a box dragged up-left holds what is between")
	t.ok(not Walk.in_box(Vector2(-0.2, 0.1), Vector2(0.01, 0.05)), "right of the press is outside it")
	t.ok(Walk.in_box(Vector2(0.2, -0.1), Vector2(0.2, 0.0)), "edges count")


func test_box_pick() -> void:
	var heads := {
		"a": {"at": Vector3(0, 0, -5), "type": "t1"},
		"b": {"at": Vector3(-0.5, 0, -5), "type": "t1"},
		"c": {"at": Vector3(3, 0, -5), "type": "t1"},
		"d": {"at": Vector3(0, 0, 5), "type": "t1"},
		"e": {"at": Vector3(0.5, 0.1, -5), "type": "t2"},
	}
	var d0 := Vector3(-1, 1, -5)
	var d1 := Vector3(1, -1, -5)
	t.eq(Walk.box_pick(Vector3.ZERO, d0, d1, heads), ["b", "a", "e"], "inside the box, left to right; beside / behind out")
	t.eq(Walk.box_pick(Vector3.ZERO, d0, d1, heads, "t1"), ["b", "a"], "a type chosen: only that type")
	t.eq(Walk.box_pick(Vector3.ZERO, d1, d0, heads), ["b", "a", "e"], "dragged the other way: the same heads, same order")
	t.eq(Walk.box_pick(Vector3.ZERO, d0, Vector3(0, 0, 5), heads), [], "the ray swung behind: nothing")


func test_box_outline_and_select() -> void:
	var pts := Walk.box_outline(Vector3(0, 1, 0), Vector3(0, 0, -1), Vector3(0.2, -0.1, -1))
	t.eq(pts.size(), 4 * Walk.BOX_STEPS + 1, "four curved edges, closed")
	t.ok(pts[0].distance_to(Vector3(0, 1, -Walk.BOX_DIST)) < 1e-5, "starts at the press ray, BOX_DIST out")
	t.ok(pts[0].distance_to(pts[pts.size() - 1]) < 1e-6, "and ends there")
	t.ok(absf(pts[Walk.BOX_STEPS * 2].distance_to(Vector3(0, 1, 0)) - Walk.BOX_DIST) < 1e-5,
		"the far corner lies on the current ray's sphere")
	t.eq(Walk.box_outline(Vector3.ZERO, Vector3(0, 0, -1), Vector3(0, 0, 1)).size(), 0, "behind: nothing drawn")
	t.eq(Walk.box_select(["x"], ["a", "b"], false), ["a", "b"], "a box replaces the selection")
	t.eq(Walk.box_select(["x", "a"], ["a", "b"], true), ["x", "a", "b"], "left grip held: adds (no doubles)")
	t.eq(Walk.box_select(["x"], [], false), ["x"], "an empty box changes nothing")


func test_patch_types() -> void:
	var patch := [{"id": "f1", "typeId": "bbb"}, {"id": "f2", "typeId": "aaa"}, {"id": "f3", "typeId": "bbb"},
		{"id": "f4", "typeId": ""}]
	var types := Walk.patch_types(patch, {"bbb": "Clay Paky Sharpy", "aaa": "Robe Spiider"})
	t.eq(types, [{"id": "bbb", "name": "Clay Paky Sharpy", "count": 2}, {"id": "aaa", "name": "Robe Spiider", "count": 1}],
		"each type once with its count, by name; untyped heads are no type")
	t.eq(Walk.patch_types(patch, {})[0].name, "Type aaa", "before the names load: the id")
	t.eq(Walk.of_type(patch, "bbb"), ["f1", "f3"], "Select: that type, patch order")
	t.eq(Walk.of_type(patch, "zzz"), [], "a type gone from the patch selects nothing")


func test_fan_maths() -> void:
	t.eq(Walk.fan_k(0, 1), 0.0, "one fixture: no fan")
	t.eq([Walk.fan_k(0, 3), Walk.fan_k(1, 3), Walk.fan_k(2, 3)], [-1.0, 0.0, 1.0], "first / middle / last")
	t.ok(absf(Walk.fan_k(1, 4) + 1.0 / 3.0) < 1e-9 and absf(Walk.fan_k(2, 4) - 1.0 / 3.0) < 1e-9, "even count: symmetric")
	t.eq(Walk.fan_spread(Walk.FAN_DEAD_M * 0.9), 0.0, "hand jitter: nothing")
	t.ok(absf(Walk.fan_spread(Walk.FAN_DEAD_M + 0.1) - 0.1 * Walk.FAN_DEG_PER_M) < 1e-6, "past the dead zone: degrees per metre")
	t.ok(Walk.fan_spread(-0.2) < 0.0, "the other way: negative")
	var left := Basis(Vector3.UP, PI / 2.0)  # the head turned 90° left: its right is upstage (-Z)
	var m := Walk.fan_move(Vector3.ZERO, Vector3(0, 0.1 + Walk.FAN_DEAD_M, -0.1 - Walk.FAN_DEAD_M), left)
	t.ok(_close(m, Vector2(0.1, 0.1) * Walk.FAN_DEG_PER_M, 1e-3), "sideways = the head's right, up = up")
	var tilted := Basis(Vector3.RIGHT, -1.2)  # looking down: right stays level
	t.ok(_close(Walk.fan_move(Vector3.ZERO, Vector3(0.12, 0, 0), tilted), Vector2(0.1 * Walk.FAN_DEG_PER_M, 0.0), 1e-3),
		"looking down keeps sideways sideways")


func test_fan_bases_and_values() -> void:
	var feats := {
		"a": {"pan": {"from": -270, "to": 270, "at": 0}, "tilt": {"from": 135, "to": -135, "at": 0}},
		"b": {"pan": {"from": -270, "to": 270, "at": 0}},
		"c": {"dimmer": true},
		"d": {"pan": {"from": -270, "to": 270, "at": 10}, "tilt": {"from": -135, "to": 135, "at": 0}},
	}
	var values := {"a": {"Pan": 20, "Tilt": 130.0}}
	var bases := Walk.fan_bases(["a", "b", "c", "d"], feats, values)
	t.eq(bases.map(func(b: Dictionary) -> String: return b.id), ["a", "b", "d"], "selection order; no pan / tilt: left out")
	t.eq(bases[0].Pan, [20.0, -270.0, 270.0], "programmed value, its range")
	t.eq(bases[0].Tilt, [130.0, -135.0, 135.0], "a reversed range is lo..hi")
	t.eq(bases[2].Pan[0], 10.0, "unprogrammed: the GDTF default")
	t.ok(not bases[1].has("Tilt"), "no tilt: none fanned")
	var v := Walk.fan_values(bases, Vector2(30, 20))
	t.eq(v.a, {"Pan": -10.0, "Tilt": 110.0}, "the first moves -spread")
	t.eq(v.b, {"Pan": 0.0}, "the middle stays")
	t.eq(v.d, {"Pan": 40.0, "Tilt": 20.0}, "the last moves +spread")
	t.eq(Walk.fan_values(bases, Vector2(0, -20)).a.Tilt, 135.0, "clamped to the range")
	t.eq(Walk.fan_values(bases, Vector2(30, 0), ["Pan"]).a, {"Pan": -10.0}, "only the axes the hand moved")
	t.eq(Walk.fan_values(bases, Vector2(30, 20), ["Tilt"]).has("b"), false, "nothing to write: not listed")


func test_fan_session() -> void:
	var fan: RefCounted = Fan.new()
	fan.sel = Sel.new()
	var posts: Array = []
	var aimed := [0]
	fan.sel.aimed.connect(func() -> void: aimed[0] += 1)
	fan.get_json = func(path: String) -> Dictionary:
		if path.begins_with("/api/fixtures/program/features"):
			return {"ok": true, "data": {"fixtures": {"a": {"pan": {"from": -270, "to": 270, "at": 0},
				"tilt": {"from": -135, "to": 135, "at": 0}}, "b": {"pan": {"from": -270, "to": 270, "at": 0}}}}}
		return {"ok": true, "data": {"values": {"b": {"Pan": 5}}}}
	fan.post_json = func(path: String, body: Dictionary) -> Dictionary:
		posts.append([path, body])
		return {"ok": true}
	fan.start()
	t.eq(fan.bases.size(), 0, "no selection: nothing to fan")
	fan.end()
	t.eq(aimed[0], 0, "a grip without a move announces nothing")
	fan.sel.set_ids(["a", "b"])
	fan.start()
	t.eq(fan.bases.size(), 2, "grip down: the selection's pan / tilt")
	fan.move(Vector2(10, 0))
	t.eq(posts, [["/api/fixtures/program", {"ids": ["a"], "values": {"Pan": -10.0}}],
		["/api/fixtures/program", {"ids": ["b"], "values": {"Pan": 15.0}}]], "one write each, pan only (tilt untouched)")
	posts.clear()
	fan.move(Vector2(10, 0))
	t.eq(posts.size(), 0, "the same spread is not sent again")
	fan.end()
	t.eq(aimed[0], 1, "grip up: sliders follow")
	fan.move(Vector2(40, 0))
	t.eq(posts.size(), 0, "after the release the hand moves nothing")


func test_trigger_release_never_aims() -> void:
	# WO-841: the floor aim of WO-774's release moved to the right grip (test_xr_grip_wo841.gd).
	var w: Node3D = XrWalk.new()
	var g := GDScript.new()
	g.source_code = "extends RefCounted\nvar sel = null\nvar aims: Array = []\nfunc aim(p: Array) -> void: aims.append(p)\n"
	g.reload()
	var drag: RefCounted = g.new()
	drag.sel = Sel.new()
	drag.sel.set_ids(["a"])
	var tab := Control.new()
	var tg := GDScript.new()
	tg.source_code = "extends Control\nvar fixtures3d = null\nvar aim_drag = null\n"
	tg.reload()
	tab.set_script(tg)
	tab.aim_drag = drag
	w.tab = tab
	w._press = {"from": Vector3.ZERO, "dir": Vector3(0, -1, -1), "add": false, "box": false}
	w.trigger(false, false)
	t.eq(drag.aims, [], "a press on the floor without a drag, released, with a selection: no aim")
	t.eq(w._press, {}, "and is done")
	t.eq(drag.sel.ids, ["a"], "the selection is untouched")
	tab.free()
	w.free()


func test_hooks() -> void:
	var src := FileAccess.get_file_as_string("res://features/previs/xr/xr_walk.gd")
	t.ok(src.contains("return _left != null and _left.is_button_pressed(&\"grip_click\")"), "the add modifier is the left grip")
	t.ok(src.contains("\t\telif b == \"grip_click\":\n\t\t\tgrip(true, _add_held())"), "WO-841: the right grip goes to grip() (point, or fan with the left)")
	t.ok(src.contains("rig.hit(_pointer, centre, only), rig.near(_pointer, centre, NEAR_PX, only)"),
		"a trigger on a head honours the type filter")
	t.ok(src.contains("tab.aim_drag.sel.pick(r.id, r.add)\n\t\treturn"), "a head is still picked at once on the press")
	t.ok(not src.contains("Api."), "xr_walk.gd names no autoload (the test runner compiles it)")
	var rig := FileAccess.get_file_as_string("res://features/previs/fixtures/fixtures_3d.gd")
	t.ok(rig.contains("func hit(cam: Camera3D, pos: Vector2, only_type := \"\") -> String:")
		and rig.contains("func near(cam: Camera3D, pos: Vector2, px: float, only_type := \"\") -> String:")
		and rig.contains("func heads() -> Dictionary:"), "fixtures_3d.gd: type-filtered picks and the heads a box sees")
	var panel := FileAccess.get_file_as_string("res://features/previs/xr/xr_panel.gd")
	t.ok(panel.contains("types = TypeRow.new()\n\tbox.add_child(types)\n\tprogrammer = Programmer.new()"),
		"the type filter sits above the Programmer on the VR panel")
	var help := FileAccess.get_file_as_string("res://help/vr-walk.md")
	t.ok(help.contains("Right grip") and help.contains("box"), "help/vr-walk.md names the box and the fan")
