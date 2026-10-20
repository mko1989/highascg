extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 5 — the DeckLink connector page the Devices tab hands to the shared Inspector column (web
## device-view-inspectors.js → renderDeckLinkIoControls): title, then the item list decklink_port_model.gd builds —
## Input (Start an input / source label + Stop input + the host channel's device switcher), Output note, SDI output
## (inherited feed), SDI consumer (format, layout, latency, buffer depth, colour space, pixel format + the 2160p YUV
## warning, embedded audio, low latency) and Fill + key. Every request body comes from the golden-tested models;
## a successful write marks Caspar restart-dirty and reloads the device view, like the web. In DeckLink edit mode (rear
## panel pencil) the rear-order editor (decklink_order_editor.gd) sits under the title, as in the web.

signal dirty()

const DP := preload("res://features/devices/decklink_port_model.gd")
const DI := preload("res://features/devices/decklink_input_model.gd")
const MI := preload("res://core/math_input.gd")
const OrderEditor := preload("res://features/devices/decklink_order_editor.gd")

var page := VBoxContainer.new()
var conn_id := ""
var ui := {}  # SDI consumer values (DP.consumer_state)
var kf := {}  # {on, key} — the Fill + key row
var _conn := {}
var _payload := {}
var _settings: Variant = null
var _w := {}  # spec key → its control
var _saving := false


func _init() -> void:
	page.add_theme_constant_override("separation", 4)


## Rebuild for decklink_io / decklink_out `conn` from the merged device-view payload.
func show_connector(conn: Dictionary, payload: Dictionary, settings: Variant) -> void:
	conn_id = str(conn.get("id", ""))
	_conn = conn
	_payload = payload
	_settings = settings
	for c in page.get_children():
		page.remove_child(c)
		c.queue_free()
	_w = {}
	ui = DP.consumer_state(conn, DP.output_status(payload, conn_id))
	var kfi := DP.keyfill_items(conn, payload)
	kf = {"on": kfi[0].checked, "key": kfi[1].value}
	page.add_child(_title(str(conn.get("label")) if DP.H.truthy(conn.get("label")) else conn_id))
	if OrderEditor.DO.edit:
		var ed := OrderEditor.new()
		ed.confirm = func(text: String) -> bool: return await _confirm(text, "Reset")
		ed.setup(payload)
		ed.changed.connect(func() -> void: reload.emit(false))
		ed.status.connect(func(text: String, ok: bool) -> void: status.emit(text, ok))
		page.add_child(ed)
	for it in DP.page_spec(conn, payload, settings):
		var c := _item(it)
		if c != null:
			page.add_child(c)
	_sync_live()


func close() -> void:
	conn_id = ""


func _item(it: Dictionary) -> Control:
	match it.t:
		"heading":
			return _text(it.text, ThemeBuilder.TEXT, 12)
		"note":
			return _note(it.text)
		"small":
			var l := _note(it.text)
			l.add_theme_font_size_override("font_size", 10)
			return l
		"warn", "hint":
			var l := _note(it.text)
			l.add_theme_color_override("font_color", ThemeBuilder.WARN)
			if it.t == "hint":
				_w.hint = l
			return l
		"hr":
			return HSeparator.new()
		"caption":
			return _caption(it.text)
		"select":
			return _select_item(it)
		"input":
			return _depth_input(it)
		"check":
			var cb := _check(it.text, it.checked)
			cb.toggled.connect(func(on: bool) -> void: _on_check(it.key, on))
			_w[it.key] = cb
			return cb
		"button":
			var b := _button(it.text, func() -> void: pass)
			if it.text == "Start an input":
				b.pressed.connect(func() -> void: _start(b))
			else:
				b.pressed.connect(func() -> void: _stop(b))
			return b
		"label":
			return _label_control(_payload, conn_id, "DeckLink %d" % DI.view(_conn, _payload, _settings).slot)
		"host":
			return _decklink(it.source, _payload, _settings, it.slot, false,
				"DeckLink updated on ch %s." % DP.R.s(it.source.get("inputsChannel")))
	return null


func _select_item(it: Dictionary) -> OptionButton:
	var ob := _select(it.options, it.value)
	if it.key == "mode":
		ob.set_item_disabled(0, true)  # the "Select SDI format…" placeholder
	ob.item_selected.connect(func(i: int) -> void:
		var v := str(ob.get_item_metadata(i))
		if it.key == "key":
			kf.key = v
			_save_keyfill()
		else:
			ui[it.key] = v
			_sync_live()
			_save_consumer())
	_w[it.key] = ob
	return ob


## Buffer depth: the web saves the raw text on change, then its math commit rewrites the field (1–3, integer).
func _depth_input(it: Dictionary) -> LineEdit:
	var le := _line(it.value, "", "Frames buffered on the DeckLink card (1–3)")
	var held := {"last": it.value}
	var commit := func() -> void:
		if le.text == held.last:
			return
		ui.depth = le.text
		_save_consumer()
		le.text = MI.commit(le.text, 1, 3, 0, float(held.last)).text
		ui.depth = le.text
		held.last = le.text
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	_w.depth = le
	return le


func _on_check(key: String, on: bool) -> void:
	if key == "kf":
		kf.on = on
		kf.key = DP.key_after_toggle(on, kf.key, _payload, _conn)
		_sync_live()
		_save_keyfill()
		return
	ui[key] = on
	_save_consumer()


## The parts the web keeps live without a reload: the pixel-format warning and the key select's enabled state.
func _sync_live() -> void:
	if _w.has("hint"):
		_w.hint.text = DP.yuv_warning(ui)
		_w.hint.visible = _w.hint.text != ""
	if _w.has("key"):
		var ob: OptionButton = _w.key
		ob.disabled = not kf.on
		for i in ob.item_count:
			if str(ob.get_item_metadata(i)) == str(kf.key):
				ob.select(i)


func _save_consumer() -> void:
	var r := DP.consumer_patch(_conn, ui)
	if r.has("error"):
		status.emit(r.error, false)
		return
	await _write(r.patch, "SDI settings saved.")


func _save_keyfill() -> void:
	var r := DP.keyfill_patch(_conn, _payload, kf.on, kf.key)
	if r.has("error"):
		status.emit(r.error, false)
		return
	await _write(r.patch, r.status)


## updateConnector {caspar: patch} → restart-dirty, status, reload. Edits landing mid-save are dropped like the web's.
func _write(patch: Dictionary, ok_text: String) -> void:
	if _saving:
		return
	_saving = true
	var res: Dictionary = await Api.post_json("/api/device-view", {"updateConnector": {"id": conn_id, "patch": {"caspar": patch}}})
	_saving = false
	if not res.ok:
		status.emit("Save failed: " + _error(res), false)
		return
	dirty.emit()
	status.emit(ok_text, true)
	reload.emit(false)


## addDecklinkInputSlot: settings + device view read, ioDirection 'in', re-read, then capture / live source.
func _start(b: Button) -> void:
	if _busy:
		return
	_busy = true
	b.disabled = true
	var v := DI.view(_conn, _payload, _settings)
	await Settings.load_from_server()
	var prev := DI.HS.decklink_count(Settings.settings)
	var dv := await _device_view()
	var prep := DI.add_prepare(dv, maxi(1, v.dev if v.dev != 0 else v.slot), v.slot)
	var r: Dictionary = {"ok": false, "error": prep.get("error", "")}
	if not prep.has("error"):
		r = await _run(prep.requests)
	if r.ok:
		await Settings.load_from_server()
		var dv2 := await _device_view()
		var fin := DI.add_finish(prep, prev, DI.HS.decklink_count(Settings.settings), dv2, Settings.settings)
		r = await _run(fin.requests)
		if r.ok:
			if fin.restart or fin.pending or r.dirty:
				dirty.emit()
			status.emit(DI.add_status(v.dev, fin), true)
	_busy = false
	b.disabled = false
	if not r.ok:
		status.emit("Failed: " + r.error, false)
		return
	reload.emit(false)


## removeDecklinkInputSlot (host_source_model.gd's plan, the same one the host-channel page's Remove runs).
func _stop(b: Button) -> void:
	if _busy:
		return
	_busy = true
	b.disabled = true
	var v := DI.view(_conn, _payload, _settings)
	var a := DI.stop_args(_conn, v)
	await Settings.load_from_server()
	var prev := DI.HS.decklink_count(Settings.settings)
	var dv := await _device_view()
	var cm: Variant = DP.R.d(DP.R.d(dv.get("live")).get("caspar")).get("channelMap")
	var plan := DI.HS.decklink_remove_plan(dv, a[0], a[1], a[2], "", cm if cm is Dictionary else {})
	var r: Dictionary = await _run(plan.requests)
	if r.ok:
		await Settings.load_from_server()
		var tail: Dictionary = await _run(DI.HS.decklink_remove_tail(prev, DI.HS.decklink_count(Settings.settings), plan.dest_id))
		if tail.dirty:
			dirty.emit()
		status.emit(DI.stop_status(v), true)
	_busy = false
	b.disabled = false
	if not r.ok:
		status.emit("Failed: " + r.error, false)
		return
	reload.emit(false)


## A fresh GET /api/device-view (the page's payload when that fails).
func _device_view() -> Dictionary:
	var r: Dictionary = await Api.get_json("/api/device-view")
	return r.data if r.ok and r.data is Dictionary else _payload
