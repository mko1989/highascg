extends Node
## WO-616 T5b — operator marker driver. The project's markers (tracking_model `markers`) are driven from this
## client and written to the server hub (WS `tracking:marker`, WO-616 T5a) — the hub feeds every client's previs
## and the WO-615 follow → Art-Net engine.
##   gamepad left stick / arrow keys (Markers mode, view focused): move the selected marker, camera-relative
##     (directions latched when the input leaves zero — nothing bends a move in progress), at `speed` m/s;
##     LB / RB speed − / +, D-pad ◀ ▶ previous / next marker (OpenFollow's default bindings);
##   mouse: grab a marker's ground circle and drag — it glides to the floor point under the pointer.
## Sends ≤ 30 Hz while moving; every 250 ms re-sends parked markers (the hub calls a marker stale 1 s after its
## last write; identical writes do not broadcast), except one another client is moving right now. The marker list
## comes from the project directly, so markers stay live whatever tab / previs mode the operator is in.
## T11: also keeps the server follow engine's aims (`tracking:follow`) for the beams and the Follow section.

const MI := preload("res://features/previs/tracking/marker_input.gd")
const O := preload("res://features/previs/tracking/tracking_overlay.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")

const SEND_MS := 33
const HEARTBEAT_MS := 250
const QUIET_MS := 400  # a broadcast changed it this recently and we did not → someone else is driving it
const GRAB_RADIUS_PX := 24.0
const RING_M := 0.4
const BODY_M := 1.7  # drawn person height above the marker
const SMOOTHING := 0.6

signal updated  # positions / selection / speed changed → redraw, refresh the Inspector

var defs: Array = []  # [{id, name, color}] — this client's markers (project)
var positions := {}  # id → {x, y, z, stale, name}  (server state, our moves applied at once)
var selected := 0
var speed := MI.SPEED_DEFAULT
var curve := "linear"
var driving := false  # Markers mode on screen: read stick and arrows
var entry := {}  # the tracking camera: control frame + floor picks
var key_focus: Control  # arrows count only while this (the camera view) or nothing has focus
var floor_z := 0.0
var home := Vector2.ZERO
var grabbed := 0
var synced := false  # the hub answered (module on) — no heartbeats into a missing module
var follow := {}  # fixture id → {state, pan, tilt, problem} (server follow engine, WO-616 T11)
var follow_on := false  # the server's Art-Net output master
var _target: Variant = null
var _axes: Array = []
var _dirty := {}
var _mine := {}  # id → msec we last moved it
var _seen := {}  # id → msec a broadcast last changed it
var _last_send := 0
var _last_beat := 0
var _pad := {}  # previous button states (edges)


func _ready() -> void:
	Ws.message.connect(_on_ws)
	Ws.connected.connect(resync)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _from_project())
	_from_project()
	resync()


func _from_project() -> void:
	var pv: Variant = Store.project.get("previs")
	var t := T.normalize((pv as Dictionary).get("tracking") if pv is Dictionary else null)
	set_defs(t.markers, t.grid)


func resync() -> void:
	var res: Dictionary = await Api.get_json("/api/tracking/markers")
	if res.ok and res.data is Dictionary:
		_adopt((res.data as Dictionary).get("markers", []))
	var fr: Dictionary = await Api.get_json("/api/tracking/follow")
	if fr.ok and fr.data is Dictionary:
		_adopt_follow(fr.data)


## Project markers + floor grid (home = grid centre on the floor).
func set_defs(markers: Array, grid: Dictionary) -> void:
	defs = markers.duplicate(true)
	floor_z = float(grid.get("z_offset", 0.0))
	home = Vector2(float(grid.get("x_offset", 0.0)), float(grid.get("y_offset", 0.0)))
	if not has_def(selected):
		selected = int(defs[0].id) if not defs.is_empty() else 0
	updated.emit()


func has_def(id: int) -> bool:
	return defs.any(func(d: Dictionary) -> bool: return int(d.id) == id)


func select_step(dir: int) -> void:
	if defs.is_empty():
		return
	var ids := defs.map(func(d: Dictionary) -> int: return int(d.id))
	selected = ids[(maxi(0, ids.find(selected)) + dir + ids.size()) % ids.size()]
	updated.emit()


func speed_step(dir: int) -> void:
	speed = MI.step_speed(speed, dir)
	updated.emit()


func send_home(id: int) -> void:
	_move(id, home, Time.get_ticks_msec())


## The marker is gone from the project: drop it from the hub too.
func forget(id: int) -> void:
	positions.erase(id)
	_dirty.erase(id)
	if grabbed == id:
		release()
	Api.delete_json("/api/tracking/markers/%d" % id)
	updated.emit()


func pos(id: int) -> Dictionary:
	var p: Variant = positions.get(id)
	return p if p is Dictionary else {"x": home.x, "y": home.y, "z": floor_z, "stale": true, "name": ""}


## Everything to draw / grab in the camera view: [{id, name, color, pos, stale, own, centre, top, ring}].
func marks() -> Array:
	var out := []
	var ids := positions.keys()
	for d in defs:
		if not ids.has(int(d.id)):
			ids.append(int(d.id))
	ids.sort()
	for id in ids:
		var p := pos(id)
		var d: Dictionary = {}
		for x in defs:
			if int(x.id) == id:
				d = x
		var at := [float(p.x), float(p.y), float(p.z)]
		var px := O.shown(entry, [at, [at[0], at[1], at[2] + BODY_M]]) if not entry.is_empty() else [null, null]
		out.append({"id": id, "name": str(d.get("name", p.get("name", "Marker %d" % id))),
			"color": Color.html(str(d.get("color", "#9aa0a6"))), "pos": at, "stale": p.stale == true or not positions.has(id),
			"own": not d.is_empty(), "centre": Vector2(px[0][0], px[0][1]) if px.size() > 0 and px[0] != null else null,
			"top": Vector2(px[1][0], px[1][1]) if px.size() > 1 and px[1] != null else null,
			"ring": MI.ground_ring(entry, at, RING_M) if not entry.is_empty() else PackedVector2Array()})
	return out


## Mouse: press on a marker's ring (raster px) → it is held and selected. → true if one was grabbed.
func grab_at(px: Vector2, radius_px := GRAB_RADIUS_PX) -> bool:
	var own := marks().filter(func(m: Dictionary) -> bool: return m.own)
	var id := MI.grab_target(own, px, radius_px)
	if id == 0:
		return false
	grabbed = id
	selected = id
	var p := pos(id)
	_target = Vector2(p.x, p.y)  # a grab never yanks the marker to the click
	updated.emit()
	return true


func drag_to(px: Vector2) -> void:
	if grabbed == 0:
		return
	var hit: Variant = MI.floor_point(entry, px, float(pos(grabbed).z))
	if hit != null:
		_target = Vector2(hit[0], hit[1])


func release() -> void:
	grabbed = 0
	_target = null


func _process(dt: float) -> void:
	var now := Time.get_ticks_msec()
	if driving and selected != 0:
		_drive(dt, now)
	if grabbed != 0 and _target != null:
		var p := pos(grabbed)
		var at := Vector2(p.x, p.y)
		if at.distance_to(_target) > 1e-4:
			_move(grabbed, MI.glide(at, _target, SMOOTHING), now)
	if not _dirty.is_empty() and now - _last_send >= SEND_MS:
		_send(_dirty.keys(), now)
		_dirty.clear()
		_last_send = now
	if synced and now - _last_beat >= HEARTBEAT_MS:
		_last_beat = now
		var idle := []
		for d in defs:
			var id := int(d.id)
			var other := now - int(_seen.get(id, -100000)) < QUIET_MS and now - int(_mine.get(id, -100000)) >= QUIET_MS
			if not _dirty.has(id) and not other:
				idle.append(id)
		_send(idle, now)


func _drive(dt: float, now: int) -> void:
	var v := Vector2.ZERO
	var pads := Input.get_connected_joypads()
	if not pads.is_empty():
		var dev: int = pads[0]
		v = Vector2(MI.shape_axis(Input.get_joy_axis(dev, JOY_AXIS_LEFT_X), MI.DEADZONE, curve),
			-MI.shape_axis(Input.get_joy_axis(dev, JOY_AXIS_LEFT_Y), MI.DEADZONE, curve))
		if _edge(dev, JOY_BUTTON_LEFT_SHOULDER):
			speed_step(-1)
		if _edge(dev, JOY_BUTTON_RIGHT_SHOULDER):
			speed_step(1)
		if _edge(dev, JOY_BUTTON_DPAD_LEFT):
			select_step(-1)
		if _edge(dev, JOY_BUTTON_DPAD_RIGHT):
			select_step(1)
	var f := get_viewport().gui_get_focus_owner()
	if f == null or f == key_focus:
		v += Vector2(float(Input.is_key_pressed(KEY_RIGHT)) - float(Input.is_key_pressed(KEY_LEFT)),
			float(Input.is_key_pressed(KEY_UP)) - float(Input.is_key_pressed(KEY_DOWN)))
	v = v.limit_length(1.0)
	if v == Vector2.ZERO:
		_axes = []
		return
	if _axes.is_empty():
		_axes = MI.ground_axes(entry.get("cam", {}))
	if grabbed == selected:
		release()  # the stick takes over from the mouse
	var p := pos(selected)
	_move(selected, Vector2(p.x, p.y) + MI.orient(_axes, v) * speed * dt, now)


func _edge(dev: int, button: int) -> bool:
	var down := Input.is_joy_button_pressed(dev, button)
	var was: bool = _pad.get(button, false)
	_pad[button] = down
	return down and not was


func _move(id: int, at: Vector2, now: int) -> void:
	var p := pos(id).duplicate()
	p["x"] = snappedf(at.x, 0.0001)
	p["y"] = snappedf(at.y, 0.0001)
	p["stale"] = false
	positions[id] = p
	_dirty[id] = true
	_mine[id] = now
	updated.emit()


func _send(ids: Array, _now: int) -> void:
	if ids.is_empty():
		return
	var out := []
	for id in ids:
		var p := pos(id)
		var m := {"id": id, "x": p.x, "y": p.y, "z": p.z}
		for d in defs:
			if int(d.id) == id:
				m["name"] = d.name
		out.append(m)
	Ws.send({"type": "tracking:marker", "data": {"markers": out}})


func _on_ws(type: String, data: Variant) -> void:
	if type == "tracking:markers" and data is Dictionary:
		_adopt((data as Dictionary).get("markers", []))
	elif type == "tracking:follow" and data is Dictionary:
		_adopt_follow(data)


func _adopt_follow(data: Dictionary) -> void:
	follow_on = data.get("output_enabled") == true
	follow = {}
	for f in data.get("fixtures", []):
		if f is Dictionary:
			follow[str(f.get("id", ""))] = f
	updated.emit()


func _adopt(list: Array) -> void:
	synced = true
	var now := Time.get_ticks_msec()
	var next := {}
	for m in list:
		if not (m is Dictionary) or not (m.get("id") is float or m.get("id") is int):
			continue
		var id := int(m.id)
		if now - int(_mine.get(id, -100000)) < QUIET_MS and positions.has(id):
			next[id] = positions[id]  # we are driving it: our state wins over echoes
			continue
		var p := {"x": float(m.get("x", 0.0)), "y": float(m.get("y", 0.0)), "z": float(m.get("z", 0.0)),
			"stale": m.get("stale") == true, "name": str(m.get("name", ""))}
		var old: Variant = positions.get(id)
		if old == null or old.x != p.x or old.y != p.y or old.z != p.z:
			_seen[id] = now
		next[id] = p
	for d in defs:  # ours, missing from the hub (server restart): keep where we had it — the heartbeat restores it
		var id := int(d.id)
		if not next.has(id) and positions.has(id):
			next[id] = positions[id]
	positions = next
	updated.emit()
