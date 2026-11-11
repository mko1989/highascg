extends VBoxContainer
## WO-1039 — PixelHue ▸ Outputs (Studio outputs-ui.js): output-card capacity, bulk fill, per-port table (name, timing /
## resolution, Hz, depth, HDCP, pattern), Apply; plus the Advanced section (outputs_advanced.gd).
## Long preset lists (50–250 per output) are put into a menu only when it opens.

signal status(text: String)

const M := preload("res://features/pixelhue/outputs_model.gd")
const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const NF := preload("res://core/numeric_field.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const Advanced := preload("res://features/pixelhue/outputs_advanced.gd")

var _state: Dictionary = {}
var _drafts := {}
var _checked := {}
var _busy := false
var _box: VBoxContainer
var _dirty: Label
var _save: Button
var _adv: Advanced
# bulk widgets
var _b_name: LineEdit
var _b_time: OptionButton
var _b_depth: OptionButton
var _b_hdcp: OptionButton


func _ready() -> void:
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	add_child(sc)
	var inner := VBoxContainer.new()
	inner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	inner.add_theme_constant_override("separation", 10)
	sc.add_child(inner)
	_box = VBoxContainer.new()
	_box.add_theme_constant_override("separation", 10)
	inner.add_child(_box)
	_adv = Advanced.new()
	_adv.status.connect(func(t: String) -> void: status.emit(t))
	inner.add_child(_adv)
	var foot := HBoxContainer.new()
	foot.add_theme_constant_override("separation", 12)
	_dirty = Label.new()
	_dirty.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_dirty.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(_dirty)
	_save = Kit.button(foot, "Apply outputs", _on_apply)
	add_child(foot)
	_render()


func refresh() -> void:
	var r: Dictionary = await StudioApi.read(Api, "outputs")
	if not r.ok:
		status.emit(str(r.error))
		return
	_adopt(r.data)
	_adv.refresh()


func _adopt(data: Dictionary) -> void:
	_state = data
	_drafts = M.make_drafts(data.get("outputs", []))
	_checked = {}
	for o in data.get("outputs", []):
		_checked[int(o.id)] = true
	_render()


func _pending() -> Array:
	return M.pending(_state.get("outputs", []), _drafts)


func _controls() -> void:
	var n := _pending().size()
	_dirty.text = "%d pending %s" % [n, "change" if n == 1 else "changes"] if n > 0 else "No pending changes"
	_save.disabled = _busy or n == 0


func _lbl(t: String, muted := false) -> Label:
	var l := Label.new()
	l.text = t
	if muted:
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _render() -> void:
	for c in _box.get_children():
		c.queue_free()
	if _state.is_empty():
		_box.add_child(_lbl("Connect a device to load its outputs.", true))
		_controls()
		return
	var outs: Array = _state.outputs
	_box.add_child(_lbl("%d physical ports" % outs.size(), true))
	for g in _state.get("capacityGroups", []):
		_capacity(g)
	_bulk(outs)
	_table(outs)
	Kit.note(_box, "Copy ports retain their routing. Timing changes apply to primary ports.")
	_controls()


func _capacity(g: Dictionary) -> void:
	var r := Kit.row(_box)
	r.add_child(_lbl("P20 HDMI output capacity · Slot %d" % int(g.slotId)))
	var ob := OptionButton.new()
	var opts := M.capacity_options(g)
	for i in opts.size():
		ob.add_item(str(opts[i].text), int(opts[i].value))
		if g.get("capacity") != null and int(g.capacity) == int(opts[i].value):
			ob.select(i)
	r.add_child(ob)
	var sum := _lbl("", true)
	var describe := func() -> void: sum.text = M.capacity_summary(g, ob.get_selected_id())
	describe.call()
	ob.item_selected.connect(func(_i: int) -> void: describe.call())
	Kit.button(r, "Apply output capacity", func() -> void:
		var v := ob.get_selected_id()
		var why := M.capacity_block(g, v, _pending().size())
		if why != "":
			status.emit(why)
			return
		Kit.confirm(self, M.capacity_confirm_text(g, v), func() -> void:
			var res: Dictionary = await StudioApi.write(Api, "output-capacity", M.capacity_body(g, v))
			if res.ok:
				_adopt(res.data)
				_adv.refresh()
				status.emit("Output capacity and copy relationships saved. Refresh Screens to inspect the current configuration.")
			else:
				status.emit(str(res.error))))
	_box.add_child(sum)


## A menu that holds one line until it opens; `fill` puts the full list in then. Items carry their key as metadata.
func _lazy_menu(current: String, items: Callable, on_pick: Callable) -> OptionButton:
	var ob := OptionButton.new()
	ob.fit_to_longest_item = false
	ob.clip_text = true
	ob.custom_minimum_size.x = 190
	ob.add_item(current)
	var filled := [false]
	ob.get_popup().about_to_popup.connect(func() -> void:
		if filled[0]:
			return
		filled[0] = true
		var cur := ob.get_item_text(0)
		ob.clear()
		var sel := 0
		var list: Array = items.call()
		for i in list.size():
			ob.add_item(str(list[i][1]))
			ob.set_item_metadata(i, list[i][0])
			if str(list[i][1]) == cur:
				sel = i
		ob.select(sel))
	ob.item_selected.connect(func(i: int) -> void:
		if filled[0]:
			on_pick.call(ob.get_item_metadata(i)))
	return ob


func _bulk(outs: Array) -> void:
	var r := Kit.row(_box)
	var all := CheckBox.new()
	all.text = "All"
	all.button_pressed = _checked.size() == outs.size()
	all.toggled.connect(func(on: bool) -> void:
		_checked = {}
		if on:
			for o in outs:
				_checked[int(o.id)] = true
		_render())
	r.add_child(all)
	_b_name = LineEdit.new()
	_b_name.placeholder_text = "Output {n}"
	_b_name.max_length = 32
	_b_name.custom_minimum_size.x = 130
	r.add_child(_lbl("Name pattern"))
	r.add_child(_b_name)
	r.add_child(_lbl("Timing"))
	_b_time = _lazy_menu("Keep timing", func() -> Array:
		var l: Array = [["", "Keep timing"]]
		for p in M.bulk_presets(outs):
			l.append([p.key, p.label])
		return l, func(_k: Variant) -> void: pass)
	r.add_child(_b_time)
	r.add_child(_lbl("Depth"))
	_b_depth = _simple(["Keep depth", "8 bit", "10 bit", "12 bit"])
	r.add_child(_b_depth)
	r.add_child(_lbl("HDCP"))
	_b_hdcp = _simple(["Keep HDCP", "Off", "On"])
	r.add_child(_b_hdcp)
	Kit.button(r, "Fill selected", func() -> void:
		var key := ""
		if _b_time.selected >= 0 and _b_time.get_item_metadata(_b_time.selected) != null:
			key = str(_b_time.get_item_metadata(_b_time.selected))
		var depth := -1 if _b_depth.selected <= 0 else int(M.DEPTHS[_b_depth.selected - 1])
		var hd := _b_hdcp.selected - 1
		var skipped := M.bulk_fill(outs, _drafts, _checked, _b_name.text, key, depth, hd)
		_render()
		if skipped > 0:
			status.emit("%d selected output(s) do not support this standard timing at their current capacity." % skipped))


func _simple(items: Array) -> OptionButton:
	var ob := OptionButton.new()
	for s in items:
		ob.add_item(str(s))
	return ob


func _table(outs: Array) -> void:
	var g := GridContainer.new()
	g.columns = 8
	g.add_theme_constant_override("h_separation", 14)
	g.add_theme_constant_override("v_separation", 8)
	_box.add_child(g)
	for h in ["Port", "Capacity", "Name", "Output timing", "Hz", "Depth", "HDCP", "Pattern"]:
		g.add_child(_lbl(h, true))
	for row in outs:
		_row(g, row)


func _row(g: GridContainer, row: Dictionary) -> void:
	var id := int(row.id)
	var d: Dictionary = _drafts[id]
	var pc := VBoxContainer.new()
	var cb := CheckBox.new()
	cb.text = M.port_title(row)
	cb.button_pressed = _checked.has(id)
	cb.toggled.connect(func(on: bool) -> void:
		if on:
			_checked[id] = true
		else:
			_checked.erase(id))
	pc.add_child(cb)
	pc.add_child(_lbl(M.port_sub(_state, row), true))
	g.add_child(pc)
	g.add_child(_lbl(M.capacity_name(row.get("capacity"))))
	var nc := VBoxContainer.new()
	var ne := LineEdit.new()
	ne.text = str(d.get("name", ""))
	ne.max_length = 32
	ne.custom_minimum_size.x = 140
	ne.text_changed.connect(func(t: String) -> void:
		d["name"] = t
		_controls())
	nc.add_child(ne)
	nc.add_child(_lbl(str(row.get("screen", "")) if str(row.get("screen", "")) != "" else "Unassigned", true))
	g.add_child(nc)
	if d.get("timing") is Dictionary:
		_timing_cells(g, row, d)
	else:
		g.add_child(_lbl("Device-managed"))
		g.add_child(_lbl("—"))
	g.add_child(_depth_ob(row, d))
	g.add_child(_flag_ob(row, d, "hdcp"))
	g.add_child(_flag_ob(row, d, "testPattern"))


func _timing_cells(g: GridContainer, row: Dictionary, d: Dictionary) -> void:
	var editable: bool = row.get("timingEditable") == true
	var tc := VBoxContainer.new()
	var pre := _lazy_menu(M.timing_label(row, d), func() -> Array:
		var l: Array = [["custom", "Custom"]]
		for p in row.get("presets", []):
			l.append([p.key, p.label])
		return l, func(k: Variant) -> void:
			M.set_preset(row, d, str(k))
			_render())
	pre.disabled = not editable
	tc.add_child(pre)
	var dims := HBoxContainer.new()
	var hz := LineEdit.new()
	for key in ["width", "height"]:
		var lim: Dictionary = (row.get("limits", {}) as Dictionary).get(key, {})
		var le := LineEdit.new()
		NF.math_line(le, true, float(lim.get("min", 64)), float(lim.get("max", 16384)))
		le.text = str(int(d.timing.get(key, 0)))
		le.custom_minimum_size.x = 64
		le.editable = editable
		var commit := func(_t: Variant = "") -> void:
			if int(le.text) == int(d.timing.get(key, 0)):
				return
			M.set_custom_dimension(d, key, float(le.text))
			pre.set_item_text(0, "Custom")
			_controls()
		le.text_submitted.connect(commit)
		le.focus_exited.connect(commit)
		dims.add_child(le)
	tc.add_child(dims)
	tc.add_child(_lbl("Standard preset or custom dimensions" if editable else "Timing follows primary port", true))
	g.add_child(tc)
	NF.math_line(hz, false, 1.0, 240.0)
	hz.text = NF.fmt(float(d.timing.get("frame", 0)), false)
	hz.custom_minimum_size.x = 64
	hz.editable = editable
	var hz_commit := func(_t: Variant = "") -> void:
		if absf(float(hz.text) - float(d.timing.get("frame", 0))) < 1e-9:
			return
		M.set_custom_dimension(d, "frame", float(hz.text))
		pre.set_item_text(0, "Custom")
		_controls()
	hz.text_submitted.connect(hz_commit)
	hz.focus_exited.connect(hz_commit)
	g.add_child(hz)


func _depth_ob(row: Dictionary, d: Dictionary) -> OptionButton:
	var ob := _simple(["8 bit", "10 bit", "12 bit"])
	var cur: Variant = d.get("colorDepth")
	if cur != null and int(cur) == 255:
		ob.add_item("Auto")
		ob.select(3)
	elif cur != null:
		ob.select(maxi(0, M.DEPTHS.find(int(cur))))
	ob.disabled = row.get("colorDepth") == null
	ob.item_selected.connect(func(i: int) -> void:
		if i < 3:
			d["colorDepth"] = M.DEPTHS[i]
			_controls())
	return ob


func _flag_ob(row: Dictionary, d: Dictionary, key: String) -> OptionButton:
	var ob := _simple(["Off", "On"])
	ob.select(1 if d.get(key) != null and int(d[key]) == 1 else 0)
	ob.disabled = row.get(key) == null
	ob.item_selected.connect(func(i: int) -> void:
		d[key] = i
		_controls())
	return ob


func _on_apply() -> void:
	var changes := _pending()
	var why := M.validate(_state, changes)
	if why != "":
		status.emit(why)
		return
	var go := func() -> void:
		_busy = true
		_controls()
		var r: Dictionary = await StudioApi.write(Api, "outputs", M.outputs_body(_state, changes))
		_busy = false
		if r.ok:
			_adopt(r.data)
			status.emit("Outputs saved.")
		else:
			status.emit(str(r.error))
			_controls()
	if M.interrupts_signal(changes):
		Kit.confirm(self, "Changing output timing or colour depth can blank the output while it re-locks, resize or reset screen configuration, or affect synchronization. Continue?", go)
	else:
		go.call()
