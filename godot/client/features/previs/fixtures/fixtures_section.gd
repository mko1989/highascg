extends VBoxContainer
## WO-615 T3/T4 — previs "Fixtures": the patch sheet for GDTF-typed fixtures. Import a .gdtf (POST
## /api/fixtures/types; the server parses and keeps it), pick a type + mode, Add N at the next free addresses of a
## universe (Art-Net port-address or sACN universe) into project.fixtures.patch (follow_model.gd shape — the
## Tracking → Follow list edits each one), see every universe's usage (GET /api/fixtures/dmx) and drive the DMX
## master `fixtures.dmx` (off by default, asks first) with the universes it sends; Art-Net / sACN input (T7, renamed WO-641) lets the
## console's input drive the previs instead (and sends nothing on those universes). The Programmer (T6) sits below.

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const M := preload("res://features/previs/fixtures/fixtures_model.gd")
const Programmer := preload("res://features/previs/fixtures/programmer_section.gd")
const Replace := preload("res://features/previs/fixtures/replace_type_dialog.gd")
const RM := preload("res://features/previs/fixtures/replace_type_model.gd")
const Tint := preload("res://features/previs/model_tint.gd")
const ColorRows := preload("res://features/previs/color_rows.gd")
const DmxMonitor := preload("res://features/previs/fixtures/dmx_monitor_window.gd")

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
var _replace: Button
var _replace_dlg: ConfirmationDialog
var _last := ""
var _body := ColorRows.new()  # WO-641: the selected type's body colour


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
	_replace = Button.new()  # WO-633: an MVR placeholder GDTF → the real type
	_replace.text = "Replace…"
	_replace.tooltip_text = "This type is an MVR placeholder (no model, dimmer channels) — use the real GDTF instead"
	_replace.pressed.connect(func() -> void: _replace_dlg.open(types, M.find_type(types, _type_id())))
	row.add_child(_replace)
	add_child(row)
	_body.previewed.connect(func(id: String, c: Color) -> void: _set_body(id, c, false))
	_body.changed.connect(func(id: String, c: Variant) -> void: _set_body(id, c, true))
	add_child(_body)
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
	_visualise.text = "Art-Net / sACN input"
	_visualise.tooltip_text = ("A lighting console's Art-Net / sACN on the patched universes drives the previs " +
		"fixtures; the box sends nothing on those universes meanwhile")
	_visualise.toggled.connect(func(on: bool) -> void: _set_dmx({"visualise": on}))
	out.add_child(_visualise)
	add_child(out)
	var viewer := Button.new()  # WO-693
	viewer.text = "DMX viewer…"
	viewer.tooltip_text = "Art-Net nodes / sACN sources on the network and one universe's 512 channels, live"
	viewer.pressed.connect(_open_viewer)
	var vrow := HBoxContainer.new()
	vrow.add_child(viewer)
	add_child(vrow)
	_usage = _label()
	_status = _label()
	_label().text = "Programmer (WO-615 T6) — click fixtures in the 3D view, ctrl / shift-click adds"
	add_child(Programmer.new())
	_confirm_on = ConfirmationDialog.new()
	_confirm_on.dialog_text = ("Start DMX output? The universes checked under Send ▾ go out at 44 Hz with every " +
		"patched fixture at its programmer value or GDTF default.")
	_confirm_on.confirmed.connect(func() -> void: _set_dmx({"enabled": true}))
	add_child(_confirm_on)
	_confirm_rm = ConfirmationDialog.new()
	_confirm_rm.confirmed.connect(_remove)
	add_child(_confirm_rm)
	_replace_dlg = Replace.new()
	_replace_dlg.replaced.connect(_on_replaced)
	_replace_dlg.failed.connect(func(msg: String) -> void: _status.text = "Replace failed: %s" % msg)
	add_child(_replace_dlg)
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
		var tag := "" if not t.get("placeholder", false) else ("  (placeholder → %s)" % M.find_type(types,
			str(t.replacedBy.to)).get("name", "?") if t.get("replacedBy") is Dictionary else "  (placeholder)")
		_type.add_item("%s · %s%s" % [t.get("manufacturer", "?"), t.get("name", "?"), tag])
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
	_replace.visible = t.get("placeholder", false)
	_body.fill([] if t.is_empty() else [_type_id()], Tint.colors(Store.project.get("previs"), "fixture_colors"),
		{_type_id(): "Body colour"})
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


## WO-641: project.previs.fixture_colors[type] (fixtures_3d re-tints on project_changed); `save` false = a preview.
func _set_body(id: String, c: Variant, save: bool) -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	previs["fixture_colors"] = Tint.with_color(Tint.colors(previs, "fixture_colors"), id, c)
	Store.project["previs"] = previs
	Store.project_changed.emit(Store.project)
	if save:
		ProjectSync.mark_dirty()
		_fill_modes()


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


func _open_viewer() -> void:
	var w := get_node_or_null("DmxMonitor") as AcceptDialog
	if w == null:
		w = DmxMonitor.new()
		w.name = "DmxMonitor"
		add_child(w)
	w.call("open")


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


## WO-633: the alias is stored on the box; this project's fixtures of the placeholder move to the real type + mode.
func _on_replaced(stub_id: String, to: String, modes: Dictionary) -> void:
	await refresh_types()
	if to == "":
		_status.text = "Back to the placeholder for new MVR patches (fixtures already moved stay on the real type)."
		return
	var s := _slice()
	var r := RM.repoint(s.patch, stub_id, to, modes)
	_status.text = "Replaced by %s; %d patched fixture%s moved to it." % [M.find_type(types, to).get("name", "?"),
		r.moved, "" if r.moved == 1 else "s"]
	if r.moved > 0:
		s.patch = r.patch
		_persist(s)
