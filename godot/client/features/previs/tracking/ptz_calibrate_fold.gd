extends VBoxContainer
## WO-713 R2 — "Calibrate on a person" for one PTZ camera (owner 23.10: "a person standing on mark # where i can position
## camera … making the calibration more precise per each device"). Server src/ptz/ptz-calibrate.js: Start holds the
## camera on the operator's angles (the Auto director is ignored for it, the hold lapses after 60 s without an action —
## a timer here keeps it alive), the jog buttons turn it, "Camera is on the person at <mark>" pins the angles it is at
## against the geometric aim at mark + aim height. Done hands the session's pins to the section (`done`), which writes
## them into the camera's offset_map; closing the fold without Done lets the camera go and writes nothing.
## The mark list is the Lighting marks (project.fixtures.marks, WO-700 / WO-703 preset marks).

signal done(cam_id: String, pins: Array)

const P := preload("res://features/previs/tracking/ptz_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HelpDialog := preload("res://app/help_dialog.gd")  # WO-740

const URL := "/api/tracking/ptz/calibrate"
const COARSE := 5.0
const FINE := 0.5

var _cam := {}
var _open := false
var _view := {}  # the server's session view
var _err := ""
var _toggle: Button
var _body: VBoxContainer
var _marks: OptionButton
var _zoom: SpinBox
var _on_person: Button
var _undo: Button
var _state: Label
var _keep: Timer


func _ready() -> void:
	_toggle = Button.new()
	_toggle.toggle_mode = true
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_toggle.toggled.connect(_set_open)
	add_child(HelpDialog.beside(_toggle, "calibrate-ptz"))
	_body = VBoxContainer.new()
	_body.visible = false
	add_child(_body)
	_marks = OptionButton.new()
	_marks.item_selected.connect(func(_i: int) -> void: _refresh())
	_body.add_child(_marks)
	for axis in ["Pan", "Tilt"]:
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = axis
		l.custom_minimum_size.x = 40
		row.add_child(l)
		for step in [-COARSE, -FINE, FINE, COARSE]:
			var d: float = step
			row.add_child(_button("%+.1f" % d if absf(d) < 1.0 else "%+d" % int(d), func() -> void: _jog(axis, d)))
		_body.add_child(row)
	var zr := HBoxContainer.new()
	var zl := Label.new()
	zl.text = "Zoom"
	zl.custom_minimum_size.x = 40
	zr.add_child(zl)
	_zoom = SpinBox.new()
	_zoom.min_value = -1
	_zoom.max_value = 65535
	_zoom.step = 256
	_zoom.value = -1
	_zoom.tooltip_text = "VISCA zoom position, -1 = leave as is"
	_zoom.value_changed.connect(func(v: float) -> void:
		if v >= 0.0:
			_post({"action": "jog", "zoom": int(v)}))
	zr.add_child(_zoom)
	_body.add_child(zr)
	_on_person = _button("", _point)
	_body.add_child(_on_person)
	var row2 := HBoxContainer.new()
	_undo = _button("Undo", func() -> void: _post({"action": "undo"}))
	row2.add_child(_undo)
	row2.add_child(_button("Clear", func() -> void: _post({"action": "clear"})))
	row2.add_child(_button("Done", _finish))
	_body.add_child(row2)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_body.add_child(_state)
	_keep = Timer.new()
	_keep.wait_time = 20.0
	_keep.timeout.connect(func() -> void:
		if _open:
			_post({"action": "jog"}))
	add_child(_keep)
	_fill_marks()
	_refresh()


## The section hands the selected camera over on every refresh; another camera (or none) lets the open one go.
func set_camera(cam: Dictionary) -> void:
	if _open and str(cam.get("id", "")) != str(_cam.get("id", "")):
		_release()
	_cam = cam
	_fill_marks()
	_refresh()


func _exit_tree() -> void:
	if _open:
		_release()


func _set_open(on: bool) -> void:
	if on == _open:
		return
	if on:
		_open = true
		_err = ""
		_fill_marks()  # marks added in Lighting since
		_post({"action": "start"})
	else:
		_release()
	_refresh()


## Lets the camera go (nothing written); the director has it back.
func _release() -> void:
	_open = false
	if not _cam.is_empty():
		Api.post_json(URL, {"action": "end", "id": str(_cam.id)})
	_view = {}
	if _toggle != null:
		_toggle.set_pressed_no_signal(false)
	_refresh()


func _finish() -> void:
	if not _open:
		return
	var pins: Array = _view.get("pins", []) if _view is Dictionary else []
	var id := str(_cam.id)
	_release()
	done.emit(id, pins)


func _post(body: Dictionary) -> void:
	if _cam.is_empty():
		return
	body["id"] = str(_cam.id)
	var res: Dictionary = await Api.post_json(URL, body)
	if not _open:
		return
	_err = "" if res.ok else str(res.error)
	if res.ok and res.data is Dictionary:
		_view = res.data
	elif str(body.get("action")) == "start":
		_open = false
		_toggle.set_pressed_no_signal(false)
	_refresh()


func _jog(axis: String, d: float) -> void:
	_post({"action": "jog", "d" + axis.to_lower(): d})


func _point() -> void:
	var m := _mark()
	if not m.is_empty():
		_post({"action": "point", "at": [m.x, m.y, m.z]})


func _mark() -> Dictionary:
	var id: int = _marks.get_selected_id() if _marks.item_count > 0 else -1
	for m in F.normalize(Store.project.get("fixtures")).marks:
		if int(m.id) == id:
			return m
	return {}


func _fill_marks() -> void:
	if _marks == null:
		return
	var keep := _marks.get_selected_id() if _marks.item_count > 0 else -1
	_marks.clear()
	for m in F.normalize(Store.project.get("fixtures")).marks:
		_marks.add_item(str(m.name), int(m.id))
		if int(m.id) == keep:
			_marks.select(_marks.item_count - 1)


func _refresh() -> void:
	if _toggle == null:
		return
	var n := (_cam.get("offset_map", []) as Array).size()
	_toggle.visible = not _cam.is_empty()
	_toggle.text = "%s Calibrate on a person (%d pin%s)" % ["v" if _open else ">", n, "" if n == 1 else "s"]
	_body.visible = _open
	var m := _mark()
	_on_person.disabled = m.is_empty() or _view.get("pan") == null
	_on_person.text = "Camera is on the person at %s" % m.name if not m.is_empty() else "Camera is on the person at … (add marks in Lighting)"
	_undo.disabled = int(_view.get("added", 0)) == 0
	var line := ""
	if not _view.is_empty():
		line = "%d pins" % (_view.pins as Array).size()
		if _view.get("pan") != null:
			line = "pan %.1f°  tilt %.1f°  —  %s" % [float(_view.pan), float(_view.tilt), line]
		else:
			line = "jog the camera onto the person  —  " + line
	_state.text = _err if _err != "" else line
	if _open and _keep.is_stopped():
		_keep.start()
	elif not _open:
		_keep.stop()


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
