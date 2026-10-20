extends VBoxContainer
## WO-605 slice 3a — the destination page the Devices tab hands to the shared Inspector column (web
## renderDestinationInspector): summary table, mapped outputs, then the edits — name, main index, mode, audio
## outputs, video mode + size + fps, the pixel-map Art-Net fields, the operator-GUI fields — and Remove. Host channels
## get their own summary, role note and "Cabled to" list, plus the per-role controls host_channel_controls.gd builds
## (slice 3c; injected by the panel as `host_controls`, absent under the unit runner). The page only
## builds requests: `patch` / `remove` go to the tab, which posts, marks Caspar restart-dirty and reloads;
## `launch_operator_gui` is posted by the tab too (answer via launch_status) — no autoloads here, so it tests headless.

signal patch(id: String, body: Dictionary)
signal remove(id: String)
signal focus_connector(id: String)
signal launch_operator_gui()

const ThemeBuilder := preload("res://app/theme_builder.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const Model := preload("res://features/devices/devices_model.gd")
const MI := preload("res://core/math_input.gd")
const HS := preload("res://features/devices/host_source_model.gd")

var dest_id := ""
var host_controls: Node  # host_channel_controls.gd, or null (headless tests)
var _d: Dictionary
var _vals := {}  # summary key → value Label
var _size_fields: Array[LineEdit] = []  # width, height, fps
var _vm: OptionButton
var _launch_btn: Button
var _launch_line: Label


func _init() -> void:
	add_theme_constant_override("separation", 6)


## Rebuild for `entry` (devices_model build().destinations[i]); `payload` is the device-view snapshot.
func show_destination(entry: Dictionary, payload: Dictionary, settings: Variant) -> void:
	var focus := _focused_index()
	for c in get_children():
		remove_child(c)
		c.queue_free()
	_vals = {}
	_size_fields = []
	_d = entry.dest
	dest_id = entry.id
	var edges := R_edges(payload, entry.connector)
	if entry.host:
		_host_page(entry, payload, settings, edges)
	else:
		_screen_page(entry, payload, settings, edges)
	if focus >= 0:
		_refocus.call_deferred(focus)


static func R_edges(payload: Dictionary, connector: String) -> Array:
	return H.R.a(H.R.d(payload.get("graph")).get("edges")).filter(
		func(e: Variant) -> bool: return e is Dictionary and H.R.s(e.get("sourceId")) == connector)


## Web order: summary table, the role's controls, the role note, "Cabled to", then the removes / input-slot blocks.
func _host_page(entry: Dictionary, payload: Dictionary, settings: Variant, edges: Array) -> void:
	var role := DM.host_role(_d, entry.intent)
	var ch: Variant = H.coalesce([_d.get("casparChannel"), H.R.d(entry.intent).get("pgmChannel")])
	var src := HS.find_live_source(_d, role, ch, payload.get("extraLiveSources"))
	_table(DM.host_rows(_d, entry.intent, payload, src))
	var parts: Dictionary = host_controls.build(entry, payload, settings, src) if host_controls != null else {}
	for c in parts.get("top", []):
		add_child(c)
	var note := DM.host_note(role)
	if note != "":
		add_child(_note(note))
	if not edges.is_empty():
		add_child(_caption("Cabled to"))
		for e in edges:
			add_child(_link(e, payload, false))
	for c in parts.get("bottom", []):
		add_child(c)


func _screen_page(entry: Dictionary, payload: Dictionary, settings: Variant, edges: Array) -> void:
	var mode: String = entry.mode
	add_child(_caption("Selected destination"))
	_table(DM.summary_rows(_d, entry.intent))
	add_child(_caption("Mapped outputs"))
	if edges.is_empty():
		add_child(_muted("No mapped outputs yet."))
	for e in edges:
		add_child(_link(e, payload, true))
	add_child(HSeparator.new())
	var name_tip := "Name of this screen — shown in the looks selector, multiview, panels and Companion" \
		if mode == "pgm_prv" or mode == "pgm_only" else "Name of this destination"
	_field("Name", _line(str(entry.label), "Name", name_tip, func(t: String) -> void: _send(DM.label_patch(t, _d))))
	_field("Main index", _line(str(maxi(0, _int(_d.get("mainScreenIndex")))), "", "Main index (zero-based)",
		func(t: String) -> void: _send(DM.main_index_patch(t)), [0, INF, 0]))
	_field("Mode", _select(DM.MODE_OPTIONS, mode if mode in DM.MODE_OPTIONS.map(func(o: Array) -> String: return o[0]) else "pgm_prv",
		"", func(v: String) -> void: _send({"mode": v})))
	if DM.shows_audio(mode):
		var cur := H.R.s(_d.audioLayout) if H.truthy(_d.get("audioLayout")) else "stereo"
		_field("Audio outputs", _select(DM.LAYOUT_OPTIONS, cur if cur in DM.LAYOUT_OPTIONS.map(func(o: Array) -> String: return o[0]) else "stereo",
			"Number of audio output channels for this destination (program bus width)", func(v: String) -> void:
				_set_val("Audio outputs", DM.layout_label(v))
				_send({"audioLayout": v})))
	var modes := [["custom", "Custom"]]
	for m in DM.STANDARD_VIDEO_MODES:
		modes.append([m, m])
	var choice := DM.video_mode_choice(_d, settings)
	_vm = _select(modes, choice, "", _on_video_mode)
	_field("Video mode", _vm)
	var custom := choice == "custom"
	for spec in [["Width", str(DM.width(_d)), "width", [64, INF, 0]], ["Height", str(DM.height(_d)), "height", [64, INF, 0]],
			["Frame rate", DM.num(DM.fps(_d)), "fps", [1, INF, 2]]]:
		var key: String = spec[2]
		var le := _line(spec[1], spec[0], "", func(_t: String) -> void: _on_size(key), spec[3])
		le.editable = custom
		_size_fields.append(le)
		_field(spec[0], le)
	if mode == "pixelmap":
		_pixelmap_fields()
	if mode == "operator_gui":
		_operator_fields()
	var rm := Button.new()
	rm.text = "Remove destination"
	rm.pressed.connect(func() -> void: remove.emit(dest_id))
	add_child(rm)


func _on_video_mode(choice: String) -> void:
	var r := DM.video_mode_patch(choice, _d)
	if r.is_empty():
		return
	_set_num(_size_fields[0], float(r.width))
	_set_num(_size_fields[1], float(r.height))
	_set_num(_size_fields[2], float(r.fps))
	for le in _size_fields:
		le.editable = choice == "custom"
	_sync_video_summary(choice)
	_send(r.patch)


## Typing a size switches the select to Custom (ensureCustomModeSelected) and sends what the web sends.
func _on_size(field: String) -> void:
	_vm.select(0)
	for le in _size_fields:
		le.editable = true
	var p := DM.size_patch(field, _size_fields[0].text, _size_fields[1].text, _size_fields[2].text, _d)
	_sync_video_summary("custom")
	_send(p)


func _sync_video_summary(mode: String) -> void:
	var w := DM._clamp_int(_size_fields[0].text if _size_fields[0].text != "" else null, 1920, 64)
	var h := DM._clamp_int(_size_fields[1].text if _size_fields[1].text != "" else null, 1080, 64)
	var f := DM._clamp_float(_size_fields[2].text if _size_fields[2].text != "" else null, 50.0, 1.0)
	_set_val("Video mode", mode)
	_set_val("Resolution", "%dx%d" % [w, h])
	_set_val("FPS", DM.num(f))


func _pixelmap_fields() -> void:
	_field("Controller IP", _line(DM.artnet_value(_d, "ip"), "192.168.1.50",
		"Art-Net controller / node IP (fixture/host — required, valid IPv4)", func(t: String) -> void: _send(DM.artnet_patch("ip", t))))
	for spec in [["Fixture columns", "cols", "Fixture columns (horizontal panel count)"],
			["Fixture rows", "rows", "Fixture rows (vertical panel count)"]]:
		_artnet_int_field(spec)
	_field("Fixture type", _select([["RGB", "RGB (3ch)"], ["RGBW", "RGBW (4ch)"]], DM.artnet_value(_d, "colorOrder"),
		"Fixture type (fixture/type)", func(v: String) -> void: _send(DM.artnet_patch("colorOrder", v))))
	for spec in [["Start universe", "startUniverse", "Start Art-Net universe (fixture/universe, 0-32767). Additional universes auto-spill upward."],
			["Start DMX address", "startAddress", "Start DMX channel of the first fixture (fixture/start-address, 1-512)"],
			["DMX refresh rate (Hz)", "refreshRateHz", "DMX sends/sec, decoupled from the channel video rate (refresh-rate, default 10)"]]:
		_artnet_int_field(spec)
	add_child(_note(DM.PIXELMAP_NOTE))


func _artnet_int_field(spec: Array) -> void:
	var key: String = spec[1]
	var b: Array = DM.ARTNET[key]
	_field(spec[0], _line(str(DM.artnet_value(_d, key)), "", spec[2], func(t: String) -> void: _send(DM.artnet_patch(key, t)),
		[b[1], b[2] if b[2] > 0 else INF, 0]))


func _operator_fields() -> void:
	_field("Web-UI URL", _line(H.R.s(_d.get("guiUrl")), "http://127.0.0.1:4200/?operatorGui=1",
		"Fullscreen Firefox web-UI URL — must include ?operatorGui (or legacy ?cefOperator) for the client bundle to enter operator mode",
		func(t: String) -> void: _send({"guiUrl": t.strip_edges()})))
	var ports := [["", "Auto (operator monitor, else multiview jack)"]]
	for n in range(1, 5):
		ports.append([str(n), "Port %d" % n])
	_field("Physical GPU port (optional)", _select(ports, H.R.s(_d.get("physicalPort")) if _d.get("physicalPort") != null else "",
		"Physical GPU port for the operator-GUI window. Auto = the screen_N_operator_monitor flag (single connected display wins), falling back to the multiview jack — never a program screen.",
		func(v: String) -> void: _send(DM.physical_port_patch(v))))
	var auto := CheckBox.new()
	auto.text = "Auto-start at boot"
	auto.button_pressed = _d.get("autoLaunch") != false
	auto.tooltip_text = "Launch the operator GUI browser automatically when HighAsCG starts (skipped when no operator monitor resolves — multiple displays need a screen_N_operator_monitor flag or an explicit port)."
	auto.toggled.connect(func(on: bool) -> void: _send({"autoLaunch": on}))
	add_child(auto)
	add_child(_note(DM.OPG_NOTE))
	_launch_btn = Button.new()
	_launch_btn.text = "Launch / Bring to front"
	_launch_line = _muted("")
	_launch_btn.pressed.connect(func() -> void:
		launch_status("Launching...", true)
		launch_operator_gui.emit())
	add_child(_launch_btn)
	add_child(_launch_line)


## The tab reports the POST /api/operator-gui/launch outcome back here.
func launch_status(text: String, busy: bool) -> void:
	if is_instance_valid(_launch_line):
		_launch_line.text = text
		_launch_btn.disabled = busy


func _send(body: Dictionary) -> void:
	patch.emit(dest_id, body)


func _int(v: Variant) -> int:
	var n: Variant = H.js_int(H.coalesce([v, 0]))
	return n if n != null else 0


func _table(rows: Array) -> void:
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 12)
	for r in rows:
		g.add_child(_muted(r[0]))
		var v := _text(str(r[1]), ThemeBuilder.TEXT, 12)
		v.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		g.add_child(v)
		_vals[r[0]] = v
	add_child(g)


func _set_val(key: String, text: String) -> void:
	if _vals.has(key):
		_vals[key].text = text


## A mapped output: its connector label (click focuses that connector), "(Layer N)" above 1 on screen pages.
func _link(e: Dictionary, payload: Dictionary, layer: bool) -> Control:
	var h := HBoxContainer.new()
	var sink := H.R.s(e.get("sinkId"))
	var b := Button.new()
	b.flat = true
	b.text = _connector_label(payload, sink)
	b.tooltip_text = "Click to go to this output connector inspector" if layer else ""
	b.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	b.pressed.connect(func() -> void: focus_connector.emit(sink))
	h.add_child(b)
	var n := Model.output_layer(e)
	if layer and n > 1:
		h.add_child(_muted(" (Layer %d)" % n))
	return h


static func _connector_label(payload: Dictionary, id: String) -> String:
	var c: Dictionary = Model.connectors(payload).get(id, {})
	return H.R.s(c.label) if H.truthy(c.get("label")) else (id if id != "" else "Output")


func _field(caption: String, input: Control) -> void:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.add_child(_text(caption, ThemeBuilder.TEXT_MUTED, 10))
	v.add_child(input)
	add_child(v)


## A LineEdit that commits like an HTML input's `change`: on Enter or on leaving it, and only when the text changed.
## `num` = [min, max, decimals] makes it a web math input (attachMathInput): "1920/2" evaluates, the value is clamped
## and formatted, garbage or blank restores the last good value — and a commit whose corrected text is unchanged
## sends nothing (the web re-sends it, costing a restart-dirty and a reload).
func _line(text: String, placeholder: String, tip: String, on_commit: Callable, num: Array = []) -> LineEdit:
	var le := LineEdit.new()
	le.placeholder_text = placeholder
	le.tooltip_text = tip
	if num.is_empty():
		le.text = text
	else:
		le.set_meta("num", num)
		_set_num(le, MI.commit(text, num[0], num[1], num[2], null).value)
	le.set_meta("committed", le.text)
	var commit := func() -> void:
		if le.has_meta("num"):
			var n: Array = le.get_meta("num")
			var r := MI.commit(le.text, n[0], n[1], n[2], le.get_meta("last_good"))
			le.text = r.text
			le.set_meta("last_good", r.value)
		if le.text != le.get_meta("committed"):
			le.set_meta("committed", le.text)
			on_commit.call(le.text)
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	return le


## Programmatic value for a math LineEdit (video-mode presets): formatted, and the new committed / last-good value.
func _set_num(le: LineEdit, value: float) -> void:
	var n: Array = le.get_meta("num")
	le.text = MI.fixed(value, n[2])
	le.set_meta("last_good", value)
	le.set_meta("committed", le.text)


func _select(options: Array, value: String, tip: String, on_change: Callable) -> OptionButton:
	var ob := OptionButton.new()
	ob.tooltip_text = tip
	for i in options.size():
		ob.add_item(options[i][1], i)
		ob.set_item_metadata(i, options[i][0])
		if options[i][0] == value:
			ob.select(i)
	ob.item_selected.connect(func(i: int) -> void: on_change.call(str(ob.get_item_metadata(i))))
	return ob


func _caption(text: String) -> Label:
	return _text(text, ThemeBuilder.TEXT, 13)


func _muted(text: String) -> Label:
	return _text(text, ThemeBuilder.TEXT_MUTED, 11)


func _note(text: String) -> Label:
	var l := _muted(text)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 200
	return l


func _text(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


## A reload rebuilds the page; the LineEdit that had focus (by order) gets it back.
func _focused_index() -> int:
	var f := get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	if f == null or not is_ancestor_of(f):
		return -1
	return find_children("*", "LineEdit", true, false).find(f)


func _refocus(i: int) -> void:
	var all := find_children("*", "LineEdit", true, false)
	if i < all.size():
		(all[i] as LineEdit).grab_focus()
