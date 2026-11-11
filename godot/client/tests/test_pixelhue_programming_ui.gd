extends RefCounted
## WO-1039 — the Programming widgets without the network: programming_stage.gd driven with synthetic presses / moves
## (select, move with snapping, locked resize, cancel sends the original back, locked PGM is select-only, drops,
## nudge / clear keys), and the tools / inspector / sources / effects widgets built against the P20 fixture with a
## fake host that records what they would send.

const Stage := preload("res://features/pixelhue/programming_stage.gd")
const Tools := preload("res://features/pixelhue/programming_tools.gd")
const Inspector := preload("res://features/pixelhue/programming_inspector.gd")
const Sources := preload("res://features/pixelhue/programming_sources.gd")
const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")
const T := preload("res://tests/test_pixelhue_programming.gd")
var t


class FakeHost:
	extends RefCounted
	var sent: Array = []
	var live: Array = []
	var notices: Array = []
	var cleared: Array = []

	func command(body: Dictionary, message := "") -> void:
		sent.append([body, message])

	func live_geometry(change: Dictionary) -> void:
		live.append(change)

	func finish_geometry() -> void:
		pass

	func notice(text: String) -> void:
		notices.append(text)

	func clear_layer(l: Dictionary) -> void:
		cleared.append(l.get("id"))

	func render_inspector() -> void:
		pass

	func select(_id: int) -> void:
		pass

	func active_screen_id() -> Variant:
		return 1

	func active_screen() -> Dictionary:
		return {"id": 1, "name": "Screen 1"}

	func thumb(_id: int, _cb: Callable) -> void:
		pass

	func load_gallery() -> void:
		pass


## A 1000 × 500 screen in a 1400 × 700 canvas, shown at scale 0.5 → 700 × 350 control.
func _stage(locked := false) -> Array:
	var scr := {"id": 1, "name": "S", "width": 1000, "height": 500, "x": 0, "y": 0}
	var layers := [{"id": 10, "screenId": 1, "scene": 4, "name": "Layer 1", "window": G.win(100, 100, 400, 200), "zorder": 1, "aspectLocked": false},
		{"id": 11, "screenId": 1, "scene": 4, "name": "Layer 2", "window": G.win(600, 100, 200, 100), "zorder": 2, "aspectLocked": true}]
	var st := Stage.new()
	st.size = Vector2(700, 350)
	st.setup(scr, 4, layers, null, locked, true)
	var log := {"select": [], "preview": [], "commit": [], "drop": [], "locked": 0, "nudge": [], "clear": 0}
	st.select_layer.connect(func(id: int) -> void: log.select.append(id))
	st.preview.connect(func(_l: Dictionary, w: Dictionary, g: bool) -> void: log.preview.append([w, g]))
	st.commit.connect(func(_l: Dictionary, w: Dictionary, g: bool) -> void: log.commit.append([w, g]))
	st.dropped.connect(func(k: String, p: Dictionary, l: Dictionary) -> void: log.drop.append([k, p, l.get("id")]))
	st.locked_hit.connect(func() -> void: log.locked += 1)
	st.nudge.connect(func(dx: int, dy: int, s: int) -> void: log.nudge.append([dx, dy, s]))
	st.clear_pressed.connect(func() -> void: log.clear += 1)
	return [st, layers, log]


func _pt(st: Stage, x: float, y: float) -> Vector2:
	return G.to_view(G.win(x, y, 1, 1), st.view()).position


func test_stage_move_streams_and_commits() -> void:
	var a := _stage()
	var st: Stage = a[0]
	var log: Dictionary = a[2]
	st.press(_pt(st, 200, 150))
	t.eq(log.select, [10], "press selects")
	t.ok(st.dragging(), "drag started")
	st.move(_pt(st, 253, 150))
	t.eq(log.preview.size(), 1, "live preview")
	t.eq(log.preview[0][0], G.win(153, 100, 400, 200), "moved 53 px")
	st.move(_pt(st, 253, 150))
	t.eq(log.preview.size(), 1, "no duplicate preview for the same position")
	st.move(_pt(st, 296, 150))
	t.eq(log.preview[1][0].x, 200, "right edge snapped to the other layer's left (600)")
	st.move(_pt(st, 296, 150), true)
	t.eq(a[1][0].window.x, 196, "Alt places freely")
	st.finish(false)
	t.eq(log.commit, [[G.win(196, 100, 400, 200), false]], "release commits the final window")
	t.ok(not st.dragging(), "drag over")
	st.free()


func test_stage_cancel_sends_original_back() -> void:
	var a := _stage()
	var st: Stage = a[0]
	var log: Dictionary = a[2]
	st.press(_pt(st, 200, 150))
	st.move(_pt(st, 230, 170))
	st.finish(true)
	t.eq(a[1][0].window, G.win(100, 100, 400, 200), "original restored locally")
	t.eq(log.commit, [[G.win(100, 100, 400, 200), false]], "original sent as the final position")
	st.press(_pt(st, 200, 150))
	st.finish(true)
	t.eq(log.commit.size(), 1, "a cancel that streamed nothing sends nothing")
	st.free()


func test_stage_locked_resize_and_handles() -> void:
	var a := _stage()
	var st: Stage = a[0]
	var log: Dictionary = a[2]
	st.press(_pt(st, 700, 150))
	st.finish(false)
	t.eq(st.selected_id, 11, "selected the locked-aspect layer")
	var se := G.corner(G.to_view(a[1][1].window, st.view()), "se")
	st.press(se)
	st.move(se + Vector2(20, 0), true)
	st.finish(false)
	t.eq(log.commit[0][0], G.win(600, 100, 240, 120), "corner resize keeps the 2:1 ratio")
	st.free()


func test_stage_locked_pgm_is_select_only() -> void:
	var a := _stage(true)
	var st: Stage = a[0]
	var log: Dictionary = a[2]
	st.press(_pt(st, 200, 150))
	t.eq(log.select, [10], "selects")
	t.ok(not st.dragging(), "but does not drag")
	st.drop_at(_pt(st, 0, 0), "2:25")
	t.eq(log.locked, 1, "drop on a locked PGM is refused")
	t.eq(log.drop, [], "nothing dropped")
	st.free()


func test_stage_drops() -> void:
	var a := _stage()
	var st: Stage = a[0]
	var log: Dictionary = a[2]
	st.drop_at(_pt(st, -100, 50), "2:25")
	t.eq(log.drop[0][0], "2:25", "key")
	t.ok(absf(float(log.drop[0][1].x) + 100.0) < 0.5 and absf(float(log.drop[0][1].y) - 50.0) < 0.5, "screen-local point, off-screen allowed")
	t.eq(log.drop[0][2], null, "empty space")
	st.drop_at(_pt(st, 650, 120), "2:4")
	t.eq(log.drop[1][2], 11, "onto a layer: replace")
	st.drop_at(_pt(st, 650, 120), "2:4", true)
	t.eq(log.drop[2][2], null, "Shift adds instead")
	t.ok(st._can_drop_data(Vector2(5, 5), {M.DRAG_KEY: "2:25"}), "accepts source drags")
	t.ok(not st._can_drop_data(Vector2(5, 5), {"other": 1}), "ignores other drags")
	st.free()


func test_stage_keys() -> void:
	var a := _stage()
	var st: Stage = a[0]
	var log: Dictionary = a[2]
	st.selected_id = 10
	var k := InputEventKey.new()
	k.keycode = KEY_LEFT
	k.pressed = true
	k.shift_pressed = true
	st._gui_input(k)
	t.eq(log.nudge, [[-1, 0, 10]], "Shift+Left nudges 10 px")
	var d := InputEventKey.new()
	d.keycode = KEY_DELETE
	d.pressed = true
	st._gui_input(d)
	t.eq(log.clear, 1, "Delete asks to clear")
	st.free()


func test_tools_send_bodies() -> void:
	var s := T.state()
	var host := FakeHost.new()
	var tools := Tools.new()
	tools.host = host
	var l := M.layer_by_id(s, 101)
	tools.render(s, l, false)
	t.eq(tools.layer_id(), 101, "renders the selected layer")
	tools._typed("x", "250")
	t.eq(host.live[0], {"action": "group-window", "screenId": 1, "id": 101, "window": G.win(250, 0, 2000, 500)}, "typing streams the group's window")
	tools._typed("x", "25+")
	t.eq(host.live.size(), 1, "half-typed expressions are not sent")
	tools._save(G.align_window(G.target_window(s.layers, l), M.screen_by_id(s, 1), "right"), "Layer aligned right.")
	t.eq(host.sent[0][1], "Group aligned right.", "group wording")
	t.eq(host.sent[0][0].window.x, 1072, "aligned right")
	tools.render(s, {}, false)
	t.eq(tools.get_child_count(), 1, "no selection: a hint only")
	tools.free()


func test_inspector_and_sources_build() -> void:
	var s := T.state()
	s.effects = {"opacity": true, "flip": true}
	s.layerPresets = {"supported": true, "colors": ["#257cff"], "parts": [["pos", "Position"]], "list": [{"id": 1, "name": "P", "color": "#257cff", "parts": ["pos"]}]}
	s.presets = []
	var l: Dictionary = M.layer_by_id(s, 100)
	l.fx = {"opacity": 80, "flipH": false, "flipV": false, "mono": false, "inverse": false, "locked": false}
	l.keyFrame = {"enable": 1, "speedType": 3, "startTime": 0, "animationTime": 1000}
	var host := FakeHost.new()
	var insp := Inspector.new()
	insp.host = host
	insp.render(s, l, M.screen_by_id(s, 1), 100)
	t.ok(insp.find_children("*", "OptionButton", true, false).size() >= 2, "source + curve menus")
	insp.tab = "presets"
	insp.render(s, l, M.screen_by_id(s, 1), 100)
	t.ok(insp.presets.get_parent() != null, "presets tab shows the bank")
	insp.free()
	var src := Sources.new()
	src.host = host
	src.render(s, {})
	t.eq(src._list.get_child_count(), 3, "three inputs")
	src._filter.text = "hdmi"
	src._fill()
	t.eq(src._list.get_child_count(), 2, "filtered")
	src.tab = "groups"
	src.render(s, {})
	t.ok(src._list.get_child_count() >= 3, "two group rows + the new-group form")
	src.free()
