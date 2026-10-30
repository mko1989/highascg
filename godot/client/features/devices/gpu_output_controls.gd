extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 4 — the GPU-output connector page the Devices tab hands to the shared Inspector column (web
## device-view-inspectors.js connector page → buildGpuInspectorSummaryRows + renderGpuOutControls +
## populateGpuVideoModelineSection): title, summary table, the consumer toggle row with pointer confine, Video Mode
## (+ custom W/H/FPS), the detected-modes / custom OS resolution block with Override, the CVT/GTF timing preview
## (server GET, debounced 280 ms), and the advanced block (OS backend, EDID override, stretch, colour, name, aspect,
## X/Y, Reset). Control values live in gpu_output_ui.gd's dict; every body comes from the golden-tested models.
## Saves mark Caspar restart-dirty (`dirty`) without rebuilding the page, like the web. In GPU edit mode the layout
## editor (gpu_layout_editor.gd, slice 9b-2) sits under the summary. Web parity kept on purpose: the EDID override field is shown but never saved
## (saveCasparSettings has no edid key) — see WO-605 slice 4.

signal dirty()

const GO := preload("res://features/devices/gpu_output_model.gd")
const GM := preload("res://features/devices/gpu_modeline_model.gd")
const GP := preload("res://features/devices/gpu_modeline_preview.gd")
const GU := preload("res://features/devices/gpu_output_ui.gd")
const MI := preload("res://core/math_input.gd")
const GLE := preload("res://features/devices/gpu_layout_editor.gd")
const BASE_CHECKS := [["fullscreen", "Fullscreen", "Run in fullscreen mode"], ["windowed", "Windowed", "Run in windowed mode"],
	["border", "Border", "Show window border"]]  # no V-sync: always off (WO-716); ui.vsync only round-trips the saved key
## LineEdit field → [placeholder, min, decimals] (decimals < 0 = plain text, no math commit)
const INPUTS := {"custom_w": ["Width", 64.0, 0], "custom_h": ["Height", 64.0, 0], "custom_fps": ["Frame rate", 1.0, 2],
	"os_w": ["Width", 64.0, 0], "os_h": ["Height", 64.0, 0], "os_fps": ["Hz", 1.0, 2],
	"edid": ["EDID override (optional)", 0.0, -1], "name": ["Screen name (optional)", 0.0, -1],
	"ar": ["e.g. 16:9 or 1.7778", 0.0, -1], "pos_x": ["X", -INF, 0], "pos_y": ["Y", -INF, 0]}  # WO-839: X / Y hold numbers only (the web attaches the math input)
const OVERRIDE_TIP := "Use Caspar Video mode for layout when cabled to a destination (see WO-40)"

var page := VBoxContainer.new()
var conn_id := ""
var ui := {}
var _env := {}
var _w := {}  # field → its control
var _advanced_open := false
var _seeded := {}  # connector ids whose seed write already went out this session
var _timer := Timer.new()
var _seq := 0
var _inflight := {}  # save kind → true while posting
var _again := {}  # save kind → another edit landed meanwhile; post the newest body once more
var _layout: Variant = null  # the layout editor's flow while GPU edit mode is on (its rows outlive the reloads)


func _init() -> void:
	page.add_theme_constant_override("separation", 4)
	_timer.one_shot = true
	_timer.wait_time = 0.28
	_timer.timeout.connect(_refresh_preview)
	add_child(_timer)


## Rebuild for gpu_out `conn` from the merged device-view payload; keeps the focused field across a reload.
func show_connector(conn: Dictionary, payload: Dictionary, settings: Variant) -> void:
	var focus := _focused_index()
	conn_id = str(conn.get("id", ""))
	for c in page.get_children():
		page.remove_child(c)
		c.queue_free()
	_w = {}
	var cs: Dictionary = GO.R.d(GO.R.d(settings).get("casparServer"))
	var cst := GO.consumer_state(cs, settings, conn, payload)
	var display := GO.detected_display(conn, payload, settings)
	var mst := GM.state(conn, payload, cs, settings, display, cst.screen_n, cst.port_n, GO.physical_mode(conn, payload, display))
	_env = {"conn": conn, "payload": payload, "settings": settings, "cs": cs, "cst": cst, "mst": mst}
	ui = GU.initial(cst, mst)
	page.add_child(_title(str(conn.get("label")) if GO.H.truthy(conn.get("label")) else conn_id))
	page.add_child(_summary(GO.summary_rows(conn, payload, settings)))
	if GLE.FLOW.GL.edit:  # web: the layout editor sits between the summary and the toggles
		if _layout == null or _layout.stale:
			_layout = GLE.FLOW.new(payload, GLE.FLOW.GL.saved(), _io())
		var ed := GLE.new()
		ed.setup(_layout)
		page.add_child(ed)
	else:
		_layout = null
	page.add_child(_toggles())
	page.add_child(_video_mode(mst))
	page.add_child(_system_resolution(mst))
	page.add_child(_timing_row())
	var adv_btn := _button("Hide advanced consumer settings" if _advanced_open else "Show advanced consumer settings...", func() -> void: pass)
	adv_btn.flat = true
	adv_btn.add_theme_font_size_override("font_size", 10)
	adv_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	page.add_child(adv_btn)
	var adv := _advanced(cst, mst)
	adv.visible = _advanced_open
	page.add_child(adv)
	adv_btn.pressed.connect(func() -> void:
		_advanced_open = not _advanced_open
		adv.visible = _advanced_open
		adv_btn.text = "Hide advanced consumer settings" if _advanced_open else "Show advanced consumer settings..."
		if _advanced_open:
			_timer.start())
	_sync_rows()
	_timer.start()
	if focus >= 0:
		_refocus.call_deferred(focus)
	if not cst.seed_patch.is_empty() and not _seeded.has(conn_id):
		_seeded[conn_id] = true
		_seed.call_deferred(cst.seed_patch)


func close() -> void:
	conn_id = ""
	_layout = null
	_timer.stop()
	_seq += 1


func _io() -> Variant:
	return GLE.make_io(func(text: String) -> bool: return await _confirm(text, "OK"),
		func(text: String, ok: bool) -> void: status.emit(text, ok), func() -> void: reload.emit(false))


## The rear panel's GPU edit actions (web device-view-caspar-render.js pencil / Show all / Clear layout, -markers.js
## label drag), here to share the page's io; each drops the open editor's rows so it re-reads the saved layout.
func rear_action(what: String, a: String, b: String, payload: Dictionary) -> void:
	_layout = null
	match what:
		"show_all":
			GLE.FLOW.GL.save(GLE.FLOW.show_all(payload.get("live"), GLE.FLOW.suggested_outs(payload)))
			status.emit("All GPU ports shown", true)
			reload.emit(false)
		"clear":
			await GLE.FLOW.clear_layout(_io())
		"swap":
			var saved := GLE.FLOW.GL.saved()
			var flow = GLE.FLOW.new(payload, saved, _io())
			flow.items = GLE.FLOW.GL.layout_items(GLE.FLOW.GL.column_entries(payload, saved))
			await flow.swap(a, b)


## Opening a jack whose consumer keys were never written seeds them (web), then reloads so the page reads them back.
func _seed(patch: Dictionary) -> void:
	var r: Dictionary = await DevicesTarget.api.post_json("/api/settings", patch)
	if not r.ok:
		status.emit("GPU port defaults: " + _error(r), false)
		return
	await DevicesTarget.settings.load_from_server()
	reload.emit(false)


func _summary(rows: Array) -> Control:
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 10)
	for r in rows:
		g.add_child(_caption(r[0]))
		var v := _text(r[1], ThemeBuilder.ACCENT if r[2] else ThemeBuilder.TEXT, 11)
		v.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		g.add_child(v)
	return g


func _toggles() -> Control:
	var f := HFlowContainer.new()
	f.add_theme_constant_override("h_separation", 2)
	f.add_theme_constant_override("v_separation", 0)
	var add := func(field: String, label: String, tip: String) -> void:
		var on: bool = (not ui.windowed) if field == "fullscreen" else ui[field]
		var cb := _check(label, on, tip)
		cb.add_theme_font_size_override("font_size", 10)
		cb.toggled.connect(func(v: bool) -> void: _edit(field, v))
		_w[field] = cb
		f.add_child(cb)
	for c in BASE_CHECKS:
		add.call(c[0], c[1], c[2])
	for t in GO.TOGGLES:
		add.call(t[0], t[1], t[2])
		if t[0] == "operator_monitor":  # web order: the confine select sits right after Operator monitor
			var sel := _select(GO.CONFINE_OPTIONS, ui.confine, GO.CONFINE_TIP)
			sel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
			sel.item_selected.connect(func(i: int) -> void: _edit("confine", str(sel.get_item_metadata(i))))
			f.add_child(sel)
	return f


func _video_mode(mst: Dictionary) -> Control:
	var box := _section()
	box.add_child(_caption("Video Mode"))
	for note in [mst.screen_note, mst.feed_note]:
		if note != "":
			box.add_child(_note(note))
	box.add_child(_select_field("mode", GO.mode_options()))
	var row := _row()
	for f in ["custom_w", "custom_h", "custom_fps"]:
		row.add_child(_entry(f))
	_w.custom_row = row
	box.add_child(row)
	return box


func _system_resolution(mst: Dictionary) -> Control:
	var box := _section()
	var head := _text(mst.edid_headline, ThemeBuilder.WARN if mst.edid_warn else ThemeBuilder.TEXT, 11)
	box.add_child(head)
	box.add_child(_caption(mst.modes_label))
	var sel := _select_field("display", GM.display_options(mst))
	if not GM.display_options(mst).any(func(o: Array) -> bool: return o[0] == ui.display):
		sel.select(-1)  # no display: the saved pick has no row (web shows an empty select)
	box.add_child(sel)
	var os_row := _section()
	os_row.add_child(_caption("Custom OS resolution (WxH × fps)"))
	var fields := _row()
	for f in ["os_w", "os_h", "os_fps"]:
		fields.add_child(_entry(f))
	os_row.add_child(fields)
	_w.os_row = os_row
	box.add_child(os_row)
	var ov := _check("Override", ui.override, OVERRIDE_TIP)
	ov.add_theme_font_size_override("font_size", 10)
	ov.toggled.connect(func(v: bool) -> void: _edit("override", v))
	_w.override = ov
	box.add_child(ov)
	return box


func _timing_row() -> Control:
	var box := _section()
	_w.timing_label = _note("")
	box.add_child(_w.timing_label)
	var top := _row()
	var sel := _select_field("timing", GM.TIMING_OPTIONS)
	top.add_child(sel)
	_w.tier = _text("", ThemeBuilder.TEXT_MUTED, 9)
	_w.tier.tooltip_text = "Dot-clock tier (approx.)"
	_w.tier.mouse_filter = Control.MOUSE_FILTER_PASS
	top.add_child(_w.tier)
	box.add_child(top)
	_w.preview = VBoxContainer.new()
	_w.preview.add_theme_constant_override("separation", 0)
	box.add_child(_w.preview)
	_preview_text(["Loading timings…"])
	return box


func _advanced(cst: Dictionary, mst: Dictionary) -> Control:
	var box := _section()
	box.add_child(HSeparator.new())
	box.add_child(_caption("OS / X11 Settings (xrandr)"))
	box.add_child(_caption(GO.physical_line(cst, mst.display_name)))
	box.add_child(_field("OS apply backend", _select_field("backend", GM.BACKEND_OPTIONS)))
	box.add_child(HSeparator.new())
	box.add_child(_field("EDID override", _entry("edid")))
	box.add_child(_field("Stretch", _select_field("stretch", GO.STRETCH_OPTIONS.map(func(o: String) -> Array: return [o, o]))))
	box.add_child(_field("Colour Space", _select_field("colour", GO.COLOUR_OPTIONS.map(func(o: String) -> Array: return [o, o]))))
	box.add_child(_entry("name"))
	box.add_child(_entry("ar"))
	var pos := _row()
	pos.add_child(_entry("pos_x"))
	pos.add_child(_entry("pos_y"))
	box.add_child(pos)
	var reset := _button("Reset all settings for this screen", _reset, GO.RESET_TIP)
	reset.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	box.add_child(reset)
	return box


func _select_field(field: String, options: Array) -> OptionButton:
	var sel := _select(options, ui[field])
	sel.item_selected.connect(func(i: int) -> void: _edit(field, str(sel.get_item_metadata(i))))
	_w[field] = sel
	return sel


## A text field that commits on Enter / focus loss; W/H/rates go through the math commit (min clamp, fixed decimals).
func _entry(field: String) -> LineEdit:
	var spec: Array = INPUTS[field]
	var le := _line(str(ui[field]), spec[0])
	le.custom_minimum_size.x = 40
	var commit := func() -> void:
		var text := le.text
		if spec[2] >= 0:
			var last: Variant = GM.js_num(ui[field])
			text = MI.commit(le.text, spec[1], INF, spec[2], last if not is_nan(last) else null).text
			le.text = text
		if text != str(ui[field]):
			_edit(field, text)
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	_w[field] = le
	return le


## One edit → ui dict (gpu_output_ui.gd) → mirrored widgets → the effects (saves, preview).
func _edit(field: String, value: Variant) -> void:
	for e in GU.apply(ui, field, value):
		match e:
			"caspar", "os", "confine":
				_save(e)
			"preview":
				_timer.start()
	if field in ["fullscreen", "windowed"]:
		_w.fullscreen.set_pressed_no_signal(not ui.windowed)
		_w.windowed.set_pressed_no_signal(ui.windowed)
	if field == "operator_monitor":
		_w.interactive.set_pressed_no_signal(ui.interactive)
	if field == "mode":
		for f in ["custom_w", "custom_h", "custom_fps"]:
			_w[f].text = str(ui[f])
	_sync_rows()


func _sync_rows() -> void:
	_w.custom_row.visible = GU.custom_shown(ui)
	_w.os_row.visible = GU.os_custom_shown(ui)
	_w.timing_label.text = GP.timing_label(GU.os_custom_shown(ui))


## Posts one kind of save; the body is built at send time, so a burst of edits ends with the newest values.
func _save(kind: String) -> void:
	if _inflight.has(kind):
		_again[kind] = true
		return
	_inflight[kind] = true
	var ok := true
	while true:
		_again.erase(kind)
		var body := _body(kind)
		var r: Dictionary = await DevicesTarget.api.post_json("/api/settings", body)
		var err := _reply_error(r)
		ok = err == ""
		if not ok:
			status.emit("Save failed: " + err, false)
		if not _again.has(kind):
			break
	_inflight.erase(kind)
	if not ok:
		return
	if kind == "confine":
		status.emit("Pointer confine: " + str(ui.confine), true)
	else:
		if kind == "caspar":
			status.emit(GO.save_status(ui, _env.cst), true)
		dirty.emit()
	await DevicesTarget.settings.load_from_server()


func _body(kind: String) -> Dictionary:
	match kind:
		"caspar":
			return GO.caspar_patch(_env.cst, ui)
		"os":
			return GO.os_patch(_env.cst, _env.mst, ui)
	return GO.confine_patch(str(ui.confine))


func _reset() -> void:
	var n: int = _env.cst.port_n
	if not await _confirm("Are you sure you want to reset all settings for GPU port %d?" % n, "Reset"):
		return
	var r: Dictionary = await DevicesTarget.api.post_json("/api/settings", GO.reset_patch(_env.cst))
	var err := _reply_error(r)
	if err != "":
		status.emit("Reset failed: " + err, false)
		return
	await DevicesTarget.settings.load_from_server()
	status.emit("Settings for GPU port %d cleared" % n, true)
	reload.emit(false)


func _refresh_preview() -> void:
	if conn_id == "" or _env.is_empty():
		return
	_seq += 1
	var my := _seq
	_w.tier.text = ""
	_preview_text(["Loading timings…"])
	var dims := GP.preview_dims(ui, _env.mst, _env.cs, _env.settings, _env.cst.screen_n)
	var r: Dictionary = await DevicesTarget.api.get_json(GP.preview_query(dims, str(ui.timing)))
	if my != _seq or not is_instance_valid(_w.get("tier")):
		return
	var out := GP.preview_lines(r.data if r.ok else {"ok": false, "error": _error(r)})
	_w.tier.text = out.tier
	_preview_text([out.error] if out.error != "" else out.lines)


func _preview_text(lines: Array) -> void:
	for c in _w.preview.get_children():
		c.queue_free()
	for l in lines:
		var lab := _text(str(l), ThemeBuilder.TEXT_MUTED, 10)
		lab.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_w.preview.add_child(lab)


func _focused_index() -> int:
	var f := page.get_viewport().gui_get_focus_owner() if page.is_inside_tree() else null
	if f == null or not page.is_ancestor_of(f):
		return -1
	return page.find_children("*", "LineEdit", true, false).find(f)


func _refocus(i: int) -> void:
	var all := page.find_children("*", "LineEdit", true, false)
	if i < all.size():
		(all[i] as LineEdit).grab_focus()
