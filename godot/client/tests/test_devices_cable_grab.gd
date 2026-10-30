extends RefCounted
## Owner 30.10 — grab a rear-panel cable by its body and play with it (both ends stay plugged), but a press near a port
## dot is the end (select / re-plug). cable_grab.gd decides; cable_rope.gd holds the point and follows.

const Grab := preload("res://features/devices/cable_grab.gd")
const Rope := preload("res://features/devices/cable_rope.gd")
var t

const A := Vector2(100, 100)
const B := Vector2(500, 100)


func _scene() -> Dictionary:
	var r := Rope.make(A, B, 0, 7)
	for s in 1500:
		if r.asleep():
			break
		r.step()
	var po: Array = r.points_owned()
	return {"rope": r, "shapes": {"e1": po[0]}, "owners": {"e1": po[1]}, "ends": {"e1": [A, B]}}


func test_body_press_picks_the_rope_point_under_the_pointer() -> void:
	var sc := _scene()
	var pts: PackedVector2Array = sc.shapes.e1
	var mid := pts[pts.size() / 2]
	var p := Grab.pick(sc.shapes, sc.owners, sc.ends, mid + Vector2(2, 1))
	t.eq(p.get("id"), "e1", "the cable under the pointer")
	t.eq(p.get("kind"), "body", "far from both port dots = the body")
	t.ok(absi(int(p.idx) - pts.size() / 2) <= 1, "holds the rope point nearest the press (%d)" % p.idx)
	t.ok(p.idx >= 2 and p.idx <= sc.rope.x.size() - 3, "a free point, never a plug or boot")


func test_press_off_the_cable_picks_nothing() -> void:
	var sc := _scene()
	var pts: PackedVector2Array = sc.shapes.e1
	var mid := pts[pts.size() / 2]
	t.eq(Grab.pick(sc.shapes, sc.owners, sc.ends, mid + Vector2(0, -(Grab.BODY_PX + 5.0))), {}, "just outside the reach")
	t.eq(Grab.pick(sc.shapes, sc.owners, sc.ends, Vector2(-300, 900)), {}, "empty canvas")
	t.eq(Grab.pick({}, {}, {}, Vector2.ZERO), {}, "no cables at all")


func test_press_near_a_port_dot_is_the_end() -> void:
	var sc := _scene()
	var pts: PackedVector2Array = sc.shapes.e1
	var near_a: Vector2 = pts[1] + Vector2(1, 0)  # on the source boot, 16 px under its dot
	var p := Grab.pick(sc.shapes, sc.owners, sc.ends, near_a)
	t.eq(p.get("kind"), "end", "the boot under the source dot")
	t.eq(p.get("end"), "source", "the source end")
	var q := Grab.pick(sc.shapes, sc.owners, sc.ends, pts[pts.size() - 2])
	t.eq(q.get("kind"), "end", "the boot over the sink dot")
	t.eq(q.get("end"), "sink", "the sink end")


func test_end_radius_edge() -> void:
	var shapes := {"c": PackedVector2Array([Vector2(0, 0), Vector2(400, 0)])}
	var ends := {"c": [Vector2(0, 0), Vector2(400, 0)]}
	t.eq(Grab.pick(shapes, {}, ends, Vector2(Grab.END_PX - 1.0, 0)).kind, "end", "just inside END_PX")
	t.eq(Grab.pick(shapes, {}, ends, Vector2(Grab.END_PX + 1.0, 0)).kind, "body", "just outside END_PX")
	t.eq(Grab.pick(shapes, {}, ends, Vector2(400 - Grab.END_PX - 1.0, 0)).kind, "body", "same at the far end")
	t.eq(Grab.pick(shapes, {}, ends, Vector2(200, 0)).idx, -1, "no owners given = nothing to hold")


func test_nearest_cable_wins_and_hidden_is_skipped() -> void:
	var shapes := {
		"hi": PackedVector2Array([Vector2(0, 100), Vector2(400, 100)]),
		"lo": PackedVector2Array([Vector2(0, 104), Vector2(400, 104)])}
	var ends := {"hi": [Vector2(0, 100), Vector2(400, 100)], "lo": [Vector2(0, 104), Vector2(400, 104)]}
	t.eq(Grab.pick(shapes, {}, ends, Vector2(200, 103)).id, "lo", "the closer of two crossing cables")
	t.eq(Grab.pick(shapes, {}, ends, Vector2(200, 103), "lo").id, "hi", "a held-out (re-grabbed) cable is skipped")


func test_loop_points_belong_to_the_rope_point_they_hang_from() -> void:
	var r := Rope.make(Vector2(100, 100), Vector2(600, 120), 2, 11)
	for s in 1500:
		if r.asleep():
			break
		r.step()
	var po: Array = r.points_owned()
	t.eq(po[0].size(), po[1].size(), "one owner per drawn point")
	t.eq(po[0], r.points(), "points_owned draws the same cable as points()")
	var c: Dictionary = r.coils[0]
	t.ok(po[1].count(c.i) > Rope.LOOP_STEPS, "the loop's points are owned by its attach point %d" % c.i)


func test_dragging_the_body_moves_the_rope_but_not_the_plugs() -> void:
	var sc := _scene()
	var r: RefCounted = sc.rope
	var mid: int = r.x.size() / 2
	var from := Vector2(r.x[mid], r.y[mid])
	r.grab(mid, from)
	var to := from + Vector2(10, -30)
	r.drag(to)
	for i in 30:
		r.step()
	t.ok(r.grabbed(), "held")
	t.ok(not r.asleep(), "a held rope never sleeps")
	t.ok(Vector2(r.x[mid], r.y[mid]).distance_to(to) < 1.0, "the held point sits on the pointer")
	t.eq(Vector2(r.x[0], r.y[0]), A, "source still plugged")
	t.eq(Vector2(r.x[r.x.size() - 1], r.y[r.y.size() - 1]), B, "sink still plugged")
	var lift: float = from.y - r.y[mid - 6]
	t.ok(lift > 3.0, "the rope rises with the point (%.1f px)" % lift)


func test_release_swings_back_and_sleeps() -> void:
	var sc := _scene()
	var r: RefCounted = sc.rope
	var mid: int = r.x.size() / 2
	var rest := Vector2(r.x[mid], r.y[mid])
	r.grab(mid, rest)
	r.drag(rest + Vector2(0, -120))
	for i in 20:
		r.step()
	r.release()
	t.ok(not r.grabbed(), "released")
	var steps := 0
	while not r.asleep() and steps < 3000:
		r.step()
		steps += 1
	t.ok(r.asleep(), "settles again (%d steps)" % steps)
	t.ok(Vector2(r.x[mid], r.y[mid]).distance_to(rest) < 12.0, "and hangs where it did (%.1f px off)" % Vector2(r.x[mid], r.y[mid]).distance_to(rest))


func test_pointer_cannot_stretch_the_cable_past_its_length() -> void:
	var sc := _scene()
	var r: RefCounted = sc.rope
	var mid: int = r.x.size() / 2
	r.grab(mid, Vector2(r.x[mid], r.y[mid]))
	r.drag(Vector2(300, 5000))  # far below: the cable is only so long
	for i in 60:
		r.step()
	var reach := Vector2(r.x[mid], r.y[mid])
	t.ok(reach.y < 100.0 + (B.x - A.x) * 0.9, "held point stays within the cable's length (y=%.0f)" % reach.y)
	t.eq(Vector2(r.x[0], r.y[0]), A, "plug unmoved")
	var longest := 0.0
	for i in range(r.x.size() - 1):
		longest = maxf(longest, Vector2(r.x[i + 1] - r.x[i], r.y[i + 1] - r.y[i]).length())
	t.ok(longest < 60.0, "no segment stretched into a spike (longest %.1f px)" % longest)


# --- pulling a plug (cable_layer.gd _plug_input → cable_gesture.gd pull / unplug_drop) ---

const Layer := preload("res://features/devices/cable_layer.gd")
const Rules := preload("res://features/devices/cable_rules.gd")


func _motion(at: Vector2, held := true) -> InputEventMouseMotion:
	var m := InputEventMouseMotion.new()
	m.global_position = at
	m.button_mask = MOUSE_BUTTON_MASK_LEFT if held else 0
	return m


func _up(at: Vector2) -> InputEventMouseButton:
	var b := InputEventMouseButton.new()
	b.button_index = MOUSE_BUTTON_LEFT
	b.pressed = false
	b.global_position = at
	return b


func _layer(sel: bool, port := "") -> Dictionary:
	var l: Control = Layer.new()
	var got := {"unplug": [], "drop": [], "port": []}
	l.port_clicked.connect(func(pt: String) -> void: got.port.append(pt))
	l.unplug.connect(func(id: String, key: String) -> void: got.unplug.append([id, key]))
	l.unplug_drop.connect(func(key: String) -> void: got.drop.append(key))
	l._plug = {"id": "e1", "key": "dest1", "at": A, "sel": sel, "pulled": false, "port": port}
	return {"l": l, "got": got}


func test_pulling_a_plug_unplugs_once_and_reports_the_drop() -> void:
	var s := _layer(false)
	s.l._plug_input(_motion(A + Vector2(Layer.UNPLUG_PX - 1, 0)))
	t.eq(s.got.unplug, [], "a jitter inside UNPLUG_PX is still a click")
	s.l._plug_input(_motion(A + Vector2(40, 30)))
	s.l._plug_input(_motion(A + Vector2(80, 60)))
	t.eq(s.got.unplug, [["e1", "dest1"]], "past UNPLUG_PX the plug comes out, once")
	t.ok(s.l.dragging(), "held until the button comes up")
	s.l._plug_input(_up(Vector2(-500, -500)))
	t.eq(s.got.drop, [""], "let go over no connector → drop with no key")
	t.ok(not s.l.dragging(), "released")
	s.l.free()


func test_a_click_on_a_plug_only_lifts_the_selected_cable() -> void:
	var s := _layer(false)
	s.l._plug_input(_up(A))
	t.eq([s.got.unplug, s.got.drop], [[], []], "unselected cable: a click just selects (the tab did that on press)")
	s.l.free()
	s = _layer(true)
	s.l._plug_input(_up(A))
	t.eq(s.got.unplug, [["e1", "dest1"]], "selected cable: a click lifts its end (WO-278 click-to-move)")
	t.eq(s.got.drop, [], "…and waits for the click on the new port")
	s.l.free()
	s = _layer(true, "gpu_p1")
	s.l._plug_input(_up(A))
	t.eq([s.got.port, s.got.unplug], [["gpu_p1"], []], "a plug in a rear-panel socket: a click is the socket's (port page)")
	s.l.free()
	s = _layer(false, "gpu_p1")
	s.l._plug_input(_motion(A + Vector2(30, 30)))
	s.l._plug_input(_up(A + Vector2(30, 30)))
	t.eq([s.got.port, s.got.unplug, s.got.drop], [[], [["e1", "dest1"]], [""]], "…but pulled, it unplugs")
	s.l.free()


func test_unplug_drop_resolves_move_restore_or_remove() -> void:
	var grab := {"edgeId": "e1", "anchorId": "src1", "movingId": "dest1"}
	t.eq(Rules.unplug_outcome({}, "", ""), "none", "no end held → nothing")
	t.eq(Rules.unplug_outcome(grab, "src1", "src1#pgm"), "restore", "back on its own anchor → as it was")
	t.eq(Rules.unplug_outcome(grab, "src1", "dest2"), "move", "another connector → moved there (plan_regrab decides)")
	t.eq(Rules.unplug_outcome(grab, "src1", "dest1"), "move", "its own port → plan_regrab restores it (unchanged)")
	t.eq(Rules.unplug_outcome(grab, "src1", ""), "remove", "empty space → the cable comes out")
