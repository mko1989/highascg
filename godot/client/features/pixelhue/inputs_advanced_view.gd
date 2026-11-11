extends VBoxContainer
## WO-1039 — Inputs ▸ Advanced (Studio public/input-advanced.js + the detailed-timing part of input-edid-ui.js):
## one input at a time: signal / colour / image-quality settings, Mac tile position, detailed timing, bulk Mac
## compatibility and 1 × 2 Mac tiled groups. Edits are staged; "Apply advanced input" writes. EDID file import /
## export is left out (raw file routes are not bridged).

signal status(text: String)
signal busy_changed(on: bool)

const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const A := preload("res://features/pixelhue/inputs_adv_model.gd")
const Kit := preload("res://features/pixelhue/inputs_ui_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var api: Variant = null
## Callable() -> bool: are basic input edits pending? (Studio blocks advanced writes then.)
var has_basic: Callable = func() -> bool: return false

var _state := {}
var _selected: Variant = null
var _values := {}
var _mosaic := {}
var _timing := {}
var _pair_touched := false
var _busy := false
var _loaded := false
var _body: VBoxContainer
var _pending_lbl: Label
var _save: Button
var _msg: Label
var _tile := {"left": null, "right": null, "group": 1, "compat": true}


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 8)
	add_child(_body)
	_render()


func is_loaded() -> bool:
	return _loaded


func has_changes() -> bool:
	return A.pending_count(_row(), _values, _mosaic) > 0 or _pair_touched


func invalidate() -> void:
	_state = {}
	_selected = null
	_values = {}
	_mosaic = {}
	_pair_touched = false
	_loaded = false
	_render()


func _row() -> Dictionary:
	return A.find_input(_state, _selected)


func _say(text: String, is_error := false) -> void:
	if _msg != null:
		_msg.text = text
		_msg.add_theme_color_override("font_color", ThemeBuilder.ERROR if is_error else ThemeBuilder.TEXT_MUTED)
	status.emit(text)


func _set_busy(on: bool) -> void:
	_busy = on
	busy_changed.emit(on)
	_render()


## Re-read from the switcher; staged advanced edits are dropped (the Discard path), `force` false keeps them.
func refresh(force := false) -> void:
	if _busy or api == null:
		return
	if has_changes() and not force:
		_say("Pending Advanced input settings kept. Apply them or press Refresh advanced to discard.")
		return
	_set_busy(true)
	var r: Dictionary = await StudioApi.read(api, "input-advanced")
	if not r.ok:
		_busy = false
		busy_changed.emit(false)
		_say(str(r.error), true)
		_render()
		return
	_adopt(r.data)
	_busy = false
	busy_changed.emit(false)
	_render()


func _adopt(next: Dictionary) -> void:
	_state = next
	_loaded = true
	_pair_touched = false
	var rows: Array = next.get("inputs", [])
	if A.find_input(next, _selected).is_empty():
		_selected = (rows[0] as Dictionary).get("id") if not rows.is_empty() else null
	_choose(_selected)


func _choose(id: Variant) -> void:
	_selected = id
	var row := _row()
	_values = (row.get("values", {}) as Dictionary).duplicate(true)
	_mosaic = (row.get("mosaic", {}) as Dictionary).duplicate(true)
	_timing = (row.get("timing", {}) as Dictionary).duplicate(true) if row.get("timing") is Dictionary else {}
	_tile.group = A.free_group(_state)
	var mi := A.mosaic_inputs(_state)
	_tile.left = (mi[0] as Dictionary).id if mi.size() > 0 else null
	_tile.right = (mi[1] as Dictionary).id if mi.size() > 1 else null


func _apply(changes: Array, selected_draft := false) -> void:
	if not selected_draft and A.pending_count(_row(), _values, _mosaic) > 0:
		_say("Apply or discard the selected input’s pending Advanced settings first.", true)
		return
	if has_basic.call():
		_say("Apply or discard the pending input port/EDID settings first.", true)
		return
	var bad := A.validate_changes(_state, changes)
	if bad != "":
		_say(bad, true)
		return
	_set_busy(true)
	_say("Applying advanced input settings…")
	var r: Dictionary = await StudioApi.write(api, "input-advanced", {"changes": changes})
	_finish(r, "Advanced input settings saved.")


func _apply_timing() -> void:
	var bad := A.validate_timing(_timing)
	if bad != "":
		_say(bad, true)
		return
	_set_busy(true)
	_say("Applying detailed timing…")
	var r: Dictionary = await StudioApi.write(api, "input-timing", A.timing_body(_selected, _timing))
	_finish(r, "Detailed timing saved.")


func _finish(r: Dictionary, ok_text: String) -> void:
	_busy = false
	busy_changed.emit(false)
	if r.ok:
		_adopt(r.data)
		_say(ok_text)
	else:
		_say(str(r.error), true)
	_render()


func _refresh_pending() -> void:
	var n := A.pending_count(_row(), _values, _mosaic)
	if _pending_lbl != null:
		_pending_lbl.text = A.pending_label(n)
	if _save != null:
		_save.disabled = _busy or n == 0


func _render() -> void:
	if _body == null:
		return
	Kit.clear(_body)
	_pending_lbl = null
	_save = null
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 8)
	Kit.heading("Advanced", head)
	Kit.button("Refresh advanced", func() -> void: refresh(true), head).disabled = _busy
	_body.add_child(head)
	_msg = Kit.muted("")
	_body.add_child(_msg)
	if _state.is_empty():
		Kit.muted("Connect a device to load Advanced input settings.", _body)
		return
	var rows: Array = _state.get("inputs", [])
	var picks: Array = rows.map(func(i: Dictionary) -> Array: return [i.id, A.input_title(i)])
	if not picks.is_empty():
		var picker := Kit.option(picks, _selected, "Advanced input", _on_pick)
		picker.disabled = _busy
		_body.add_child(picker)
	var row := _row()
	if row.is_empty():
		Kit.muted("No active input connectors were returned.", _body)
		return
	_fields(row)
	_actions(row)
	if row.get("timing") is Dictionary and not _timing.is_empty():
		_timing_ui()
	_compat_ui()
	_tiles_ui()
	_refresh_pending()


func _on_pick(id: Variant) -> void:
	if has_changes():
		_say("Pending Advanced settings dropped for the other input.")
	_pair_touched = false
	_choose(id)
	_render()


func _fields(row: Dictionary) -> void:
	var sections := {}
	for f: Variant in row.get("fields", []):
		if not (f is Dictionary):
			continue
		var sec := str(f.section)
		if not sections.has(sec):
			var box := VBoxContainer.new()
			Kit.heading(sec, box)
			var g := HFlowContainer.new()
			g.add_theme_constant_override("h_separation", 14)
			box.add_child(g)
			_body.add_child(box)
			sections[sec] = g
		var key := str(f.key)
		var on_set := func(v: Variant) -> void:
			_values[key] = float(v)
			_refresh_pending()
		var ctl: Control
		if f.has("options"):
			ctl = Kit.option(f.options, _values.get(key), str(f.label), on_set)
			(ctl as OptionButton).disabled = _busy
		else:
			var step := float(f.get("step", 1))
			ctl = Kit.number(_values.get(key), "%s (%s–%s, step %s)" % [f.label, f.get("min"), f.get("max"), step],
				step == 1.0, float(f.get("min", 0)), float(f.get("max", 0)), on_set)
			(ctl as LineEdit).editable = not _busy
		(sections[sec] as Control).add_child(Kit.labelled(str(f.label), ctl))
	if (row.get("fields", []) as Array).is_empty():
		Kit.muted("No editable Advanced settings were advertised for this connector.", _body)
	if bool(row.get("mosaicSupported", false)):
		var h := HFlowContainer.new()
		h.add_theme_constant_override("h_separation", 14)
		var side := Kit.option([["none", "Off"], ["left", "Left"], ["right", "Right"]], _mosaic.get("side"), "Mac tile position", func(v: Variant) -> void:
			A.set_side(_mosaic, str(v))
			_render())
		var groups: Array = []
		for i in 17:
			groups.append([i, "Group %d" % i if i > 0 else "None"])
		var grp := Kit.option(groups, _mosaic.get("group", 0), "Mac tile group", func(v: Variant) -> void:
			A.set_group(_mosaic, int(v))
			_render())
		h.add_child(Kit.labelled("Mac tile position", side))
		h.add_child(Kit.labelled("Group", grp))
		_body.add_child(h)


func _actions(row: Dictionary) -> void:
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 10)
	_save = Kit.button("Apply advanced input", func() -> void: _apply([A.change_for(row, _values, _mosaic)], true), bar)
	_pending_lbl = Kit.muted("", bar)
	if A.has_defaults(row):
		var reset := func() -> void:
			A.reset_quality(row, _values)
			_render()
		Kit.button("Reset image quality", reset, bar).disabled = _busy
	_body.add_child(bar)


func _timing_ui() -> void:
	var box := VBoxContainer.new()
	Kit.heading("Detailed timing", box)
	var g := HFlowContainer.new()
	g.add_theme_constant_override("h_separation", 14)
	var info := Kit.muted("")
	var apply := Button.new()
	var upd := func() -> void:
		info.text = A.timing_info(_timing)
		apply.disabled = _busy or not A.timing_ok(_timing)
	g.add_child(Kit.labelled("Refresh Hz", Kit.number(_timing.get("refresh"), "Timing refresh Hz (1–240)", false, 1, 240, func(v: float) -> void:
		_timing["refresh"] = v
		upd.call())))
	for ax in A.AXES:
		var a: Dictionary = (_timing[ax[0]] as Dictionary)
		var s: String = ax[1]
		var defs := [["active", "active", 64, 16384], ["front", "front porch", 0, 8192], ["sync", "sync", 1, 8192], ["total", "total", 64, 32768]]
		for d in defs:
			var k: String = d[0]
			g.add_child(Kit.labelled("%s %s" % [s, d[1]], Kit.number(a.get(k), "Timing %s %s" % [s, d[1]], true, d[2], d[3], func(v: float) -> void:
				a[k] = int(v)
				upd.call())))
		var pol := Kit.option([[1, "Positive"], [0, "Negative"]], a.get("polarity"), "Timing %s sync polarity" % s, func(v: Variant) -> void: a["polarity"] = int(v))
		g.add_child(Kit.labelled("%s sync polarity" % s, pol))
	box.add_child(g)
	box.add_child(info)
	apply.text = "Apply detailed timing"
	apply.pressed.connect(_apply_timing)
	box.add_child(apply)
	upd.call()
	_body.add_child(box)


func _compat_ui() -> void:
	if A.compat_inputs(_state).is_empty():
		return
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	var mode := Kit.option([[1, "On"], [0, "Off"]], 1, "Bulk Mac compatibility", func(_v: Variant) -> void: pass)
	h.add_child(Kit.labelled("Mac compatibility", mode))
	var run := func() -> void: _apply(A.compat_changes(_state, int(Kit.selected_value(mode))))
	var b := Kit.button("Apply Mac mode to all supported inputs", run, h)
	b.disabled = _busy
	_body.add_child(h)


func _tiles_ui() -> void:
	var inputs := A.mosaic_inputs(_state)
	if inputs.is_empty():
		return
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	Kit.heading("Mac tiled groups · 1 × 2", box)
	Kit.muted("Use matching connector types and detailed EDID timings. These are the Mac display tiles, separate from Programming layer groups.", box).autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var names: Array = inputs.map(func(i: Dictionary) -> Array: return [i.id, i.name])
	var groups: Array = []
	for n in range(1, 17):
		groups.append([n, "Group %d" % n])
	var h := HFlowContainer.new()
	h.add_theme_constant_override("h_separation", 14)
	var touch := func() -> void: _pair_touched = true
	h.add_child(Kit.labelled("Left", Kit.option(names, _tile.left, "Left tile input", func(v: Variant) -> void:
		_tile.left = v
		touch.call())))
	h.add_child(Kit.labelled("Right", Kit.option(names, _tile.right, "Right tile input", func(v: Variant) -> void:
		_tile.right = v
		touch.call())))
	h.add_child(Kit.labelled("Group", Kit.option(groups, _tile.group, "New tile group", func(v: Variant) -> void:
		_tile.group = int(v)
		touch.call())))
	var cb := CheckBox.new()
	cb.text = "Mac compatibility on"
	cb.button_pressed = bool(_tile.compat)
	cb.toggled.connect(func(on: bool) -> void:
		_tile.compat = on
		touch.call())
	h.add_child(cb)
	var pair := func() -> void:
		if _tile.left == _tile.right:
			_say("Choose two different inputs for the tiled pair.", true)
			return
		_apply(A.pair_changes(int(_tile.left), int(_tile.right), int(_tile.group), bool(_tile.compat)))
	var go := Kit.button("Apply tiled pair", pair, h)
	go.disabled = _busy
	box.add_child(h)
	for n in A.used_groups(_state):
		var r := HBoxContainer.new()
		r.add_theme_constant_override("separation", 10)
		Kit.muted(A.group_label(_state, n), r)
		var rm := Kit.button("Remove tile group %d" % n, func() -> void: _apply(A.remove_group_changes(_state, n)), r)
		rm.disabled = _busy
		box.add_child(r)
	_body.add_child(box)
