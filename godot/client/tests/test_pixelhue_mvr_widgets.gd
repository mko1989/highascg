extends RefCounted
## WO-1039 MVR — the input side of the MVR widgets (no clicks possible here, so their handlers are fed events):
## canvas select / move / corner resize / cancel / keys / drop acceptance, inspector field commits, the Add to MVR list.

const MvrCanvas := preload("res://features/pixelhue/mvr_canvas.gd")
const MvrInspector := preload("res://features/pixelhue/mvr_inspector.gd")
const MvrSide := preload("res://features/pixelhue/mvr_side.gd")
var t


func _wins() -> Array:
	return [{"id": 1, "name": "A", "source": "Input 1", "sourceType": 2, "umdHeight": 24, "window": {"x": 0, "y": 0, "width": 400, "height": 300}},
		{"id": 2, "name": "B", "source": "Screen 1", "sourceType": 3, "umdHeight": 24, "window": {"x": 960, "y": 540, "width": 400, "height": 300}}]


func _click(c: Control, p: Vector2, pressed := true, button := MOUSE_BUTTON_LEFT) -> void:
	var e := InputEventMouseButton.new()
	e.button_index = button
	e.pressed = pressed
	e.position = p
	c._gui_input(e)


func _move(c: Control, p: Vector2) -> void:
	var e := InputEventMouseMotion.new()
	e.position = p
	c._gui_input(e)


func _key(c: Control, k: Key, shift := false, ctrl := false) -> void:
	var e := InputEventKey.new()
	e.keycode = k
	e.pressed = true
	e.shift_pressed = shift
	e.ctrl_pressed = ctrl
	c._gui_input(e)


func test_canvas_select_move_resize_cancel() -> void:
	var c: Control = MvrCanvas.new()
	t.root.add_child(c)
	await t.process_frame
	c.size = Vector2(976, 556)  # frame = 960 × 540 at (8, 8): half scale
	c.show_layout({"width": 1920, "height": 1080}, _wins(), 1, false)
	var got: Array = []
	c.drag_started.connect(func(id: int, h: String) -> void: got.append(["start", id, h]))
	c.drag_moved.connect(func(dx: float, dy: float) -> void: got.append(["move", dx, dy]))
	c.drag_ended.connect(func(x: bool) -> void: got.append(["end", x]))
	c.nudged.connect(func(d: Vector2i, s: bool) -> void: got.append(["nudge", d, s]))
	c.undo_requested.connect(func(r: bool) -> void: got.append(["undo", r]))
	_click(c, Vector2(8 + 480 + 50, 8 + 270 + 50))  # inside window 2
	_move(c, Vector2(8 + 480 + 60, 8 + 270 + 45))
	_click(c, Vector2(8 + 480 + 60, 8 + 270 + 45), false)
	t.eq(got, [["start", 2, ""], ["move", 20.0, -10.0], ["end", false]], "click window 2, move 10 / -5 control px = 20 / -10 output px")
	got.clear()
	_click(c, Vector2(8 + 200, 8 + 150))  # the selected window's se corner
	t.eq(got, [["start", 1, "se"]], "corner of the selected window resizes")
	_click(c, Vector2(8 + 200, 8 + 150), true, MOUSE_BUTTON_RIGHT)
	t.eq(got.back(), ["end", true], "right click cancels")
	got.clear()
	_click(c, Vector2(8 + 480 + 199, 8 + 270 + 149))  # window 2's corner, but 2 is not selected: a move
	t.eq(got, [["start", 2, ""]], "handles only on the selected window")
	_key(c, KEY_ESCAPE)
	t.eq(got.back(), ["end", true], "Esc cancels a drag")
	got.clear()
	_click(c, Vector2(900, 30))
	t.eq(got, [], "empty space does nothing")
	_key(c, KEY_LEFT, true)
	_key(c, KEY_Z, false, true)
	_key(c, KEY_Z, true, true)
	t.eq(got, [["nudge", Vector2i(-1, 0), true], ["undo", false], ["undo", true]], "keys")
	t.ok(c._can_drop_data(Vector2.ZERO, {"mvr_source": "2:40"}), "accepts a source")
	t.ok(not c._can_drop_data(Vector2.ZERO, {"other": 1}), "nothing else")
	var drops: Array = []
	c.source_dropped.connect(func(k: String, id: int, at: Vector2) -> void: drops.append([k, id, at]))
	c._drop_data(Vector2(8 + 100, 8 + 400), {"mvr_source": "2:40"})
	c._drop_data(Vector2(8 + 50, 8 + 50), {"mvr_source": "2:40"})
	t.eq(drops, [["2:40", -1, Vector2(200, 800)], ["2:40", 1, Vector2(100, 100)]], "drop point in output pixels, window under it")
	c.show_layout({"width": 1920, "height": 1080}, _wins(), 1, true)
	got.clear()
	_click(c, Vector2(8 + 50, 8 + 50))
	t.eq(got, [], "busy: no editing")
	t.ok(not c._can_drop_data(Vector2.ZERO, {"mvr_source": "2:40"}), "busy: no drops")
	t.root.remove_child(c)
	c.free()


func test_inspector_commits_only_changes() -> void:
	var i: Control = MvrInspector.new()
	t.root.add_child(i)
	await t.process_frame
	var got: Array = []
	i.field_committed.connect(func(k: String, v: String) -> void: got.append([k, v]))
	var layer := {"id": 5, "name": "A", "source": "Input 1", "sourceType": 2, "window": {"x": 10, "y": 20, "width": 400, "height": 249}, "aspectLock": 1.5}
	i.show_layer(layer, "UMD 24 px", {"items": [["Input 1", "2:25"]], "index": 0}, false)
	var x: LineEdit = i._fields.x
	t.eq(x.text, "10", "shows X")
	t.ok(i._aspect.button_pressed, "lock shown")
	x.text_submitted.emit(x.text)
	t.eq(got, [], "unchanged: no commit")
	x.text = "100+20"
	x.text_submitted.emit(x.text)
	t.eq(got, [["x", "120"]], "maths resolved before the commit")
	i.show_layer({}, "", {}, false)
	t.ok(not i._box.visible and i._empty.visible, "nothing selected")
	t.root.remove_child(i)
	i.free()


func test_side_lists() -> void:
	var s: Control = MvrSide.new()
	t.root.add_child(s)
	await t.process_frame
	var got: Array = []
	s.window_picked.connect(func(id: int) -> void: got.append(["pick", id]))
	s.source_added.connect(func(k: String) -> void: got.append(["add", k]))
	s.show_windows(_wins(), 1, [2], false)
	var rows: Array = s._list.get_children()
	t.eq(rows.size(), 2, "one row per window")
	t.ok((rows[1] as Button).text.ends_with("•"), "unsaved marker")
	(rows[1] as Button).pressed.emit()
	s.show_sources([{"type": 2, "id": 40, "name": "Input 6", "width": null, "height": null, "usedBy": null},
		{"type": 3, "id": 1, "name": "Screen 1 PGM", "width": 3072, "height": 1024, "usedBy": 9}], false)
	var src: Array = s._sources.get_children()
	t.eq((src[0] as Button).text, "Input 6  ·  No signal", "label")
	var dbl := InputEventMouseButton.new()
	dbl.button_index = MOUSE_BUTTON_LEFT
	dbl.pressed = true
	dbl.double_click = true
	(src[0] as Button).gui_input.emit(dbl)
	(src[1] as Button).pressed.emit()
	t.eq(got, [["pick", 2], ["add", "2:40"], ["pick", 9]], "row picks, double-click adds, a used source selects its window")
	s.show_screens([{"id": 7, "name": "MVR "}], 7, false)
	t.eq(s._screens.get_item_text(0), "MVR ", "output menu")
	t.root.remove_child(s)
	s.free()
