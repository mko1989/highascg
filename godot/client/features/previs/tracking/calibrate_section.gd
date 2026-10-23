extends VBoxContainer
## WO-624 E3 / WO-616 T13 — calibrate a follow head's position (owner 20.10: "dont see an option to calibrate
## lights"). Every step is a server action (POST /api/tracking/follow/calibrate, src/fixtures/calibrate-session.js):
## the server parks the head, jogs it, pairs each beam spot with the marker the operator dropped on it and solves the
## pose; this only renders the reply. Apply writes the pose into project.fixtures (Godot-owned) through the follow
## section.

const F := preload("res://features/previs/tracking/follow_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const NUDGES := [-5.0, -1.0, 1.0, 5.0]  # fine steps: the spin box arrows (0.1°)

signal apply_requested(solve: Dictionary)
signal refreshed  ## WO-700: after every redraw (a session started / ended / got a point)

var driver: Node  # marker_driver.gd: the selected marker is the one dropped on the spot
var fixture_id := ""
var camera_id := ""  # the camera on screen: WO-616 T13b Find beam spot looks through it
var lighting := false  ## WO-700 Lighting → Calibrate heads: the Programmer / console aims the head (no jog rows, no hold), points come from stage marks and apply at once
var _refs := {}  # camera id → a beam-off reference is held by the server
var _spot := ""
var _find: Button
var _ref: Button
var _sessions := {}  # fixture id → last session reply
var _start: Button
var _box: VBoxContainer
var _pan: SpinBox
var _tilt: SpinBox
var _add: Button
var _apply: Button
var _summary: Label
var _note: Label
var _err := ""
var _point_row: HBoxContainer  # Add point / Undo point


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_start = _button("Calibrate position…", func() -> void: _act({"action": "start", "hold": false} if lighting else {"action": "start"}))
	_start.tooltip_text = "Jog the head onto floor spots and drop a marker on each — the server solves where it hangs."
	add_child(_start)
	_note = _muted("")
	add_child(_note)
	_box = VBoxContainer.new()
	add_child(_box)
	var how := _muted("Aim the real beam onto a stage mark (the Programmer above or your console), pick that mark and press Beam is on — one point per mark. Nothing is sent: each point moves the digital head so its beam lands on the marks so far. 3+ marks spread over the stage (4+ is better)." if lighting
		else "Jog the beam onto a floor spot you can see in the camera view, then click the spot in the picture (or Find beam spot, or drop the selected marker on it and Add point) — that adds the point. 4+ spots spread over the stage.")
	_box.add_child(how)
	if not lighting:
		_pan = _axis_row("Pan °", "pan", "dpan")
		_tilt = _axis_row("Tilt °", "tilt", "dtilt")
	var row := HBoxContainer.new()
	if not lighting:
		_add = _button("Add point", func() -> void: _act({"action": "point", "marker": int(driver.selected) if driver != null else 0}))
		row.add_child(_add)
	row.add_child(_button("Undo point", func() -> void: _act({"action": "undo"})))
	_box.add_child(row)
	_point_row = row
	if not lighting:
		row = HBoxContainer.new()
		_find = _button("Find beam spot", func() -> void: _spot_act("find"))
		_find.tooltip_text = "The server looks for the beam in this camera's picture and adds it as a point."
		row.add_child(_find)
		_ref = _button("Beam-off reference", func() -> void: _spot_act("clear" if _refs.get(camera_id) == true else "reference"))
		_ref.tooltip_text = "Take the picture with the beam off (or aimed off stage): later finds only look at what got brighter — LED walls and lit scenery drop out."
		row.add_child(_ref)
		_box.add_child(row)
	_summary = _muted("")
	_box.add_child(_summary)
	row = HBoxContainer.new()
	_apply = _button("Apply pose", _apply_current)
	_apply.visible = not lighting  # WO-700: each point applies itself
	row.add_child(_apply)
	row.add_child(_button("Done", func() -> void: _act({"action": "end"})))
	_box.add_child(row)
	_reload()
	refresh()


## Re-enter a session the server still holds (another client, or before a relaunch).
func _reload() -> void:
	var res: Dictionary = await Api.get_json("/api/tracking/follow/calibrate")
	if res.ok and res.data is Dictionary and res.data.get("sessions") is Array:
		for s in res.data.sessions:
			_sessions[str(s.id)] = s
		refresh()


## Apply what the server holds now — another client (or the API) may have added points since our last reply.
func _apply_current() -> void:
	var id := fixture_id
	var res: Dictionary = await Api.get_json("/api/tracking/follow/calibrate")
	if not (res.ok and res.data is Dictionary and res.data.get("sessions") is Array):
		_err = "Apply failed: %s" % res.error
		refresh()
		return
	_sessions.erase(id)
	for sess in res.data.sessions:
		_sessions[str(sess.id)] = sess
	var cur: Variant = _sessions.get(id)
	_err = "" if cur is Dictionary else "The calibration was ended elsewhere."
	refresh()
	if cur is Dictionary and cur.get("solve") is Dictionary and cur.solve.get("ok") == true:
		apply_requested.emit(cur.solve)


## WO-700: the Lighting fold's "Beam is on <mark>" goes first in the Undo point row.
func add_point_button(b: Button) -> void:
	_point_row.add_child(b)
	_point_row.move_child(b, 0)


## Is the shown fixture being calibrated (a camera click then means "the beam is here")?
func is_open() -> bool:
	return _sessions.get(fixture_id) is Dictionary


## WO-630 F1: the beam spot the operator clicked in the camera picture (PSN metres) — no marker to place first.
func add_floor_point(at: Array) -> void:
	if is_open():
		_act({"action": "point", "at": at})


func set_fixture(id: String) -> void:
	if id != fixture_id:
		fixture_id = id
		_err = ""
		_spot = ""
		refresh()


## WO-616 T13b: find (and add) the beam spot in camera_id's picture, or take / clear its beam-off reference.
func _spot_act(action: String) -> void:
	if fixture_id == "" or camera_id == "":
		return
	var id := fixture_id
	var cam := camera_id
	var res: Dictionary = await Api.post_json("/api/tracking/follow/calibrate/spot", {"camera": cam, "action": action, "id": id})
	_err = "" if res.ok else str(res.error)
	if action != "find":
		if res.ok:
			_refs[cam] = action == "reference"
	elif res.data is Dictionary:
		_spot = F.spot_line(res.data.get("spot"))
		if res.ok and res.data.has("points"):
			_sessions[id] = res.data
	refresh()


func _act(body: Dictionary) -> void:
	if fixture_id == "":
		return
	body["id"] = fixture_id
	var id := fixture_id
	var res: Dictionary = await Api.post_json("/api/tracking/follow/calibrate", body)
	_err = "" if res.ok else str(res.error)
	if res.ok and res.data is Dictionary:
		if res.data.get("ended") == true:
			_sessions.erase(id)
		else:
			_sessions[id] = res.data
	refresh()
	if lighting and res.ok and str(body.get("action")) in ["point", "undo"]:
		_follow_points(res.data)


## WO-700 (owner 23.10: "the position pan/tilt of the digital gets corrected each calibration point is added"): every
## point moves the patched head at once — no Apply; undone to no points, it goes back where the session started.
func _follow_points(sess: Variant) -> void:
	if not sess is Dictionary:
		return
	var solve: Variant = sess.get("solve")
	if solve is Dictionary and solve.get("ok") == true:
		apply_requested.emit(solve)
	elif (sess.get("points", []) as Array).is_empty() and sess.get("pose0") is Dictionary:
		apply_requested.emit({"ok": true, "pose": sess.pose0})


func refresh() -> void:
	if _box == null:
		return
	var s: Variant = _sessions.get(fixture_id)
	var on := s is Dictionary
	_start.visible = not on and fixture_id != ""
	_box.visible = on
	_note.text = _err
	_note.visible = not on and _err != ""
	if not on:
		refreshed.emit()
		return
	if not lighting:
		if not _pan.get_line_edit().has_focus():
			_pan.set_value_no_signal(float(s.pan))
		if not _tilt.get_line_edit().has_focus():
			_tilt.set_value_no_signal(float(s.tilt))
		var marker := int(driver.selected) if driver != null else 0
		_add.disabled = marker == 0
		_add.text = "Add point at %s" % _marker_name(marker) if marker != 0 else "Add point (select a marker)"
		_find.disabled = camera_id == ""
		_find.text = "Find beam spot" if camera_id != "" else "Find beam spot (no camera)"
		_ref.disabled = camera_id == ""
		_ref.text = "Clear reference" if _refs.get(camera_id) == true else "Beam-off reference"
	var txt := F.calib_summary(s)
	if _spot != "":
		txt += "\n" + _spot
	if s.get("output_enabled") != true:
		txt = "DMX output is off for this head's universe — the head will not move.\n" + txt
	if _err != "":
		txt += "\n" + _err
	_summary.text = txt
	_apply.disabled = not (s.get("solve") is Dictionary and s.solve.get("ok") == true)
	refreshed.emit()


func _marker_name(id: int) -> String:
	for d in (driver.defs if driver != null else []):
		if int(d.id) == id:
			return str(d.name)
	return "Marker %d" % id


func _axis_row(text: String, key: String, dkey: String) -> SpinBox:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.custom_minimum_size.x = 48
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	row.add_child(l)
	var sb := SpinBox.new()
	sb.min_value = -540
	sb.max_value = 540
	sb.step = 0.1
	sb.custom_minimum_size.x = 84
	sb.value_changed.connect(func(v: float) -> void: _act({"action": "jog", key: v}))
	row.add_child(sb)
	for d in NUDGES:
		var b := _button(("+" if d > 0 else "") + String.num(d), func() -> void: _act({"action": "jog", dkey: d}))
		b.custom_minimum_size.x = 34
		row.add_child(b)
	_box.add_child(row)
	return sb


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
