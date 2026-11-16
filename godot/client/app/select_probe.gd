extends Node
## dev: --probe-select=<png prefix> (with --tab=Previs) — WO-1100: deselect on glass through the running client. Per
## kind (a stage object, a fixture, an LED wall, a Layers row) it selects, then clears with Esc, selects again, then
## clears with a click on empty space; clicks and Esc go in as real window input (Viewport.push_input: the GUI, the
## 4 px click rule, focus), the pointer is not touched. Saves the window per step: <prefix>_<kind>_<sel|esc|empty>.png
## and prints "[client] select probe:" lines with what is selected after each step. Selection only: nothing is moved.

const Rule := preload("res://features/previs/move/select_rule.gd")

var prefix := ""
var tab: Node


func _ready() -> void:
	prefix = str(Config.args["probe-select"])
	await get_tree().create_timer(20.0).timeout
	tab = get_tree().root.find_child("Previs", true, false)
	if tab == null or tab.get("stage") == null:
		print("[client] select probe: no Previs tab")
		return
	tab.stage.fly_to_preset("Front", tab._view_pose("Front"))
	await _frames(60)
	var empty: Variant = _empty_spot()
	print("[client] select probe: empty spot in Front %s" % [empty])
	for kind in ["stage", "fixture", "venue part", "layer"]:
		for how in ["esc", "empty"]:
			var ok := await _select(kind)
			await _frames(10)
			_note(kind, "selected (%s)" % ok)
			_shot(kind, "sel")
			if how == "esc":
				_key(KEY_ESCAPE)
			else:
				var keep := [tab.stage._yaw, tab.stage._pitch, tab.stage._dist]
				tab.stage._dist *= 6.0  # out of the room: empty space around it
				tab.stage._update_camera()
				await _frames(4)
				var at: Variant = _empty_spot()
				_note(kind, "empty spot from afar %s" % [at])
				_shot(kind, "far")
				if at != null:
					await _click(at)
				await _frames(4)
				tab.stage._yaw = keep[0]
				tab.stage._pitch = keep[1]
				tab.stage._dist = keep[2]
				tab.stage._update_camera()
			await _frames(10)
			_note(kind, "after " + how)
			_shot(kind, how)
	_key(KEY_ESCAPE)
	print("[client] select probe done")


func _state() -> String:
	var m: RefCounted = tab.mover
	return "heads %s · stage '%s' · mvr %d · card %s · nudge target '%s'" % [m.sel.ids, m.stage_panel.selected_id(),
		(m.mvr_section.selected_uuids() as Array).size(), "shown" if tab._position.fold != null and tab._position.fold.is_visible_in_tree() else "hidden",
		m.active()]


func _note(kind: String, what: String) -> void:
	print("[client] select probe: %s %s → %s" % [kind, what, _state()])


func _shot(kind: String, step: String) -> void:
	get_viewport().get_texture().get_image().save_png("%s_%s_%s.png" % [prefix, kind, step])


func _frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame


## A screen point (SubViewport px) of `kind`'s first object, clicked like the operator would; a layer via its row.
func _select(kind: String) -> bool:
	var cam: Camera3D = tab.stage.camera()
	var at: Variant = null
	match kind:
		"stage":
			if tab.builder.objects.is_empty():
				return false
			at = _centre(cam, tab.builder._nodes[str(tab.builder.objects[0].id)])
		"fixture":
			for id in tab.fixtures3d._fx:
				var f: Dictionary = tab.fixtures3d._fx[id]
				at = _on(cam, (f.root as Node3D).global_transform * (f.box as AABB).get_center())
				if at != null:
					break
		"venue part":  # a click on the carpet / a wall of the room: a pickable MVR object (WO-1003)
			at = _spot(func(p: Vector2) -> bool: return tab.fixtures3d.hit(cam, p) == "" and tab.builder.pick(cam, p) == "" \
				and tab.mvr.pick(cam, p) != "")
		"layer":
			for l in tab.mvr.layers:
				tab.mvr_section._colors.row_clicked.emit(str(l), false)
				if not (tab.mvr_section.selected_uuids() as Array).is_empty():
					_note(kind, "row '%s'" % l)
					return true
			return false
	if at == null:
		return false
	await _click(at)
	return true


func _centre(cam: Camera3D, n: Node) -> Variant:
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var b: AABB = (mi as MeshInstance3D).global_transform * (mi as MeshInstance3D).get_aabb()
		box = b if first else box.merge(b)
		first = false
	return null if first else _on(cam, box.get_center())


func _on(cam: Camera3D, p: Vector3) -> Variant:
	if cam.is_position_behind(p):
		return null
	var s := cam.unproject_position(p)
	return s if Rect2(Vector2.ZERO, Vector2(tab._sv.size)).has_point(s) else null


## A SubViewport point where nothing pickable is (no head, stage object or MVR object), or null.
func _empty_spot() -> Variant:
	var cam: Camera3D = tab.stage.camera()
	return _spot(func(p: Vector2) -> bool: return tab.fixtures3d.hit(cam, p) == "" and tab.builder.pick(cam, p) == "" \
		and tab.mvr.pick(cam, p) == "")


## The first point of a 48 px grid (from the lower middle, where the floor is) that `ok` accepts, or null.
func _spot(ok: Callable) -> Variant:
	var sz := Vector2(tab._sv.size)
	for y in range(int(sz.y) - 24, 0, -48):
		for x in range(24, int(sz.x), 48):
			if ok.call(Vector2(x, y)):
				return Vector2(x, y)
	return null


func _click(at: Vector2) -> void:
	var svc: Control = tab._svc
	var win := svc.get_global_rect().position + at * (svc.size / Vector2(tab._sv.size))
	for down in [true, false]:
		var e := InputEventMouseButton.new()
		e.button_index = MOUSE_BUTTON_LEFT
		e.pressed = down
		e.position = win
		e.global_position = win
		get_viewport().push_input(e)
		await _frames(2)


func _key(k: Key) -> void:
	for down in [true, false]:
		var e := InputEventKey.new()
		e.keycode = k
		e.pressed = down
		get_viewport().push_input(e)
