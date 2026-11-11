extends VBoxContainer
## WO-1039 — PixelHue ▸ Inputs: Studio's Inputs tab (public/inputs.js) as a native panel. One row per input: port,
## capacity, name, EDID size / Hz / standard / scan. Edits are STAGED — changed rows are marked, "Fill selected"
## stages a bulk edit — and nothing is sent until "Apply inputs" (`PUT /api/inputs` {changes}); Studio's own sentence
## is shown afterwards. The Advanced section (inputs_advanced_view.gd) holds per-input signal settings, Mac tiles
## and detailed timing. Left out: EDID file import / export (raw file routes are not bridged to the client).

signal status(text: String)

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const M := preload("res://features/pixelhue/inputs_model.gd")
const Kit := preload("res://features/pixelhue/inputs_ui_kit.gd")
const Advanced := preload("res://features/pixelhue/inputs_advanced_view.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _state := {}
var _drafts := {}
var _checked := {}
var _busy := false
var _count_lbl: Label
var _help_lbl: Label
var _grid: GridContainer
var _bulk: HFlowContainer
var _bulk_port: OptionButton
var _bulk_cap: OptionButton
var _bulk_name: LineEdit
var _bulk_edid: OptionButton
var _all: CheckBox
var _dirty_lbl: Label
var _apply_btn: Button
var _discard_btn: Button
var _fill_btn: Button
var _msg: Label
var _adv: Advanced
var _adv_toggle: Button
var _row_marks := {}


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	add_child(scroll)
	var root := VBoxContainer.new()
	root.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	root.add_theme_constant_override("separation", 8)
	scroll.add_child(root)
	_count_lbl = Kit.muted("Not loaded", root)
	_help_lbl = Kit.muted("", root)
	_bulk = HFlowContainer.new()
	_bulk.add_theme_constant_override("h_separation", 12)
	root.add_child(_bulk)
	_grid = GridContainer.new()
	_grid.columns = 7
	_grid.add_theme_constant_override("h_separation", 14)
	_grid.add_theme_constant_override("v_separation", 8)
	root.add_child(_grid)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	_apply_btn = Kit.button("Apply inputs", _apply, bar)
	_discard_btn = Kit.button("Discard", func() -> void: refresh(true), bar)
	_dirty_lbl = Kit.muted("", bar)
	root.add_child(bar)
	_msg = Kit.muted("", root)
	_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_adv_toggle = Button.new()
	_adv_toggle.toggle_mode = true
	_adv_toggle.text = "Advanced"
	_adv_toggle.tooltip_text = "Per-input signal / image settings, Mac tiles and detailed timing"
	_adv_toggle.toggled.connect(_on_adv_toggled)
	root.add_child(_adv_toggle)
	_adv = Advanced.new()
	_adv.api = Api
	_adv.has_basic = func() -> bool: return M.pending(_state.get("inputs", []), _drafts).size() > 0
	_adv.status.connect(func(t: String) -> void: status.emit(t))
	_adv.busy_changed.connect(func(_on: bool) -> void: _controls())
	_adv.visible = false
	root.add_child(_adv)
	_render()


func _on_adv_toggled(on: bool) -> void:
	_adv.visible = on
	if on and not _adv.is_loaded():
		_adv.refresh()


## Header Refresh / tab shown. Staged edits survive (Studio asks before discarding); `force` = Discard.
func refresh(force := false) -> void:
	if _busy:
		return
	if not force and not _state.is_empty() and (M.pending(_state.get("inputs", []), _drafts).size() > 0 or _adv.has_changes()):
		_say("Pending input changes kept. Apply inputs, or press Discard to re-read.")
		return
	_set_busy(true)
	_say("Reading input ports and EDIDs…")
	var r: Dictionary = await StudioApi.read(Api, "inputs")
	_set_busy(false)
	if not r.ok:
		_say(str(r.error), true)
		return
	_adopt(r.data)
	_say("Inputs loaded.")
	if _adv_toggle.button_pressed:
		_adv.refresh(true)
	else:
		_adv.invalidate()


func _say(text: String, is_error := false) -> void:
	_msg.text = text
	_msg.add_theme_color_override("font_color", ThemeBuilder.ERROR if is_error else ThemeBuilder.TEXT_MUTED)
	status.emit(text)


func _set_busy(on: bool) -> void:
	_busy = on
	_controls()


func _adopt(next: Dictionary) -> void:
	_state = next
	var rows: Array = next.get("inputs", [])
	_drafts = M.drafts_for(rows)
	_checked = {}
	for r: Variant in rows:
		_checked[str((r as Dictionary).key)] = true
	_render()


func _pending() -> Array:
	return M.pending(_state.get("inputs", []), _drafts)


func _apply() -> void:
	if _busy:
		return
	if _adv.has_changes():
		_say("Apply or discard the pending Advanced input settings first.", true)
		return
	var changes := _pending()
	var bad := M.validate(_state.get("inputs", []), changes)
	if bad != "":
		_say(bad, true)
		return
	_set_busy(true)
	_say("Applying inputs…")
	var r: Dictionary = await StudioApi.write(Api, "inputs", {"changes": changes})
	_set_busy(false)
	if not r.ok:
		_say(str(r.error), true)
		return
	_adopt(r.data)
	_adv.invalidate()
	_say(M.applied_sentence())
	if _adv_toggle.button_pressed:
		_adv.refresh(true)


func _controls() -> void:
	if _apply_btn == null:
		return
	var n := _pending().size()
	_dirty_lbl.text = M.dirty_label(n)
	_dirty_lbl.add_theme_color_override("font_color", ThemeBuilder.WARN if n > 0 else ThemeBuilder.TEXT_MUTED)
	_apply_btn.disabled = _busy or n == 0
	_apply_btn.text = "Working…" if _busy else "Apply inputs"
	_discard_btn.disabled = _busy or (n == 0 and not _adv.has_changes())
	if _fill_btn != null:
		_fill_btn.disabled = _busy or _checked.is_empty()
	var rows: Array = _state.get("inputs", [])
	if _all != null:
		_all.disabled = _busy or rows.is_empty()
		_all.set_pressed_no_signal(_checked.size() == rows.size() and not rows.is_empty())
	var changed := {}
	for c: Dictionary in _pending():
		changed[str(c.key)] = true
	for k: Variant in _row_marks:
		(_row_marks[k] as Label).text = "● pending" if changed.has(k) else ""


func _render() -> void:
	Kit.clear(_bulk)
	Kit.clear(_grid)
	_row_marks = {}
	_fill_btn = null
	_all = null
	var rows: Array = _state.get("inputs", [])
	_count_lbl.text = M.counts_label(_state)
	_help_lbl.text = M.help_text(_state)
	if rows.is_empty():
		_grid.columns = 1
		var model := str((_state.get("device", {}) as Dictionary).get("model", ""))
		Kit.muted(("No supported %s inputs were returned. Refresh after the device is ready." % model) if not _state.is_empty() else "Connect to a device, then refresh inputs.", _grid)
		_controls()
		return
	_grid.columns = 7
	_build_bulk(rows)
	for h in ["Input", "Port", "Capacity", "Name", "EDID size", "Refresh Hz", "Standard / scan"]:
		Kit.muted(h, _grid)
	for row: Variant in rows:
		_row_ui(row as Dictionary)
	_controls()


func _build_bulk(rows: Array) -> void:
	_all = CheckBox.new()
	_all.text = "Select all"
	_all.button_pressed = true
	_all.toggled.connect(func(on: bool) -> void:
		_checked = {}
		if on:
			for r: Variant in rows:
				_checked[str((r as Dictionary).key)] = true
		_render())
	_bulk.add_child(_all)
	var fixed: bool = rows.all(func(r: Dictionary) -> bool: return bool(r.get("fixedPort", false)))
	_bulk_port = Kit.option([["", "Keep port"], ["hdmi", "HDMI"], ["dp", "DP"]], "", "Inputs use the physical ports on their installed cards" if fixed else "Choose the HDMI or DP port", func(_v: Variant) -> void: pass)
	_bulk_port.disabled = fixed
	_bulk.add_child(Kit.labelled("Port", _bulk_port))
	var caps: Array = [["", "Keep capacity"]]
	for c: Variant in _state.get("capacityChoices", []):
		caps.append([str(int(c)), M.capacity_label(c)])
	_bulk_cap = Kit.option(caps, "", "Capacity for the selected inputs", func(_v: Variant) -> void: pass)
	_bulk.add_child(Kit.labelled("Capacity", _bulk_cap))
	_bulk_name = LineEdit.new()
	_bulk_name.placeholder_text = "Name, {n} = input number"
	_bulk_name.max_length = 32
	_bulk_name.custom_minimum_size.x = 170
	_bulk.add_child(Kit.labelled("Name", _bulk_name))
	_bulk_edid = Kit.option(M.PRESETS, "", "EDID preset for the selected HDMI/DP inputs", func(_v: Variant) -> void: pass)
	_bulk.add_child(Kit.labelled("EDID", _bulk_edid))
	_fill_btn = Kit.button("Fill selected", _fill)
	_bulk.add_child(_fill_btn)


func _fill() -> void:
	if _busy or _state.is_empty():
		return
	var cap := str(Kit.selected_value(_bulk_cap))
	M.fill(_state.inputs, _drafts, _checked, str(Kit.selected_value(_bulk_port)), cap, _bulk_name.text, str(Kit.selected_value(_bulk_edid)))
	_render()
	_say("Selected rows updated. Apply inputs to save.")


func _row_ui(row: Dictionary) -> void:
	var key := str(row.key)
	var d: Dictionary = _drafts[key]
	var port := M.find_port(row, str(d.portKey))
	# Input: checkbox, location, pending mark
	var c0 := VBoxContainer.new()
	var cb := CheckBox.new()
	cb.text = str(row.label)
	cb.button_pressed = _checked.has(key)
	cb.toggled.connect(func(on: bool) -> void:
		if on:
			_checked[key] = true
		else:
			_checked.erase(key)
		_controls())
	c0.add_child(cb)
	Kit.muted(str(row.get("location", "")), c0)
	_row_marks[key] = Kit.muted("", c0)
	(_row_marks[key] as Label).add_theme_color_override("font_color", ThemeBuilder.WARN)
	_grid.add_child(c0)
	# Port
	var c1 := VBoxContainer.new()
	var ports: Array = []
	if bool(row.get("fixedPort", false)):
		ports = [[d.portKey, str(port.get("label", ""))]]
	else:
		ports = [["", "Select a port"]]
		for p: Variant in row.get("ports", []):
			ports.append([(p as Dictionary).key, (p as Dictionary).label])
	var ps := Kit.option(ports, d.portKey, "%s port" % row.label, func(v: Variant) -> void:
		M.choose_port(row, d, str(v))
		_render())
	ps.disabled = bool(row.get("fixedPort", false))
	c1.add_child(ps)
	Kit.muted(M.port_signal(port), c1)
	_grid.add_child(c1)
	# Capacity
	var editable := bool(row.get("capacityEditable", false))
	var choices: Array = row.get("capacityChoices", [])
	var cap_opts: Array = []
	if editable:
		for v: Variant in choices:
			cap_opts.append([int(v), M.capacity_label(v)])
		if not M.has_num(choices, float(d.capacity)):
			cap_opts.push_front([d.capacity, "Current: %s" % M.capacity_label(d.capacity)])
	else:
		cap_opts = [[d.capacity, M.capacity_label(d.capacity)]]
	var cs := Kit.option(cap_opts, d.capacity, "%s capacity" % row.label, func(v: Variant) -> void:
		d.capacity = int(v)
		_controls())
	cs.disabled = not editable
	_grid.add_child(cs)
	# Name
	var c3 := VBoxContainer.new()
	var name := LineEdit.new()
	name.text = str(d.name)
	name.max_length = 32
	name.placeholder_text = str(row.label)
	name.custom_minimum_size.x = 150
	name.text_changed.connect(func(t: String) -> void:
		d.name = t
		d.nameTouched = true
		_controls())
	c3.add_child(name)
	Kit.muted(("Interface %d" % int(port.id)) if port.get("id") != null else "ID available when port is enabled", c3)
	_grid.add_child(c3)
	if not bool(row.get("supportsEdid", false)):
		var note := VBoxContainer.new()
		Kit.muted("SDI uses source timing." if row.get("family") == "SDI" else "EDID editing is unavailable for this connector.", note)
		Kit.muted(str(port.get("signal", "No signal data")), note)
		_grid.add_child(note)
		_grid.add_child(Control.new())
		_grid.add_child(Control.new())
		return
	_edid_cells(row, d, port)


func _edid_cells(row: Dictionary, d: Dictionary, port: Dictionary) -> void:
	var touch := func(k: String, v: Variant) -> void:
		d.edid[k] = v
		d.edidTouched = true
		_controls()
	var c4 := VBoxContainer.new()
	var size := HBoxContainer.new()
	for k in ["width", "height"]:
		if k == "height":
			Kit.muted("×", size)
		size.add_child(Kit.number(d.edid.get(k), "%s EDID %s (64–8192)" % [row.label, k], true, 64, 8192, func(v: float) -> void: touch.call(k, int(v)), 64))
	c4.add_child(size)
	c4.add_child(Kit.option(M.PRESETS, "", "%s EDID preset" % row.label, func(v: Variant) -> void:
		M.apply_preset(d, str(v))
		_render()))
	var note := M.edid_note(port, bool(d.edidTouched))
	if note != "":
		Kit.muted(note, c4)
	_grid.add_child(c4)
	_grid.add_child(Kit.number(d.edid.get("frame"), "%s EDID Hz (1–240)" % row.label, false, 1, 240, func(v: float) -> void: touch.call("frame", v)))
	var c6 := VBoxContainer.new()
	c6.add_child(Kit.option(M.STANDARDS, d.edid.get("standardType"), "%s EDID standard" % row.label, func(v: Variant) -> void: touch.call("standardType", int(v))))
	c6.add_child(Kit.option(M.SCANS, d.edid.get("interlaced"), "%s scan" % row.label, func(v: Variant) -> void: touch.call("interlaced", int(v))))
	_grid.add_child(c6)
