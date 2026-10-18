extends VBoxContainer
## WO-601 — global border inspector (web inspector-global-border*.js, minus Art-Net — Part B), opened from a deck
## column's "Border". Thin client: every edit goes to POST /api/scene/global-border (WO-585 + WO-601 slot edits),
## which applies the web's slot rules, puts it on air (PGM 998/996 or the PRV mirror 997) and persists; the reply's
## slot replaces `project.scenes.globalBorders[screen]` locally so a later autosave cannot revert it.
## Edits coalesce: one request in flight, the newest pending patch 110 ms later (web pushBorderOnly debounce).

signal closed

const P := preload("res://features/live/pip_model.gd")
const F := preload("res://features/live/param_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const TYPES := ["border", "shadow", "edge_strip", "glow"]
const DEBOUNCE_S := 0.11

var screen_idx := 0
var screen_label := ""
var _registry: Array = []
var _body: VBoxContainer
var _title: Label
var _status: Label
var _pending: Dictionary = {}
var _busy := false
var _timer: Timer


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	_title = Label.new()
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	var x := Button.new()
	x.text = "✕"
	x.pressed.connect(func() -> void:
		visible = false
		closed.emit())
	head.add_child(x)
	add_child(head)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(_body)
	add_child(scroll)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.wait_time = DEBOUNCE_S
	_timer.timeout.connect(_flush)
	add_child(_timer)


func open(idx: int, label: String) -> void:
	screen_idx = idx
	screen_label = label
	_title.text = "Global border — %s" % label
	visible = true
	if _registry.is_empty():
		var r: Dictionary = await Api.get_json("/api/scene/effect-registry")
		if r.ok and r.data is Dictionary and r.data.get("pipOverlays") is Array:
			_registry = r.data.pipOverlays
	_render()


func slot() -> Variant:
	var arr: Variant = (Store.project.get("scenes", {}) as Dictionary).get("globalBorders") if Store.project.get("scenes") is Dictionary else null
	return arr[screen_idx] if arr is Array and screen_idx < (arr as Array).size() and arr[screen_idx] is Dictionary else null


func _adopt(border: Variant) -> void:
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {}
	var arr: Array = Store.project.scenes.get("globalBorders", []) if Store.project.scenes.get("globalBorders") is Array else []
	while arr.size() < 4:
		arr.append(null)
	arr[screen_idx] = border
	Store.project.scenes["globalBorders"] = arr


## Queue a partial edit; `now` skips the debounce (structural edits), `rebuild` re-renders after the reply.
func send(patch: Dictionary, now := false, rebuild := false) -> void:
	for k in patch:
		if k == "params" and _pending.get("params") is Dictionary:
			(_pending.params as Dictionary).merge(patch.params, true)
		else:
			_pending[k] = patch[k]
	if rebuild:
		_pending["__rebuild"] = true
	if now:
		_timer.stop()
		await _flush()
	else:
		_timer.start()


func _flush() -> void:
	if _busy or _pending.is_empty():
		if _busy and not _pending.is_empty():
			_timer.start()
		return
	_busy = true
	var body := _pending.duplicate(true)
	_pending.clear()
	var rebuild: bool = body.get("__rebuild", false)
	body.erase("__rebuild")
	body["screen"] = screen_idx
	var res: Dictionary = await Api.post_json("/api/scene/global-border", body)
	_busy = false
	if res.ok and res.data is Dictionary:
		_adopt(res.data.get("border"))
		_status.text = "%d AMCP line%s" % [(res.data.get("lines", []) as Array).size(), "" if (res.data.get("lines", []) as Array).size() == 1 else "s"]
		if rebuild:
			_render()
	else:
		_status.text = "Border update failed: %s" % res.error
	if not _pending.is_empty():
		_timer.start()


func _render() -> void:
	for c in _body.get_children():
		c.queue_free()
	var gb: Variant = slot()
	if gb == null:
		_body.add_child(_muted("This screen has no global border."))
		_body.add_child(_btn("Enable global border on this screen", "", func() -> void: send({"enabled": true}, true, true)))
		return
	var g := _grid()
	g.add_child(_muted("Enabled"))
	var en := CheckBox.new()
	en.button_pressed = gb.get("enabled") == true
	en.toggled.connect(func(on: bool) -> void: send({"enabled": on}, true, true))
	g.add_child(en)
	g.add_child(_muted("Type"))
	var ty := OptionButton.new()
	for t in TYPES:
		ty.add_item(t)
	ty.select(maxi(0, TYPES.find(str(gb.get("type", "border")))))
	ty.item_selected.connect(func(i: int) -> void: send({"type": TYPES[i]}, true, true))
	g.add_child(ty)
	g.add_child(_muted("Fade (frames)"))
	var fd := SpinBox.new()
	fd.max_value = 250
	fd.value = float(gb.get("fadeDuration", 25))
	fd.value_changed.connect(func(v: float) -> void: send({"fadeDuration": int(v)}))
	g.add_child(fd)
	g.add_child(_muted("Mirror on PRV"))
	var mir := CheckBox.new()
	mir.button_pressed = gb.get("mirrorBorderOnPrv") == true
	mir.text = "edit on PRV layer 997 (PGM unchanged until off)"
	mir.toggled.connect(func(on: bool) -> void: send({"mirrorBorderOnPrv": on}, true, true))
	g.add_child(mir)
	_body.add_child(g)
	_params(gb)
	_area(gb)
	_slices(gb)
	_presets(gb)
	_body.add_child(_btn("Remove border from this screen", "Clears this screen's global border slot (PGM border stops)", func() -> void:
		_confirm("Remove the global border configuration from %s?" % screen_label, func() -> void: send({"clear": true}, true, true))))


## PIP-overlay schema of the type; `side` is always inside; color2 + cycle hide unless enabled (owner 27.07).
func _params(gb: Dictionary) -> void:
	var def := P.def_of(_registry, str(gb.get("type", "border")))
	if def.is_empty():
		return
	var g := _grid()
	var params: Dictionary = gb.get("params", {}) if gb.get("params") is Dictionary else {}
	var gated: Array = []
	var shown := params.duplicate()
	for s in def.get("schema", []):
		var key := str(s.key)
		if key == "side" or (key in ["color2", "colorCycleSec"] and params.get("color2Enabled") != true):
			continue
		var l := _muted(F.label_for(s))
		g.add_child(l)
		var c := F.control(s, params.get(key) if params.get(key) != null else s.get("default"), func(v: Variant) -> void:
			shown[key] = v
			for row in gated:
				var vis := P.field_visible(row[2], shown, def.schema)
				row[0].visible = vis
				row[1].visible = vis
			send({"params": {key: v}}, key == "color2Enabled", key == "color2Enabled"))
		g.add_child(c)
		if s.has("visibleWhen"):
			gated.append([l, c, s])
	for row in gated:
		var vis := P.field_visible(row[2], shown, def.schema)
		row[0].visible = vis
		row[1].visible = vis
	_body.add_child(g)


func _area(gb: Dictionary) -> void:
	var inner: Dictionary = gb.get("inner", {"l": 0, "t": 0, "w": 1, "h": 1}) if gb.get("inner") is Dictionary else {"l": 0, "t": 0, "w": 1, "h": 1}
	var row := HBoxContainer.new()
	row.add_child(_muted("Area % (X Y W H — slices override)"))
	var spins := {}
	for k in ["l", "t", "w", "h"]:
		var sp := SpinBox.new()
		sp.max_value = 100
		sp.value = roundf(float(inner.get(k, 1.0 if k in ["w", "h"] else 0.0)) * 100.0)
		row.add_child(sp)
		spins[k] = sp
	for k in spins:
		(spins[k] as SpinBox).value_changed.connect(func(_v: float) -> void:
			var out := {}
			for kk in spins:
				out[kk] = (spins[kk] as SpinBox).value / 100.0
			send({"inner": out}))
	_body.add_child(row)


## Slices in px of THIS screen's raster (the web converts with one screen's resolution for every screen).
func _slices(gb: Dictionary) -> void:
	var res := _raster()
	var slices: Array = (gb.get("slices", []) as Array).duplicate(true) if gb.get("slices") is Array else []
	_body.add_child(_muted("Slices (multi-segment layout, px of %d×%d)" % [res.x, res.y]))
	if slices.is_empty():
		_body.add_child(_muted("No slices — full canvas."))
	for i in slices.size():
		var row := HBoxContainer.new()
		for k in ["x", "y", "w", "h"]:
			var dim: int = res.x if k in ["x", "w"] else res.y
			var sp := SpinBox.new()
			sp.max_value = dim
			sp.prefix = k.to_upper()
			sp.value = roundf(float(slices[i].get(k, 1.0 if k in ["w", "h"] else 0.0)) * dim)
			var key: String = k
			var idx := i
			sp.value_changed.connect(func(v: float) -> void:
				slices[idx][key] = clampf(v, 0, dim) / float(dim)
				send({"slices": slices.duplicate(true)}))
			row.add_child(sp)
		var idx2 := i
		row.add_child(_btn("×", "Remove slice", func() -> void:
			slices.remove_at(idx2)
			send({"slices": slices}, true, true)))
		_body.add_child(row)
	var bar := HBoxContainer.new()
	bar.add_child(_btn("+ Add slice", "", func() -> void: send({"slices": slices + [{"x": 0, "y": 0, "w": 0.5, "h": 1}]}, true, true)))
	bar.add_child(_btn("Full canvas", "Reset to a full-screen border", func() -> void: send({"slices": []}, true, true)))
	_body.add_child(bar)


func _raster() -> Vector2i:
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var rl: Variant = cm.get("programResolutions", [])
	if rl is Array and screen_idx < (rl as Array).size() and rl[screen_idx] is Dictionary:
		return Vector2i(int(rl[screen_idx].get("w", 1920)), int(rl[screen_idx].get("h", 1080)))
	return Vector2i(1920, 1080)


## Presets: slot count = max(2, highest slot + 2) (web getGlobalBorderPresetSlotCount); Recall crossfades 998 ↔ 996.
func _presets(gb: Dictionary) -> void:
	var presets: Array = gb.get("borderPresets", []) if gb.get("borderPresets") is Array else []
	var top := 0
	for p in presets:
		if p is Dictionary:
			top = maxi(top, int(p.get("slot", 0)))
	_body.add_child(_muted("Border presets (PGM layers 998 ↔ 996)"))
	for s in range(1, maxi(2, top + 2) + 1):
		var found: Dictionary = {}
		for p in presets:
			if p is Dictionary and int(p.get("slot", 0)) == s:
				found = p
		var row := HBoxContainer.new()
		var l := Label.new()
		l.text = "%d. %s" % [s, found.get("name", "—")]
		l.custom_minimum_size.x = 140
		row.add_child(l)
		var sn := s
		var rc := _btn("Recall", "", func() -> void: send({"preset": sn}, true, true))
		rc.disabled = found.is_empty()
		row.add_child(rc)
		row.add_child(_btn("Save", "", func() -> void: _ask_name(str(found.get("name", "Preset %d" % sn)), func(nm: String) -> void: send({"savePreset": {"slot": sn, "name": nm}}, true, true))))
		if not found.is_empty():
			row.add_child(_btn("Delete", "", func() -> void: _confirm("Delete preset %d (%s)?" % [sn, found.name], func() -> void: send({"deletePreset": sn}, true, true))))
		_body.add_child(row)


func _ask_name(initial: String, cb: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = "Preset name?"
	var le := LineEdit.new()
	le.text = initial
	le.custom_minimum_size.x = 240
	dlg.add_child(le)
	dlg.register_text_enter(le)
	dlg.confirmed.connect(func() -> void: cb.call(le.text))
	_popup(dlg)


func _confirm(text: String, cb: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.confirmed.connect(cb)
	_popup(dlg)


func _popup(dlg: AcceptDialog) -> void:
	dlg.visibility_changed.connect(func() -> void:
		if not dlg.visible:
			dlg.queue_free())
	add_child(dlg)
	dlg.popup_centered()


func _grid() -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	return g


func _btn(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	return b


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
