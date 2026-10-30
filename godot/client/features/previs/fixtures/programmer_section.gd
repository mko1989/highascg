extends VBoxContainer
## WO-615 T6 — the previs Programmer: select typed fixtures (this list, a click in the 3D view, ctrl / shift-click adds;
## saved groups) and set what they have — intensity, colour (RGB / CMY mixing or the nearest wheel slot; wheel
## swatches), CTO, pan / tilt or Point at (then click the stage floor: the server aims through the follow IK), zoom,
## gobo (wheel thumbnails). Values go to POST /api/fixtures/program (coalesced to 20 Hz); Release hands the channels
## back to their GDTF defaults. The previs beams show the result (WS tracking:fixtures) — DMX leaves the box only
## while the Fixtures DMX output is on.

const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const P := preload("res://features/previs/fixtures/programmer_model.gd")
const Auto := preload("res://features/previs/fixtures/auto_groups_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const FM := preload("res://features/previs/fixtures/fixtures_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const GroupsView := preload("res://features/previs/fixtures/programmer_groups_view.gd")
const ConsoleRow := preload("res://features/previs/fixtures/console_row.gd")

var sel: RefCounted = Sel.shared()
var mirror := false  ## WO-757: a second copy (the VR panel) — only the first answers Point at clicks and the Delete key
var feats := {}  # fixture id → features (selection only)
var merged := {}
var _typed: Array = []  # typed patch entries, list order
var _list: ItemList
var _view: Tree  # WO-771: the same selection as groups (programmer_groups_view.gd), shown instead of _list
var _groups: MenuButton
var _auto: Array = [[], []]  # WO-680: [by position, by address], worked out when the menu opens
var _controls: VBoxContainer
var _status: Label
var _name_dialog: ConfirmationDialog
var _name: LineEdit
var _confirm_del: ConfirmationDialog
var _del_ids: Array = []  # what the open Delete dialog names (a selection change meanwhile does not retarget it)
var _pending := {}  # JSON of ids → [ids, values], merged until the next flush
var _flush: Timer
var _thumbs := {}  # "typeId|media" → Texture2D (null = none)
var _patch_key := ""
var _gen := 0


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	add_child(_view_switch())
	_list = ItemList.new()
	_list.select_mode = ItemList.SELECT_MULTI
	_list.custom_minimum_size.y = 110
	_list.auto_height = false
	_list.multi_selected.connect(func(_i: int, _on: bool) -> void:
		sel.set_ids(Array(_list.get_selected_items()).map(func(i: int) -> String: return str(_list.get_item_metadata(i)))))
	add_child(_list)
	_view = GroupsView.new()
	_view.custom_minimum_size.y = 220
	_view.visible = false
	_view.picked.connect(_on_view_pick)
	add_child(_view)
	var row := HBoxContainer.new()
	for spec in [["All", func() -> void: sel.set_ids(_typed.map(func(f: Dictionary) -> String: return f.id))],
			["None", func() -> void: sel.set_ids([])], ["Release", _release.bind(false)], ["Release all", _release.bind(true)],
			["Delete", _ask_delete]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(spec[1])
		row.add_child(b)
	_groups = MenuButton.new()
	_groups.text = "Groups ▾"
	_groups.flat = false
	_groups.about_to_popup.connect(_fill_groups)
	_groups.get_popup().id_pressed.connect(_on_group)
	row.add_child(_groups)
	add_child(row)
	add_child(ConsoleRow.new())  # WO-857: follow / take the lighting console's selection
	_controls = VBoxContainer.new()
	_controls.add_theme_constant_override("separation", 4)
	add_child(_controls)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	_name_dialog = ConfirmationDialog.new()
	_name_dialog.title = "Save selection as group"
	_name = LineEdit.new()
	_name.placeholder_text = "Group name"
	_name_dialog.add_child(_name)
	_name_dialog.register_text_enter(_name)
	_name_dialog.confirmed.connect(_save_group)
	add_child(_name_dialog)
	_confirm_del = ConfirmationDialog.new()
	_confirm_del.confirmed.connect(_delete)
	add_child(_confirm_del)
	_flush = Timer.new()
	_flush.one_shot = true
	_flush.wait_time = 0.05
	_flush.timeout.connect(_send)
	add_child(_flush)
	sel.changed.connect(_on_selection)
	sel.aimed.connect(_on_selection)  # WO-679: after a right-drag aim
	if not mirror:
		sel.aim_at.connect(_aim)
		sel.delete_requested.connect(_ask_delete)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _fill_list())
	_fill_list()
	_on_selection()


func _slice() -> Dictionary:
	return F.normalize(Store.project.get("fixtures"))


func _fill_list() -> void:
	var s := _slice()
	_typed = s.patch.filter(func(f: Dictionary) -> bool: return str(f.typeId) != "")
	var key := JSON.stringify(_typed.map(func(f: Dictionary) -> Array: return [f.id, f.name, f.universe, f.address]))
	if key == _patch_key:
		if _fill_view():  # saved groups changed (WO-771)
			_view.mark(sel.ids)
		return
	_patch_key = key
	_list.clear()
	for f in _typed:
		_list.add_item("%s · %d.%03d" % [f.name, int(f.universe), int(f.address)])
		_list.set_item_metadata(_list.item_count - 1, f.id)
	var known := _typed.map(func(f: Dictionary) -> String: return f.id)
	sel.set_ids(sel.ids.filter(func(id: String) -> bool: return known.has(id)))  # patch removals leave the selection
	_fill_view()
	_mark_list()
	_status.text = "No typed fixtures — patch a GDTF type above." if _typed.is_empty() else ""


func _mark_list() -> void:
	var last := -1
	for i in _list.item_count:
		var id := str(_list.get_item_metadata(i))
		if sel.ids.has(id):
			_list.select(i, false)
			if id == str(sel.ids.back()):
				last = i
		else:
			_list.deselect(i)
	if last >= 0:  # WO-771: a head picked in the stage shows in the list (select() made it current)
		_list.select(last, false)
		_list.ensure_current_is_visible()
	if _view.visible:
		_view.mark(sel.ids)


## WO-771 — "Fixtures | Groups": which list the selection is made in.
func _view_switch() -> HBoxContainer:
	var bar := HBoxContainer.new()
	var group := ButtonGroup.new()
	for groups in [false, true]:
		var b := Button.new()
		b.text = "Groups" if groups else "Fixtures"
		b.toggle_mode = true
		b.button_pressed = not groups
		b.button_group = group
		b.pressed.connect(func() -> void:
			_list.visible = not groups
			_view.visible = groups
			_fill_view()
			_mark_list())
		bar.add_child(b)
	return bar


func _fill_view() -> bool:
	return _view != null and _view.visible and _view.fill(_typed, [["", _slice().groups], ["By position", Auto.by_position(_typed)], ["By address", Auto.by_address(_typed)]])


func _on_view_pick(ids: Array, add: bool, group: bool) -> void:
	if group:
		sel.set_ids(sel.ids + ids if add else ids)
	elif not ids.is_empty():
		sel.pick(str(ids[0]), add)


func _type_of() -> Dictionary:
	var out := {}
	for f in _typed:
		out[f.id] = str(f.typeId)
	return out


func _on_selection() -> void:
	_mark_list()
	_gen += 1
	var gen := _gen
	var ids: Array = sel.ids.duplicate()
	if ids.is_empty():
		feats = {}
		_build_controls({}, {})
		sel.set_point_at(false)
		return
	var res: Dictionary = await Api.get_json("/api/fixtures/program/features?ids=" + ",".join(ids).uri_encode())
	var cur: Dictionary = await Api.get_json("/api/fixtures/program")
	if gen != _gen:
		return
	feats = res.data.get("fixtures", {}) if res.ok and res.data is Dictionary else {}
	var values: Dictionary = cur.data.get("values", {}) if cur.ok and cur.data is Dictionary else {}
	_build_controls(P.merge(feats, ids, _type_of()), values.get(ids[0], {}) if values.get(ids[0]) is Dictionary else {})
	_status.text = "%d selected." % ids.size() if res.ok else "Fixture engine not reporting — the Tracking module is off on the server."


## One programmer write for `ids`; merged with what is waiting, sent at most every 50 ms.
func _queue(ids: Array, values: Dictionary) -> void:
	if ids.is_empty() or values.is_empty():
		return
	var key := JSON.stringify(ids)
	if _pending.has(key):
		(_pending[key][1] as Dictionary).merge(values, true)
	else:
		_pending[key] = [ids, values.duplicate(true)]
	if _flush.is_stopped():
		_flush.start()


func _send() -> void:
	var batch := _pending
	_pending = {}
	for key in batch:
		Api.post_json("/api/fixtures/program", {"ids": batch[key][0], "values": batch[key][1]})


func _release(all: bool) -> void:
	_pending = {}
	if all:
		await Api.delete_json("/api/fixtures/program")
	else:
		for id in sel.ids:
			await Api.delete_json("/api/fixtures/program?id=" + str(id).uri_encode())
	_status.text = "Released %s — channels back to their defaults." % ("all fixtures" if all else "the selection")
	_on_selection()


## WO-691: the selected heads out of the patch (asks first). Their programmer values are released on the server.
func _ask_delete() -> void:
	var ids: Array = sel.ids.duplicate()
	if ids.is_empty():
		_status.text = "Select fixtures to delete (click them in the 3D view or in the list)."
		return
	_del_ids = ids
	var names: Array = _typed.filter(func(f: Dictionary) -> bool: return ids.has(f.id)).map(func(f: Dictionary) -> String: return f.name)
	_confirm_del.dialog_text = "Delete %s from the patch?" % (("\"%s\"" % names[0]) if ids.size() == 1 and names.size() == 1
		else "%d fixtures" % ids.size())
	_confirm_del.popup_centered()


func _delete() -> void:
	var ids: Array = _del_ids
	_del_ids = []
	var n := FM.delete_fixtures(Store.project, ids)
	if n == 0:
		return
	sel.set_ids(sel.ids.filter(func(id: String) -> bool: return not ids.has(id)))
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)
	for id in ids:
		Api.delete_json("/api/fixtures/program?id=" + str(id).uri_encode())
	_status.text = "Deleted %d fixture%s." % [n, "" if n == 1 else "s"]


func _aim(psn: Array) -> void:
	var res: Dictionary = await Api.post_json("/api/fixtures/program/aim", {"ids": sel.ids, "target": psn})
	if not res.ok or not res.data is Dictionary:
		_status.text = "Point at failed: %s" % res.get("error", "?")
		return
	var miss: Array = res.data.get("unreachable", [])
	await _on_selection()  # sliders follow
	_status.text = "Pointed %d at %.1f / %.1f m%s." % [(res.data.get("aimed", []) as Array).size(), psn[0], psn[1],
		"" if miss.is_empty() else " — %d cannot reach it" % miss.size()]


func _build_controls(m: Dictionary, v: Dictionary) -> void:
	merged = m
	for c in _controls.get_children():
		c.queue_free()
	if m.is_empty() or int(m.get("count", 0)) == 0:
		return
	var ids: Array = sel.ids.duplicate()
	if m.dimmer:
		_slider("Intensity", 0.0, 1.0, _norm(v.get("Dimmer"), 0.0), func(x: float) -> void: _queue(ids, {"Dimmer": {"norm": x}}), "%")
	if m.mix:
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = "Colour"
		l.custom_minimum_size.x = 70
		row.add_child(l)
		var pick := ColorPickerButton.new()
		pick.edit_alpha = false
		pick.color = Color.WHITE
		pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		pick.color_changed.connect(func(c: Color) -> void:
			for id in ids:
				_queue([id], P.color_values(feats.get(id, {}), c)))
		row.add_child(pick)
		_controls.add_child(row)
	if not (m.colors as Array).is_empty():
		_wheel(m.colors, "colors", ids)
	for spec in [["cto", "CTO"], ["pan", "Pan"], ["tilt", "Tilt"], ["zoom", "Zoom"]]:
		var r: Dictionary = m[spec[0]]
		if r.is_empty():
			continue
		var attr: String = str(r.get("attr", spec[1]))
		var lo := minf(float(r.from), float(r.to))
		var hi := maxf(float(r.from), float(r.to))
		var at: Variant = v.get(attr)  # programmed (physical), else the channel's GDTF default
		_slider(spec[1], lo, hi, float(at) if at is float or at is int else float(r.get("at", lo)),
			func(x: float) -> void: _queue(ids, {attr: snappedf(x, 0.01)}), "°" if spec[0] != "cto" else "K")
		if spec[0] == "tilt":
			var aim := CheckButton.new()
			aim.text = "Point at — click the stage floor"
			aim.button_pressed = sel.point_at
			aim.toggled.connect(func(on: bool) -> void: sel.set_point_at(on))
			_controls.add_child(aim)
	if not (m.gobos as Array).is_empty():
		_wheel(m.gobos, "gobos", ids)


func _norm(v: Variant, d: float) -> float:
	if v is Dictionary and v.has("norm"):
		return float(v.norm)
	return d


func _slider(label: String, lo: float, hi: float, at: float, on_change: Callable, unit: String) -> void:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = 70
	row.add_child(l)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 0.0
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.set_value_no_signal(clampf(at, lo, hi))
	var val := Label.new()
	val.custom_minimum_size.x = 56
	val.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	var show := func(x: float) -> void:
		val.text = "%d %%" % roundi(x * 100.0) if unit == "%" else "%.0f%s" % [x, unit]
	show.call(s.value)
	s.value_changed.connect(func(x: float) -> void:
		show.call(x)
		on_change.call(x))
	row.add_child(s)
	row.add_child(val)
	_controls.add_child(row)


## Colour swatches or gobo thumbnails; a pick goes only to the selected fixtures that have that slot.
func _wheel(slots: Array, kind: String, ids: Array) -> void:
	var flow := HFlowContainer.new()
	for s in slots:
		var b := Button.new()
		b.tooltip_text = str(s.name)
		b.custom_minimum_size = Vector2(36, 36)
		if kind == "colors":
			var rgb: Array = s.get("rgb", [1, 1, 1])
			var sb := StyleBoxFlat.new()
			sb.bg_color = Color(float(rgb[0]), float(rgb[1]), float(rgb[2]))
			sb.set_corner_radius_all(4)
			b.add_theme_stylebox_override("normal", sb)
		else:
			b.text = "" if str(s.get("media", "")) != "" else str(s.name).left(4)
			b.expand_icon = true
			_thumb(b, str(s.get("type", "")), str(s.get("media", "")))
		b.pressed.connect(func() -> void:
			for id in P.owners(feats, ids, kind, str(s.attr), str(s.name)):
				_queue([id], {str(s.attr): {"set": str(s.name)}}))
		flow.add_child(b)
	_controls.add_child(flow)


func _thumb(b: Button, type_id: String, media: String) -> void:
	if type_id == "" or media == "":
		return
	var key := "%s|%s" % [type_id, media]
	if not _thumbs.has(key):
		_thumbs[key] = null
		var res: Dictionary = await Api.get_bytes("/api/fixtures/types/%s/file?path=%s" % [type_id, ("wheels/%s.png" % media).uri_encode()])
		var img := Image.new()
		if res.ok and img.load_png_from_buffer(res.bytes) == OK:
			img.resize(48, 48, Image.INTERPOLATE_BILINEAR)
			_thumbs[key] = ImageTexture.create_from_image(img)
	if is_instance_valid(b):
		b.icon = _thumbs[key]


func _fill_groups() -> void:
	var p := _groups.get_popup()
	p.clear(true)
	var groups: Array = _slice().groups
	for i in groups.size():
		p.add_item("%s (%d)" % [groups[i].name, (groups[i].ids as Array).size()], i)
	if not groups.is_empty():
		p.add_separator()
	_auto = [Auto.by_position(_typed), Auto.by_address(_typed)]  # WO-680
	for k in 2:
		if not (_auto[k] as Array).is_empty():
			var sub := PopupMenu.new()
			for i in (_auto[k] as Array).size():
				sub.add_item("%s (%d)" % [_auto[k][i].name, (_auto[k][i].ids as Array).size()], 3000 + k * 1000 + i)
			sub.id_pressed.connect(_on_group)
			p.add_submenu_node_item(["By position", "By address"][k], sub)
	if not _typed.is_empty():
		p.add_separator()
	p.add_item("Save selection as group…", 1000)
	p.set_item_disabled(p.item_count - 1, sel.ids.is_empty())
	if not groups.is_empty():
		var del := PopupMenu.new()
		for i in groups.size():
			del.add_item(str(groups[i].name), 2000 + i)
		del.id_pressed.connect(_on_group)
		p.add_submenu_node_item("Forget group", del)


func _on_group(id: int) -> void:
	var s := _slice()
	if id == 1000:
		_name.text = ""
		_name_dialog.popup_centered(Vector2i(320, 90))
		_name.grab_focus()
	elif id >= 3000:
		var k := floori((id - 3000) / 1000.0)
		var i := (id - 3000) % 1000
		if k < _auto.size() and i < (_auto[k] as Array).size():
			sel.set_ids(_auto[k][i].ids)
	elif id >= 2000 and id - 2000 < s.groups.size():
		s.groups = P.drop_group(s.groups, s.groups[id - 2000].name)
		_persist(s)
	elif id < s.groups.size():
		sel.set_ids(s.groups[id].ids)


func _save_group() -> void:
	var name := _name.text.strip_edges()
	if name == "" or sel.ids.is_empty():
		return
	var s := _slice()
	s.groups = P.save_group(s.groups, name, sel.ids)
	_persist(s)
	_status.text = "Group \"%s\" saved (%d)." % [name, sel.ids.size()]


func _persist(slice: Dictionary) -> void:
	Store.project["fixtures"] = slice
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)
