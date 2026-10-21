extends VBoxContainer
## WO-615 T3/T4 — previs "Fixtures": the patch sheet for GDTF-typed fixtures. Import a .gdtf (POST
## /api/fixtures/types; the server parses and keeps it), pick a type + mode, Add N at the next free addresses of a
## universe (Art-Net port-address or sACN universe) into project.fixtures.patch (follow_model.gd shape — the
## Tracking → Follow list edits each one), see every universe's usage (GET /api/fixtures/dmx) and drive the DMX
## master `fixtures.dmx` (off by default, asks first) with the universes it sends; Visualise console (T7) lets the
## console's input drive the previs instead (and sends nothing on those universes). The Programmer (T6) sits below.

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const M := preload("res://features/previs/fixtures/fixtures_model.gd")
const Programmer := preload("res://features/previs/fixtures/programmer_section.gd")

var types: Array = []  # /api/fixtures/types summaries
var usage: Array = []  # /api/fixtures/dmx universes
var _type: OptionButton
var _mode: OptionButton
var _proto: OptionButton
var _universe: SpinBox
var _count: SpinBox
var _master: CheckButton
var _visualise: CheckButton
var _send: MenuButton
var _usage: Label
var _status: Label
var _confirm_on: ConfirmationDialog
var _confirm_rm: ConfirmationDialog
var _last := ""


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_type = OptionButton.new()
	_type.fit_to_longest_item = false
	_type.item_selected.connect(func(_i: int) -> void: _fill_modes())
	add_child(_type)
	var row := HBoxContainer.new()
	for spec in [["Import GDTF…", _import], ["Remove", _ask_remove]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(spec[1])
		row.add_child(b)
	add_child(row)
	_mode = OptionButton.new()
	_mode.fit_to_longest_item = false
	_mode.item_selected.connect(_on_mode)
	add_child(_mode)
	var add := HBoxContainer.new()
	_proto = OptionButton.new()
	_proto.add_item("Art-Net")
	_proto.add_item("sACN")
	_proto.item_selected.connect(func(i: int) -> void:
		_universe.min_value = 1 if i == 1 else 0
		_universe.max_value = F.SACN_UNIVERSE_MAX if i == 1 else F.PORT_ADDRESS_MAX)
	add.add_child(_proto)
	_universe = _spin(0, F.PORT_ADDRESS_MAX, "Universe")
	_universe.prefix = "U"
	add.add_child(_universe)
	_count = _spin(1, 64, "How many")
	_count.prefix = "×"
	add.add_child(_count)
	var b_add := Button.new()
	b_add.text = "Add"
	b_add.pressed.connect(_add)
	add.add_child(b_add)
	add_child(add)
	var out := HBoxContainer.new()
	_master = CheckButton.new()
	_master.text = "DMX output"
	_master.toggled.connect(func(on: bool) -> void:
		_master.set_pressed_no_signal(_dmx().enabled)
		if on:
			_confirm_on.popup_centered()
		else:
			_set_dmx({"enabled": false}))
	out.add_child(_master)
	_send = MenuButton.new()
	_send.text = "Send ▾"
	_send.flat = false
	_send.tooltip_text = "Universes the DMX output sends (only checked ones ever go on the wire)"
	_send.about_to_popup.connect(_fill_send)
	_send.get_popup().hide_on_checkable_item_selection = false
	_send.get_popup().index_pressed.connect(_toggle_send)
	out.add_child(_send)
	_visualise = CheckButton.new()
	_visualise.text = "Visualise console"
	_visualise.tooltip_text = ("T7: the console's Art-Net / sACN for the patched universes drives the previs; " +
		"the box sends nothing on them meanwhile")
	_visualise.toggled.connect(func(on: bool) -> void: _set_dmx({"visualise": on}))
	out.add_child(_visualise)
	add_child(out)
	_usage = _label()
	_status = _label()
	_label().text = "Programmer (WO-615 T6) — click fixtures in the 3D view, shift-click adds"
	add_child(Programmer.new())
	_confirm_on = ConfirmationDialog.new()
	_confirm_on.dialog_text = ("Start DMX output? The universes checked under Send ▾ go out at 44 Hz with every " +
		"patched fixture at its programmer value or GDTF default.")
	_confirm_on.confirmed.connect(func() -> void: _set_dmx({"enabled": true}))
	add_child(_confirm_on)
	_confirm_rm = ConfirmationDialog.new()
	_confirm_rm.confirmed.connect(_remove)
	add_child(_confirm_rm)
	var poll := Timer.new()  # T7: the console input status, while visualising
	poll.wait_time = 2.0
	poll.timeout.connect(func() -> void:
		if _dmx().visualise and is_visible_in_tree():
			refresh_usage())
	add_child(poll)
	poll.start()
	Store.project_changed.connect(func(_p: Dictionary) -> void: _maybe_reload())
	await refresh_types()
	_maybe_reload()


func _spin(lo: int, hi: int, tip: String) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.value = lo
	s.tooltip_text = tip
	s.select_all_on_focus = true
	return s


func _label() -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(l)
	return l


func _slice() -> Dictionary:
	return F.normalize(Store.project.get("fixtures"))


func _dmx() -> Dictionary:
	return _slice().dmx


func _maybe_reload() -> void:
	var js := JSON.stringify(Store.project.get("fixtures"))
	if js == _last:
		return
	_last = js
	_master.set_pressed_no_signal(_dmx().enabled)
	_visualise.set_pressed_no_signal(_dmx().visualise)
	refresh_usage()


func refresh_types() -> void:
	var res: Dictionary = await Api.get_json("/api/fixtures/types")
	types = res.data.get("types", []) if res.ok and res.data is Dictionary else []
	var keep := str(_type.get_item_metadata(_type.selected)) if _type.selected >= 0 else ""
	_type.clear()
	if types.is_empty():
		_type.add_item("— no fixture types: Import GDTF… —")
		_type.set_item_metadata(0, "")
	for t in types:
		_type.add_item("%s · %s" % [t.get("manufacturer", "?"), t.get("name", "?")])
		_type.set_item_metadata(_type.item_count - 1, str(t.id))
		if str(t.id) == keep:
			_type.select(_type.item_count - 1)
	_fill_modes()


func _type_id() -> String:
	return str(_type.get_item_metadata(_type.selected)) if _type.selected >= 0 else ""


func _fill_modes() -> void:
	_mode.clear()
	for m in M.find_type(types, _type_id()).get("modes", []):
		var warn: Array = m.get("warnings", [])
		_mode.add_item("%s · %d ch%s" % [m.name, int(m.footprint), "  ⚠" if not warn.is_empty() else ""])
		_mode.set_item_metadata(_mode.item_count - 1, str(m.name))
	var t := M.find_type(types, _type_id())
	_status.text = "" if t.is_empty() else "%s — %d modes. %s" % [t.get("file", ""), (t.get("modes", []) as Array).size(),
		_mode_warning()]


func _on_mode(_i: int) -> void:
	_status.text = _mode_warning()


func _mode_warning() -> String:
	var m := M.find_mode(types, _type_id(), str(_mode.get_item_metadata(_mode.selected)) if _mode.selected >= 0 else "")
	return "; ".join(m.get("warnings", [])) if m.get("warnings") is Array else ""


func refresh_usage() -> void:
	var res: Dictionary = await Api.get_json("/api/fixtures/dmx")
	usage = res.data.get("universes", []) if res.ok and res.data is Dictionary else []
	var lines := M.usage_lines(usage)
	lines.append_array(M.input_lines(usage, res.data.get("input") if res.ok and res.data is Dictionary else null))
	_usage.text = "\n".join(lines) if not lines.is_empty() else ("No patched universes." if res.ok else
		"Fixture engine not reporting — the Tracking module is off on the server.")


func _persist(slice: Dictionary) -> void:
	Store.project["fixtures"] = slice
	_last = JSON.stringify(slice)
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)  # the Follow list reloads too
	await get_tree().create_timer(1.2).timeout  # the engine applies the write once it reaches the server
	refresh_usage()


func _add() -> void:
	var mode := str(_mode.get_item_metadata(_mode.selected)) if _mode.selected >= 0 else ""
	if _type_id() == "" or mode == "":
		_status.text = "Import a GDTF and pick a mode first."
		return
	var s := _slice()
	var proto := "sacn" if _proto.selected == 1 else "artnet"
	var add := M.add_typed(s.patch, types, _type_id(), mode, int(_count.value), proto, int(_universe.value))
	if add.is_empty():
		_status.text = "No room: universe %d has no %d free channels in a row." % [int(_universe.value),
			int(M.find_mode(types, _type_id(), mode).get("footprint", 0))]
		return
	s.patch.append_array(add)
	_status.text = "Added %d at %s." % [add.size(), ", ".join(add.map(func(f: Dictionary) -> String:
		return "%d.%03d" % [int(f.universe), int(f.address)]))]
	if add.size() < int(_count.value):
		_status.text += " The universe is full — the rest did not fit."
	_persist(s)


func _set_dmx(change: Dictionary) -> void:
	var s := _slice()
	s.dmx.merge(change, true)
	_master.set_pressed_no_signal(s.dmx.enabled)
	_persist(s)


func _fill_send() -> void:
	var p := _send.get_popup()
	p.clear()
	var on: Array = _dmx().universes
	for u in usage:
		var key := "%s:%d" % [u.protocol, int(u.universe)]
		if not _has_item(p, key):
			p.add_check_item("%s %d" % ["sACN" if u.protocol == "sacn" else "Art-Net", int(u.universe)])
			p.set_item_metadata(p.item_count - 1, key)
			p.set_item_checked(p.item_count - 1, on.has(key))
	if p.item_count == 0:
		p.add_item("— nothing patched —")
		p.set_item_disabled(0, true)


static func _has_item(p: PopupMenu, key: String) -> bool:
	for i in p.item_count:
		if str(p.get_item_metadata(i)) == key:
			return true
	return false


func _toggle_send(i: int) -> void:
	var p := _send.get_popup()
	var key := str(p.get_item_metadata(i))
	var on := not p.is_item_checked(i)
	p.set_item_checked(i, on)
	var s := _slice()
	s.dmx = M.toggle_universe(s.dmx, key, on)
	_persist(s)


func _import() -> void:
	var path: String = await FilePick.open_path(self, "Import a GDTF fixture type", ["*.gdtf ; GDTF fixture type"])
	if path == "":
		return
	_status.text = "Uploading %s…" % path.get_file()
	var res: Dictionary = await Upload.upload(Config.origin, "/api/fixtures/types", path)
	if not res.ok or not (res.data is Dictionary):
		_status.text = "Import failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
		return
	await refresh_types()
	for i in _type.item_count:
		if str(_type.get_item_metadata(i)) == str(res.data.id):
			_type.select(i)
	_fill_modes()


func _ask_remove() -> void:
	var id := _type_id()
	if id == "":
		return
	var used: int = _slice().patch.filter(func(f: Dictionary) -> bool: return f.typeId == id).size()
	_confirm_rm.dialog_text = "Remove \"%s\" from this box?%s" % [_type.get_item_text(_type.selected),
		"" if used == 0 else " %d patched fixture%s use it and stop output until it is imported again." % [used, "" if used == 1 else "s"]]
	_confirm_rm.popup_centered()


func _remove() -> void:
	await Api.delete_json("/api/fixtures/types/" + _type_id())
	await refresh_types()
	refresh_usage()
