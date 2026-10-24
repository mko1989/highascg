extends Node
## WO-605 slice 3c — shared base of the host-channel inspector controllers (host_live_controls.gd,
## host_input_controls.gd, and since slice 5 decklink_port_controls.gd): the small widget builders, the DeckLink device
## switcher + shared source label (both pages mount them), a modal confirm (the web's window.confirm) and `_run`, which
## posts a planned request list from host_source_model.gd / input_slots_model.gd. Status lines go to the Devices tab's
## status label (the web toasts); `reload` asks the tab to re-fetch the device view (dirty = also mark Caspar
## restart-dirty); `removed` = the selected host destination is gone. Uses the Api / Settings / Store autoloads, so the
## controllers are injected into the (autoload-free) page at runtime and are not under the headless unit runner.

signal status(text: String, ok: bool)
signal reload(dirty: bool)
signal removed()
signal _decided(ok: bool)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const HS := preload("res://features/devices/host_source_model.gd")
const H := preload("res://features/devices/host_channels.gd")

var _busy := false


## Post the plan in order: ["POST", path, body] (a 4th element "soft" = ignore its failure, like the web's
## .catch(() => {})), ["DIRTY"] = Caspar restart-dirty. Stops at the first hard failure.
func _run(requests: Array) -> Dictionary:
	var dirty := false
	for req in requests:
		if req[0] == "DIRTY":
			dirty = true
			continue
		var r: Dictionary = await DevicesTarget.api.post_json(req[1], req[2])
		if not r.ok and req.size() < 4:
			return {"ok": false, "error": _error(r), "dirty": dirty}
	return {"ok": true, "error": "", "dirty": dirty}


static func _error(r: Dictionary) -> String:
	var data: Variant = r.get("data")
	if data is Dictionary and H.truthy(data.get("error")):
		return str(data.error)
	return str(r.get("error", "HTTP %s" % r.get("status", "?")))


## The server's {ok:false, error} inside a 200 reply (api-client throws on it; the web shows e.message).
static func _reply_error(r: Dictionary) -> String:
	if not r.ok:
		return _error(r)
	var d: Variant = r.get("data")
	if d is Dictionary and d.get("ok") == false:
		return str(d.get("error", d.get("reason", "Request failed")))
	return ""


func _confirm(text: String, ok_text := "Remove") -> bool:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.ok_button_text = ok_text
	dlg.title = "Confirm"
	add_child(dlg)
	dlg.confirmed.connect(func() -> void: _decided.emit(true))
	dlg.canceled.connect(func() -> void: _decided.emit(false))  # Cancel and the window close
	dlg.popup_centered()
	var ok: bool = await _decided
	dlg.queue_free()
	return ok


func _title(text: String) -> Label:
	return _text(text, ThemeBuilder.TEXT, 13)


func _caption(text: String) -> Label:
	return _text(text, ThemeBuilder.TEXT_MUTED, 10)


func _note(text: String) -> Label:
	var l := _text(text, ThemeBuilder.TEXT_MUTED, 11)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 200
	return l


func _text(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


func _section() -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	return v


func _row() -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 6)
	return h


func _button(text: String, on_press: Callable, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(on_press)
	return b


## Caption above the input (the web's inspector-field).
func _field(caption: String, input: Control) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.add_child(_caption(caption))
	v.add_child(input)
	return v


func _line(text: String, placeholder: String, tip := "") -> LineEdit:
	var le := LineEdit.new()
	le.text = text
	le.placeholder_text = placeholder
	le.tooltip_text = tip
	le.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return le


## options = [[value, label]…]; `value` selected when listed. Metadata holds the value.
func _select(options: Array, value: Variant, tip := "") -> OptionButton:
	var ob := OptionButton.new()
	ob.tooltip_text = tip
	ob.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	ob.fit_to_longest_item = false  # 200+ template names must not widen the Inspector column
	ob.clip_text = true  # nor a long selected label (the "no leaders found" hint)
	_fill(ob, options, value)
	return ob


func _fill(ob: OptionButton, options: Array, value: Variant) -> void:
	ob.clear()
	for i in options.size():
		ob.add_item(str(options[i][1]), i)
		ob.set_item_metadata(i, options[i][0])
		if str(options[i][0]) == str(value):
			ob.select(i)


func _check(text: String, on: bool, tip := "") -> CheckBox:
	var cb := CheckBox.new()
	cb.text = text
	cb.button_pressed = on
	cb.tooltip_text = tip
	return cb


## The destination's label for confirm texts: source label, else the card label, else `fallback`.
static func _label_of(src: Dictionary, dest: Dictionary, fallback: String) -> String:
	for v in [src.get("label"), dest.get("label")]:
		if H.truthy(v):
			return str(v)
	return fallback


# ---------------------------------------------------------------- DeckLink input (host page + DeckLink port page)

## mountDecklinkHostSourceControls: device switcher + Apply / Reload. `with_label` = also the shared source label
## (the port page mounts its own, before Stop input); `done` = the status when the reply carries no message.
func _decklink(src: Dictionary, payload: Dictionary, settings: Variant, slot: int, with_label := true, done := "") -> Control:
	var box := _section()
	var cid := H.R.s(src.get("connectorId")).strip_edges()
	if with_label and cid != "":  # WO-525: the shared source label, before the title, only with a stable connector key
		box.add_child(_label_control(payload, cid, "DeckLink %d" % slot))
	box.add_child(_title("DeckLink device"))
	var active := HS.decklink_active_device(src, settings, slot)
	var sel := _select(HS.decklink_options(payload, slot, active), active, "Which DeckLink device feeds this input slot")
	box.add_child(sel)
	var post := func(body: Dictionary, ok_text: String) -> void:
		if body.is_empty() or _busy:
			return
		_busy = true
		var res: Dictionary = await DevicesTarget.api.post_json("/api/host-live/decklink", body)
		_busy = false
		var err := _reply_error(res)
		if err != "":
			status.emit(err, false)
			return
		var msg: Variant = H.R.d(res.data).get("message")
		status.emit(str(msg) if H.truthy(msg) else ok_text, true)
		reload.emit(false)
	var row := _row()
	row.add_child(_button("Apply source", func() -> void:
		post.call(HS.decklink_update_body(slot, sel.get_selected_metadata(), src.get("connectorId"), src.get("value")), done if done != "" else "DeckLink source updated")))
	row.add_child(_button("Reload", func() -> void:
		post.call(HS.decklink_reload_body(slot, src.get("connectorId"), src.get("value")), done if done != "" else "DeckLink reloaded")))
	box.add_child(row)
	return box


## mountSourceLabelControl: the operator's override of the generated source name (blank = generated).
func _label_control(payload: Dictionary, cid: String, fallback: String) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.add_child(_caption("Label"))
	var st := HS.label_state(payload.get("extraLiveSources"), cid, fallback)
	var le := _line(st.custom, st.generated if st.generated != "" else cid,
		"Shown wherever this source appears. Leave empty to use the generated name.")
	le.max_length = 64
	v.add_child(le)
	var hint := _caption(HS.label_hint(st.custom, st.generated))
	v.add_child(hint)
	var save := func() -> void:
		if _busy:
			return
		var label := le.text.strip_edges()
		if label == st.custom:
			return
		_busy = true
		var res: Dictionary = await DevicesTarget.api.post_json("/api/sources/label", {"sourceId": cid, "label": label})
		_busy = false
		var err := _reply_error(res)
		if err != "":
			hint.text = "Save failed: " + err
			return
		HS.apply_saved_label(payload.get("extraLiveSources"), cid, label)
		var next := HS.label_state(payload.get("extraLiveSources"), cid, fallback)
		st.custom = next.custom
		le.text = next.custom
		le.placeholder_text = next.generated if next.generated != "" else cid
		hint.text = HS.label_hint(next.custom, next.generated)
		reload.emit(false)
	le.text_submitted.connect(func(_t: String) -> void: save.call())
	le.focus_exited.connect(save)
	return v
