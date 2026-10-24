extends VBoxContainer
## WO-711 — "PTZ cameras" section of the tracking Inspector page (Follow mode): the cameras the box points itself with
## VISCA (server src/ptz/: the Auto director says who to look at, ptz-service.js sends). Entries live in
## project.previs.tracking.ptz (the page persists them: `edit`); ptz_model.gd normalizes like the server. Nothing is
## sent until a camera is ticked Enabled. Live state per camera comes from WS `tracking:auto` (`ptz: [...]`), else "—".

signal edit(list: Array)

const P := preload("res://features/previs/tracking/ptz_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const CalFold := preload("res://features/previs/tracking/ptz_calibrate_fold.gd")  # WO-713 R2
const SenderPicker := preload("res://features/devices/sender_picker.gd")

## [label, path, min, max, step]
const FIELDS := [["Port", "port", 1, 65535, 1], ["Camera address (1-7)", "address", 1, 7, 1],
	["X m (stage left +)", "pose.x", -500, 500, 0.01], ["Y m (upstage +)", "pose.y", -500, 500, 0.01],
	["Z m (height)", "pose.z", -50, 200, 0.01], ["Yaw ° (0 upstage, 90 stage left)", "pose.yaw", -360, 360, 1],
	["Pitch ° (tilt 0 looks)", "pose.pitch", -89, 89, 0.5],
	["Pan min °", "pan.min", -360, 360, 1], ["Pan max °", "pan.max", -360, 360, 1],
	["Pan units / °", "pan.units_per_deg", 0.01, 1000, 0.01], ["Pan speed (1-24)", "speed.pan", 1, 24, 1],
	["Tilt min °", "tilt.min", -360, 360, 1], ["Tilt max °", "tilt.max", -360, 360, 1],
	["Tilt units / °", "tilt.units_per_deg", 0.01, 1000, 0.01], ["Tilt speed (1-20)", "speed.tilt", 1, 20, 1],
	["Aim height m (above floor)", "aim_z", -5, 10, 0.05],
	["Home preset (0 = Home cmd)", "home.preset", 0, 127, 1], ["Zoom (-1 = leave)", "zoom", -1, 65535, 1]]
const CHECKS := [["Invert pan", "pan.invert"], ["Invert tilt", "tilt.invert"],
	["Auto (follows the primary tracked person)", "auto"], ["Enabled (sends VISCA)", "enabled"]]

var cams: Array = []
var sel := 0
var _last_json := ""
var _status := {}  # camera id → the server's status entry
var _list: OptionButton
var _form: GridContainer
var _name: LineEdit
var _proto: OptionButton
var _host: LineEdit
var _spins := {}
var _checks := {}
var _state: Label
var _cal: CalFold
var _confirm_del: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var h := Label.new()
	h.text = "PTZ cameras (WO-711)"
	h.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(h)
	add_child(SenderPicker.make("ptz", "Sent by"))  # WO-723: which linked server sends VISCA (hidden on one box)
	var row := HBoxContainer.new()
	_list = OptionButton.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.item_selected.connect(func(i: int) -> void:
		sel = i
		refresh())
	row.add_child(_list)
	row.add_child(_button("Add", _add))
	row.add_child(_button("Delete", func() -> void: _confirm_del.popup_centered()))
	add_child(row)
	_confirm_del = ConfirmationDialog.new()
	_confirm_del.dialog_text = "Delete this PTZ camera?"
	_confirm_del.confirmed.connect(_delete)
	add_child(_confirm_del)
	_form = GridContainer.new()
	_form.columns = 2
	_name = _line(func(v: String) -> void: _edit("name", v if v.strip_edges() != "" else "PTZ"))
	_pair("Name", _name)
	_proto = OptionButton.new()
	for p in P.PROTOCOLS:
		_proto.add_item(P.PROTOCOL_LABELS[p])
	_proto.item_selected.connect(func(i: int) -> void: _set_protocol(P.PROTOCOLS[i]))
	_pair("Protocol", _proto)
	_host = _line(func(v: String) -> void: _edit("host", v.strip_edges()))
	_host.placeholder_text = "camera IP, e.g. 192.168.1.50"
	_pair("Host", _host)
	for f in FIELDS:
		var sb := SpinBox.new()
		sb.min_value = f[2]
		sb.max_value = f[3]
		sb.step = f[4]
		sb.update_on_text_changed = true
		var key: String = f[1]
		sb.value_changed.connect(func(v: float) -> void: _edit(key, _spin_value(key, v)))
		_spins[key] = sb
		_pair(f[0], sb)
	for c in CHECKS:
		var cb := CheckBox.new()
		var key: String = c[1]
		cb.toggled.connect(func(on: bool) -> void: _edit(key, on))
		_checks[key] = cb
		_pair(c[0], cb)
	add_child(_form)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	_cal = CalFold.new()
	_cal.done.connect(_on_calibrated)
	add_child(_cal)
	Ws.message.connect(_on_ws)
	Ws.connected.connect(reload_status)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload_status())
	refresh()


## The page hands the saved list over on every project change (no signal; unchanged lists are skipped).
func set_cameras(src: Variant) -> void:
	var list := P.normalize_list(src)
	var js := JSON.stringify(list)
	if js == _last_json:
		return
	_last_json = js
	cams = list
	sel = clampi(sel, 0, maxi(0, cams.size() - 1))
	refresh()


func reload_status() -> void:
	var r: Dictionary = await Api.get_json("/api/tracking/auto")
	if r.ok and r.data is Dictionary:
		_adopt_status((r.data as Dictionary).get("ptz"))


func _on_ws(type: String, data: Variant) -> void:
	if type == "tracking:auto" and data is Dictionary and not (data as Dictionary).has("source"):  # WO-712 R3: not ours
		_adopt_status((data as Dictionary).get("ptz"))


func _adopt_status(list: Variant) -> void:
	_status = {}
	for s in list if list is Array else []:
		if s is Dictionary:
			_status[str((s as Dictionary).get("id", ""))] = s
	_show_state()


func _commit() -> void:
	_last_json = JSON.stringify(cams)
	edit.emit(cams.duplicate(true))
	refresh()


func _edit(path: String, v: Variant) -> void:
	if sel >= cams.size():
		return
	var d: Dictionary = cams[sel]
	var keys := path.split(".")
	for i in keys.size() - 1:
		d = d[keys[i]]
	if d[keys[-1]] == v:
		return
	d[keys[-1]] = v
	cams[sel] = P.normalize_camera(cams[sel], sel)  # clamp / fix at once, like the server
	_commit()


## Spin values → model values: integer fields stay int, zoom -1 = none.
static func _spin_value(key: String, v: float) -> Variant:
	if key == "zoom":
		return null if v < 0.0 else int(v)
	return int(v) if key in ["port", "address", "speed.pan", "speed.tilt", "home.preset"] else v


func _set_protocol(p: String) -> void:
	if sel >= cams.size() or cams[sel].protocol == p:
		return
	var c: Dictionary = cams[sel]
	if int(c.port) == P.DEFAULT_PORTS[c.protocol]:  # a default port follows the protocol; a custom one stays
		c.port = P.DEFAULT_PORTS[p]
	c.protocol = p
	_commit()


func _add() -> void:
	cams.append(P.new_camera(cams))
	sel = cams.size() - 1
	_commit()


## The calibration fold's Done: its session's pins become that camera's offset_map (same save path as any edit).
func _on_calibrated(cam_id: String, pins: Array) -> void:
	for i in cams.size():
		if cams[i].id == cam_id:
			cams[i].offset_map = P.normalize_pins(pins)
			_commit()
			return


func _delete() -> void:
	if sel < cams.size():
		cams.remove_at(sel)
		sel = clampi(sel, 0, maxi(0, cams.size() - 1))
		_commit()


## Fields ← cams (no signals).
func refresh() -> void:
	if _list == null:
		return
	_list.clear()
	for c in cams:
		_list.add_item("%s%s" % [c.name, "" if c.enabled else " (off)"])
	_form.visible = not cams.is_empty()
	_cal.set_camera({} if cams.is_empty() else cams[sel])
	if cams.is_empty():
		_show_state()
		return
	_list.select(sel)
	var c: Dictionary = cams[sel]
	if not _name.has_focus():
		_name.text = c.name
	if not _host.has_focus():
		_host.text = c.host
	_proto.select(P.PROTOCOLS.find(c.protocol))
	for key in _spins:
		var v: Variant = _at(c, key)
		(_spins[key] as SpinBox).set_value_no_signal(-1.0 if key == "zoom" and v == null else float(v))
	for key in _checks:
		(_checks[key] as CheckBox).set_pressed_no_signal(_yes(_at(c, key)))
	_show_state()


func _show_state() -> void:
	if _state == null:
		return
	if cams.is_empty():
		_state.text = "No PTZ cameras. Add one, set its pose, tick Enabled; Auto points it at the tracked person."
		return
	var c: Dictionary = cams[sel]
	var line := P.status_line(_status.get(c.id))
	if not c.enabled:
		line = "disabled — nothing is sent"
	elif c.host == "":
		line = "no host — nothing is sent"
	_state.text = "Status: %s" % line


static func _yes(v: Variant) -> bool:
	return v is bool and v


static func _at(c: Dictionary, path: String) -> Variant:
	var d: Variant = c
	for k in path.split("."):
		d = d[k]
	return d


func _pair(text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_form.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_form.add_child(c)


func _line(cb: Callable) -> LineEdit:
	var e := LineEdit.new()
	e.text_submitted.connect(cb)
	e.focus_exited.connect(func() -> void: cb.call(e.text))
	return e


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
