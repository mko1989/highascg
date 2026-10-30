extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 6 — the Stream / Record / Virtual cam / Audio output pages the Devices tab hands to the shared
## Inspector column (web device-view-inspectors.js → renderStreamOutControls / renderRecordOutControls /
## renderVirtualCamOutControls / renderAudioOutControls): title + summary table, then the item list
## stream_record_model.gd / vcam_audio_model.gd build for the current field values. The stream type select rebuilds
## the page (NDI / RTMP / SRT show different fields); the audio page auto-saves every change like the web. The log
## box reads GET /api/streaming-channel, the virtual-cam status block GET /api/virtual-camera/status, once per open
## and after Start / Stop (the web also follows the WS push). Also runs the rear panel's "+" adds (`add_output`).

signal dirty()

const NumericField := preload("res://core/numeric_field.gd")
const O := preload("res://features/devices/output_ports_model.gd")
const SR := preload("res://features/devices/stream_record_model.gd")
const VA := preload("res://features/devices/vcam_audio_model.gd")
const KINDS := ["stream_out", "record_out", "v4l2_out", "audio_out"]

var page := VBoxContainer.new()
var conn_id := ""
var kind := ""
var ui := {}
var _conn := {}
var _payload := {}
var _settings: Variant = null
var _live: Variant = null  # stream / record: the log list; virtual cam: the status reply
var _seq := 0  # a reply for an older page is dropped


func _init() -> void:
	page.add_theme_constant_override("separation", 4)


func show_connector(conn: Dictionary, payload: Dictionary, settings: Variant) -> void:
	var same := conn_id == str(conn.get("id", ""))
	conn_id = str(conn.get("id", ""))
	kind = str(conn.get("kind", ""))
	_conn = conn
	_payload = payload
	_settings = settings
	_seq += 1
	if not same:
		_live = null
	match kind:
		"stream_out":
			ui = SR.stream_state(conn, settings)
		"record_out":
			ui = SR.record_state(conn, settings)
		"v4l2_out":
			ui = VA.vcam_state(conn, settings)
		_:
			ui = VA.audio_state(conn, payload, settings)
	_rebuild()
	_fetch_live()


func close() -> void:
	conn_id = ""
	_seq += 1


func _items() -> Array:
	match kind:
		"stream_out":
			return SR.stream_items(_conn, _payload, _settings, ui, _live)
		"record_out":
			return SR.record_items(_conn, _payload, ui, _live)
		"v4l2_out":
			return VA.vcam_items(_conn, _payload, _settings, ui, _live)
	return VA.audio_items(_conn, _payload, _settings, ui)


func _rebuild() -> void:
	for c in page.get_children():
		page.remove_child(c)
		c.queue_free()
	for it in _items():
		page.add_child(_item(it))


## The log list / virtual-cam status, and the audio page's device re-enumeration when the snapshot had none.
func _fetch_live() -> void:
	var seq := _seq
	if kind == "audio_out":
		if VA.audio_needs_refresh(_payload):
			for path in VA.REFRESH_REQUESTS:
				await DevicesTarget.api.get_json(path)
			if seq == _seq:
				status.emit(VA.REFRESHED, true)
		return
	var r: Dictionary = await DevicesTarget.api.get_json("/api/virtual-camera/status" if kind == "v4l2_out" else "/api/streaming-channel")
	if seq != _seq or not r.ok or not r.data is Dictionary:
		return
	_live = r.data if kind == "v4l2_out" else O.R.d(r.data.get("rtmp" if kind == "stream_out" else "record")).get("logs")
	_rebuild()


func _item(it: Dictionary) -> Control:
	match it.t:
		"title":
			return _title(it.text)
		"table":
			var g := GridContainer.new()
			g.columns = 2
			g.add_theme_constant_override("h_separation", 10)
			for r in it.rows:
				g.add_child(_caption(r[0]))
				g.add_child(_text(r[1], ThemeBuilder.TEXT, 11))
			return g
		"note", "small", "warn":
			var l := _note(it.text)
			if it.t == "small":
				l.add_theme_font_size_override("font_size", 10)
			if it.t == "warn":
				l.add_theme_color_override("font_color", ThemeBuilder.WARN)
			return l
		"caption":
			return _caption(it.text)
		"log":
			var l := _note(it.text)
			l.add_theme_color_override("font_color", ThemeBuilder.TEXT)
			l.add_theme_font_size_override("font_size", 10)
			return l
		"select":
			var ob := _select(it.options, it.value)
			ob.disabled = it.disabled
			ob.item_selected.connect(func(i: int) -> void: _on_select(it.key, str(ob.get_item_metadata(i))))
			return ob
		"input":
			return _input_item(it)
		"check":
			var cb := _check(it.text, it.checked)
			cb.toggled.connect(func(on: bool) -> void: _on_check(it.key, on))
			return cb
		"button":
			var b := _button(it.text, func() -> void: pass)
			b.disabled = it.disabled
			b.pressed.connect(func() -> void: _press(it.text, b))
			return b
	return Control.new()


## Text fields keep `ui` current as they are typed; a commit (Enter / focus out) runs the math-input rewrite, and on
## the audio page saves — only when the text changed, like the DOM's change event.
func _input_item(it: Dictionary) -> LineEdit:
	var le := _line(it.value, it.placeholder)
	le.secret = it.secret
	var key: String = it.key
	var held := {"last": it.value}
	var math: bool = O.MATH.get(kind, {}).has(key)
	if not math:
		le.text_changed.connect(func(tx: String) -> void: ui[key] = tx)
	if kind == "stream_out" and key == "srt_latency":
		# WO-839: SRT latency (ms) is a number field — a number / complete expression (20–8000, like the save's
		# clamp) or the previous value; the rewrite is state too (text_changed does not fire for it).
		NumericField.math_line(le, true, 20.0, 8000.0, func(tx: String) -> void: ui[key] = tx)
	var commit := func() -> void:
		if le.text == held.last:
			return
		if math:
			le.text = O.math_commit(kind, key, le.text, held.last)
		ui[key] = le.text
		held.last = le.text
		if kind == "audio_out":
			_save_audio(ui)
	le.text_submitted.connect(func(_tx: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	return le


func _on_select(key: String, v: String) -> void:
	if kind != "audio_out":
		ui[key] = v
		if key == "type":
			_rebuild()  # NDI / RTMP / SRT / UDP show different fields
		return
	var save_ui := ui
	match key:
		"type":
			ui = VA.audio_on_type(ui, v, _conn, _payload, _settings)
			save_ui = ui
		"device":
			var d := VA.audio_on_device(ui, v, _conn, _payload, _settings)
			save_ui = d.save_ui
			ui = d.ui
		_:
			ui[key] = v
	_rebuild()
	_save_audio(save_ui)


func _on_check(key: String, on: bool) -> void:
	if kind == "audio_out" and key == "monitor":
		ui = VA.audio_on_monitor(ui, on, _conn, _payload, _settings)
		_rebuild()
		_save_audio(ui)
		return
	ui[key] = on


func _save_audio(values: Dictionary) -> void:
	await _write(VA.audio_save(_conn, _settings, values), "")


func _press(text: String, b: Button) -> void:
	if text.begins_with("Remove"):
		if not await _confirm(O.remove_confirm(kind, conn_id)):
			return
		await _write(O.remove_plan(kind, conn_id, _payload, _settings), "", b)
		return
	match text:
		"Save stream settings":
			var plan := SR.stream_save(_conn, _settings, ui)
			ui = SR.stream_after_save(ui)
			await _write(plan, "Save failed: ", b)
		"Start stream":
			await _write(SR.stream_start(_conn, _settings, ui), "", b)
		"Stop stream":
			await _write(SR.stream_stop(), "", b)
		"Save record settings":
			await _write(SR.record_save(_conn, _settings, ui), "Save failed: ", b)
		"Start record":
			await _write(SR.record_start(_conn, ui), "", b)
		"Stop record":
			await _write(SR.record_stop(_conn), "", b)
		"Save settings":
			status.emit("Saving virtual camera settings…", true)
			await _write({"requests": [["POST", "/api/virtual-camera/config", VA.vcam_body(_conn, ui)]],
				"status": "Virtual camera settings saved."}, "Save failed: ", b)
		"Stop virtual cam":
			status.emit("Stopping virtual camera…", true)
			await _write({"requests": [["POST", "/api/virtual-camera/stop", {"persist": true}]], "status": "Virtual camera stopped."},
				"Stop failed: ", b)
		"Start virtual cam":
			await _start_vcam(b)


## Run a {requests, status} / {error} plan: settings writes re-read Settings, DIRTY marks Caspar restart-dirty, then
## the status and a device-view reload (which rebuilds this page from the fresh settings, like the web's load()).
func _write(plan: Dictionary, fail_prefix: String, b: Button = null) -> void:
	if plan.has("error"):
		status.emit(plan.error, false)
		return
	if _busy:
		return
	_busy = true
	if b != null:
		b.disabled = true
	var r := await _run(plan.requests)
	if plan.requests.any(func(q: Array) -> bool: return q.size() > 1 and q[1] == "/api/settings"):
		await DevicesTarget.settings.load_from_server()
	_busy = false
	if is_instance_valid(b):
		b.disabled = false
	if r.dirty:
		dirty.emit()
	if not r.ok:
		status.emit(fail_prefix + r.error, false)
		return
	if plan.status != "":
		status.emit(plan.status, true)
	reload.emit(false)


## Start virtual cam: the reply is the new status (running, or the reason it is not).
func _start_vcam(b: Button) -> void:
	if _busy:
		return
	_busy = true
	b.disabled = true
	status.emit("Starting virtual camera…", true)
	var r: Dictionary = await DevicesTarget.api.post_json("/api/virtual-camera/start", VA.vcam_body(_conn, ui))
	_busy = false
	if is_instance_valid(b):
		b.disabled = false
	if not r.ok:
		status.emit("Start failed: " + _error(r), false)
		return
	_live = r.data
	status.emit(VA.vcam_start_status(r.data), O.H.truthy(O.R.d(r.data).get("running")))
	reload.emit(false)


## The rear panel's "+": a new numbered stream / record / audio output, or the virtual cam shown again.
func add_output(add_kind: String) -> void:
	var plan := O.add_plan(add_kind, DevicesTarget.settings.settings)
	await _write(plan, "")
