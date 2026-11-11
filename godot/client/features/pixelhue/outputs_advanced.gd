extends VBoxContainer
## WO-1039 — Outputs ▸ "Advanced · format and colour" (Studio output-advanced.js): sampling / range / gamut and colour
## correction per primary output, "Copy to all" for the same connector type. Collapsed; loaded when first opened.

signal status(text: String)

const M := preload("res://features/pixelhue/outputs_model.gd")
const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const NF := preload("res://core/numeric_field.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

var _state: Dictionary = {}
var _selected := -1
var _values := {}
var _busy := false
var _toggle: Button
var _body: VBoxContainer
var _apply: Button


func _ready() -> void:
	_toggle = Button.new()
	_toggle.toggle_mode = true
	_toggle.text = "Advanced · format and colour"
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_toggle.toggled.connect(func(on: bool) -> void:
		_body.visible = on
		if on and _state.is_empty():
			refresh())
	add_child(_toggle)
	_body = VBoxContainer.new()
	_body.visible = false
	_body.add_theme_constant_override("separation", 8)
	add_child(_body)
	_render()


func has_changes() -> bool:
	return not _state.is_empty() and not M.adv_pending(_current(), _values).is_empty()


## Re-read when open; otherwise forget so the next open loads fresh.
func refresh() -> void:
	if not _toggle.button_pressed:
		_state = {}
		_render()
		return
	var r: Dictionary = await StudioApi.read(Api, "output-advanced")
	if not r.ok:
		status.emit(str(r.error))
		return
	_adopt(r.data)


func _current() -> Dictionary:
	return M.find(_state.get("outputs", []), _selected)


func _adopt(data: Dictionary) -> void:
	_state = data
	var outs: Array = data.get("outputs", [])
	if M.find(outs, _selected).is_empty():
		_selected = int((outs[0] as Dictionary).id) if not outs.is_empty() else -1
	_values = _current().get("values", {}).duplicate()
	_render()


func _render() -> void:
	for c in _body.get_children():
		c.queue_free()
	if _state.is_empty():
		Kit.note(_body, "Open to load output format and colour settings.")
		return
	var out := _current()
	if out.is_empty():
		Kit.note(_body, "No output on this device exposes format or colour settings.")
		return
	var pick := OptionButton.new()
	var sel := 0
	for i in (_state.outputs as Array).size():
		var o: Dictionary = _state.outputs[i]
		pick.add_item("%s · %s · %s" % [str(o.role), str(o.name), str(o.connector)], int(o.id))
		if int(o.id) == _selected:
			sel = i
	pick.select(sel)
	pick.item_selected.connect(func(i: int) -> void:
		if has_changes():
			status.emit("Apply or discard (Refresh) pending output settings first.")
			pick.select(sel)
			return
		_selected = pick.get_item_id(i)
		_values = _current().get("values", {}).duplicate()
		_render())
	var head := Kit.row(_body)
	head.add_child(_label("Output"))
	head.add_child(pick)
	for section in M.adv_sections(out):
		var h := _label(section)
		h.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
		_body.add_child(h)
		var g := GridContainer.new()
		g.columns = 4
		g.add_theme_constant_override("h_separation", 14)
		_body.add_child(g)
		for f in M.adv_fields(out, section):
			g.add_child(_label(str(f.label)))
			g.add_child(_field(f))
	var actions := Kit.row(_body)
	_apply = Kit.button(actions, "Apply output settings", _on_apply)
	if not M.adv_quality_defaults(out).is_empty():
		Kit.button(actions, "Reset colour", func() -> void:
			_values.merge(M.adv_quality_defaults(out), true)
			_render())
	var peers := M.adv_peers(_state.outputs, out)
	if not peers.is_empty():
		Kit.button(actions, "Copy to all %s (%d)" % ["outputs" if str(out.role) == "Output" else str(out.role), peers.size()], _on_copy)
	Kit.note(_body, "Sampling changes can exceed the link bandwidth at high resolutions; the device refuses those.")
	_controls()


func _label(t: String) -> Label:
	var l := Label.new()
	l.text = t
	return l


func _field(f: Dictionary) -> Control:
	var key := str(f.key)
	if f.get("options") is Array:
		var ob := OptionButton.new()
		var sel := -1
		for i in (f.options as Array).size():
			ob.add_item(str(f.options[i][1]), i)
			if float(f.options[i][0]) == float(_values.get(key, -1)):
				sel = i
		ob.select(sel)
		ob.item_selected.connect(func(i: int) -> void:
			_values[key] = float(f.options[i][0])
			_controls())
		return ob
	var le := LineEdit.new()
	var step := float(f.get("step", 1))
	NF.math_line(le, step == 1.0, float(f.get("min", -INF)), float(f.get("max", INF)))
	le.custom_minimum_size.x = 80
	le.text = NF.fmt(float(_values.get(key, 0)), step == 1.0)
	var commit := func(_t: Variant = "") -> void:
		_values[key] = float(le.text)
		_controls()
	le.text_submitted.connect(commit)
	le.focus_exited.connect(commit)
	return le


func _controls() -> void:
	if _apply != null and is_instance_valid(_apply):
		_apply.disabled = _busy or M.adv_pending(_current(), _values).is_empty()


func _on_apply() -> void:
	var s := M.adv_pending(_current(), _values)
	_send([{"id": _selected, "settings": s}], "Output settings saved.")


func _on_copy() -> void:
	var ch := M.adv_copy_changes(_state.outputs, _current(), _values)
	if ch.is_empty():
		status.emit("All of these outputs already match.")
		return
	_send(ch, "Settings copied to %d output%s." % [ch.size(), "" if ch.size() == 1 else "s"])


func _send(changes: Array, done: String) -> void:
	for c in changes:
		var why := M.adv_validate(M.find(_state.outputs, int(c.id)), c.settings)
		if why != "":
			status.emit(why)
			return
	var any_format := false
	for c in changes:
		any_format = any_format or M.adv_is_format(c.settings)
	var go := func() -> void:
		_busy = true
		_controls()
		var r: Dictionary = await StudioApi.write(Api, "output-advanced", M.adv_body(changes))
		_busy = false
		if r.ok:
			_adopt(r.data)
			status.emit(done)
		else:
			status.emit(str(r.error))
			_controls()
	if any_format:
		Kit.confirm(self, "Changing sampling, range or gamut can blank the output while it re-locks. Apply?", go)
	else:
		go.call()
