extends VBoxContainer
## WO-616 T11 — Follow section of the tracking Inspector page (Follow mode): the moving heads that follow markers
## (server engine src/fixtures/: marker → pan / tilt → Art-Net). Owns project.fixtures (follow_model; Godot-owned
## slice). Art-Net output is a master that starts off and asks before it transmits. Live aim / state per fixture
## comes from the server (`tracking:follow`, via the marker driver).

const F := preload("res://features/previs/tracking/follow_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

## [label, path, min, max, step]  (path "pan.ch" = data.pan.ch)
const FIELDS := [["Universe (port-addr)", "universe", 0, 32767, 1], ["Address", "address", 1, 512, 1],
	["Pan ch", "pan.ch", 1, 512, 1], ["Pan fine ch (0 = 8-bit)", "pan.fine", 0, 512, 1], ["Pan range °", "pan.range", 1, 1080, 1],
	["Tilt ch", "tilt.ch", 1, 512, 1], ["Tilt fine ch (0 = 8-bit)", "tilt.fine", 0, 512, 1], ["Tilt range °", "tilt.range", 1, 1080, 1],
	["X m (stage left +)", "pose.x", -500, 500, 0.01], ["Y m (upstage +)", "pose.y", -500, 500, 0.01],
	["Z m (height)", "pose.z", -50, 200, 0.01], ["Yaw ° (tilt+ swings to)", "pose.yaw", -360, 360, 1],
	["Aim height m", "aim_z", -5, 10, 0.05]]
const CHECKS := [["Enabled", "enabled"], ["Hung (truss)", "pose.hang"], ["Invert pan", "pan.invert"], ["Invert tilt", "tilt.invert"]]

var driver: Node  # marker_driver.gd: marker names + the server's `follow` aims
var data := F.normalize({})
var sel := 0
var _last_json := ""
var _out: CheckButton
var _list: ItemList
var _name: LineEdit
var _dest: LineEdit
var _fixed: LineEdit
var _follow: OptionButton
var _spins := {}
var _checks := {}
var _state: Label
var _confirm_on: ConfirmationDialog
var _confirm_del: ConfirmationDialog
var _form: GridContainer


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_out = CheckButton.new()
	_out.text = "Art-Net output"
	_out.toggled.connect(func(on: bool) -> void:
		_out.set_pressed_no_signal(data.output.enabled)
		if on:
			_confirm_on.popup_centered()
		else:
			_set_output(false))
	add_child(_out)
	_confirm_on = _dialog("Start Art-Net output? Every patched universe is sent at 44 Hz — channels no fixture uses go out as 0.",
		func() -> void: _set_output(true))
	_list = ItemList.new()
	_list.custom_minimum_size.y = 120
	_list.item_selected.connect(func(i: int) -> void:
		sel = i
		refresh())
	add_child(_list)
	var row := HBoxContainer.new()
	row.add_child(_button("Add fixture", _add))
	row.add_child(_button("Delete", func() -> void: _confirm_del.popup_centered()))
	add_child(row)
	_confirm_del = _dialog("Delete this fixture from the follow patch?", _delete)
	_form = GridContainer.new()
	_form.columns = 2
	_name = _line(func(v: String) -> void: _edit("name", v if v.strip_edges() != "" else "Fixture"))
	_pair("Name", _name)
	_follow = OptionButton.new()
	_follow.item_selected.connect(func(i: int) -> void: _edit("follow", _follow.get_item_id(i)))
	_pair("Follows", _follow)
	_dest = _line(func(v: String) -> void: _edit("dest", v.strip_edges()))
	_dest.placeholder_text = F.DEFAULT_DEST + "  (ip[:port])"
	_pair("Destination", _dest)
	for f in FIELDS:
		var sb := SpinBox.new()
		sb.min_value = f[2]
		sb.max_value = f[3]
		sb.step = f[4]
		sb.update_on_text_changed = true
		var key: String = f[1]
		sb.value_changed.connect(func(v: float) -> void: _edit(key, int(v) if f[4] >= 1 else v))
		_spins[key] = sb
		_pair(f[0], sb)
	for c in CHECKS:
		var cb := CheckBox.new()
		var key: String = c[1]
		cb.toggled.connect(func(on: bool) -> void: _edit(key, ("truss" if on else "floor") if key == "pose.hang" else on))
		_checks[key] = cb
		_pair(c[0], cb)
	_fixed = _line(func(v: String) -> void: _edit("fixed", v.strip_edges()))
	_fixed.placeholder_text = "e.g. 6=255, 7=8  (shutter, dimmer)"
	_pair("Fixed channels", _fixed)
	add_child(_form)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _maybe_reload())
	_maybe_reload()


func _maybe_reload() -> void:
	var src: Variant = Store.project.get("fixtures")
	var js := JSON.stringify(src)
	if js == _last_json:
		return
	_last_json = js
	data = F.normalize(src)
	sel = clampi(sel, 0, maxi(0, data.patch.size() - 1))
	refresh()


func _persist(now := false) -> void:
	Store.project["fixtures"] = data.duplicate(true)
	_last_json = JSON.stringify(Store.project.fixtures)
	ProjectSync.mark_dirty(now)
	refresh()


func _set_output(on: bool) -> void:
	data.output.enabled = on
	_persist(true)  # the master reaches the engine at once, not after the autosave debounce


func _edit(path: String, v: Variant) -> void:
	if sel >= data.patch.size():
		return
	var d: Dictionary = data.patch[sel]
	var keys := path.split(".")
	for i in keys.size() - 1:
		d = d[keys[i]]
	if d[keys[-1]] == v:
		return
	d[keys[-1]] = v
	_persist()


func _add() -> void:
	var m: int = int(driver.selected) if driver != null else 0
	data.patch.append(F.new_fixture(data.patch, m))
	sel = data.patch.size() - 1
	_persist()


func _delete() -> void:
	if sel < data.patch.size():
		data.patch.remove_at(sel)
		sel = clampi(sel, 0, maxi(0, data.patch.size() - 1))
		_persist()


func aim(id: String) -> Dictionary:
	var a: Variant = driver.follow.get(id) if driver != null else null
	return a if a is Dictionary else {}


## Fields ← data + the server's aims (no signals).
func refresh() -> void:
	if _list == null:
		return
	_out.set_pressed_no_signal(data.output.enabled)
	_list.clear()
	for fx in data.patch:
		var a := aim(fx.id)
		var st := str(a.get("state", "—"))
		var txt := "%s  U%d.%03d → %s · %s" % [fx.name, fx.universe, fx.address, _marker_name(fx.follow), st]
		if st == "following":
			txt += "  %.1f° / %.1f°" % [float(a.pan), float(a.tilt)]
		_list.add_item(txt)
		_list.set_item_custom_fg_color(_list.item_count - 1, ThemeBuilder.ERROR if a.get("problem") != null and a.get("problem") != "" else
			ThemeBuilder.TEXT if st == "following" else ThemeBuilder.TEXT_MUTED)
	_form.visible = not data.patch.is_empty()
	if data.patch.is_empty():
		_state.text = "No follow fixtures — Add one (it follows the selected marker)."
		return
	_list.select(sel)
	var fx: Dictionary = data.patch[sel]
	if not _name.has_focus():
		_name.text = fx.name
	if not _dest.has_focus():
		_dest.text = fx.dest
	if not _fixed.has_focus():
		_fixed.text = fx.fixed
	_follow.clear()
	_follow.add_item("— none —", 0)
	var ids := [0]
	for d in (driver.defs if driver != null else []):
		_follow.add_item(str(d.name), int(d.id))
		ids.append(int(d.id))
	if not ids.has(fx.follow):
		_follow.add_item("Marker %d (not in this project)" % fx.follow, fx.follow)
		ids.append(fx.follow)
	_follow.select(ids.find(fx.follow))
	for key in _spins:
		(_spins[key] as SpinBox).set_value_no_signal(float(_at(fx, key)))
	for key in _checks:
		var v: Variant = _at(fx, key)
		(_checks[key] as CheckBox).set_pressed_no_signal(v == "truss" if key == "pose.hang" else v == true)
	var a := aim(fx.id)
	var prob := str(a.get("problem", "")) if a.get("problem") != null else ""
	_state.text = ("Not output: " + prob if prob != "" else
		"Server follow engine not reporting — the Tracking module is off on the server." if a.is_empty() else
		"%s. Output %s. Stale marker = hold; unreachable = hold." % [str(a.state).capitalize(), "ON" if data.output.enabled else "off"])


static func _at(fx: Dictionary, path: String) -> Variant:
	var d: Variant = fx
	for k in path.split("."):
		d = d[k]
	return d


func _marker_name(id: int) -> String:
	if id == 0:
		return "nothing"
	for d in (driver.defs if driver != null else []):
		if int(d.id) == id:
			return str(d.name)
	return "Marker %d" % id


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


func _dialog(text: String, cb: Callable) -> ConfirmationDialog:
	var d := ConfirmationDialog.new()
	d.dialog_text = text
	d.confirmed.connect(cb)
	add_child(d)
	return d


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
