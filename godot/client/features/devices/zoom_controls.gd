extends "res://features/devices/host_controls_base.gd"
## WO-1012 stage E — the Zoom device's page in the shared right-hand Inspector (Devices tab). node_panel.gd shows a
## "Zoom" card in the rear panel and calls `open()`; the page is handed to InspectorPanel like every device page.
## Built once; a poll (GET /api/zoom, /host, /audio, ~1 s, ONLY while the page is visible) updates the widgets in
## place, so an open picker or a half-typed link survives. A section whose route answers 404 says "not available yet"
## and the rest keeps working. zoom_model.gd holds the logic (labels, options, POST bodies).

const M := preload("res://features/devices/zoom_model.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const POLL_S := 1.0

var page := VBoxContainer.new()
var _timer := Timer.new()
var _polling := false
var _syncing := false  # widgets are being set from a poll: their signals are not edits
var _z := {}
var _prev := {}  # source key → published count at the previous poll
var _status: Label
var _err: Label
var _url: LineEdit
var _quit: Button
var _rows := {}  # key → {window, hidden, size, live, host, host_note}
var _host_note: Label
var _audio_box: VBoxContainer
var _audio_note: Label
var _audio_on: CheckBox
var _audio_feed: OptionButton


func _init() -> void:
	page.add_theme_constant_override("separation", 8)
	page.add_child(_title("Zoom"))
	_status = _note("")
	page.add_child(_status)
	_url = _line("", "Meeting link or number", "A zoom.us link or a meeting number")
	_url.select_all_on_focus = true
	_url.text_submitted.connect(func(_t: String) -> void: _start())
	page.add_child(_field("Meeting", _url))
	var row := _row()
	row.add_child(_button("Start Zoom", _start, "Launch Zoom and join the meeting link"))
	_quit = _button("Quit Zoom", _quit_zoom, "Close Zoom (leaves the meeting)")
	row.add_child(_quit)
	page.add_child(row)
	for s in M.SOURCES:
		page.add_child(_source_box(str(s[0]), str(s[1])))
	_host_note = _note("")
	page.add_child(_host_note)
	page.add_child(_audio_section())
	_err = _text("", ThemeBuilder.ERROR, 11)
	_err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	page.add_child(_err)
	_timer.wait_time = POLL_S
	_timer.timeout.connect(func() -> void: if page.is_visible_in_tree(): poll())


func _ready() -> void:
	add_child(_timer)
	_timer.start()
	page.visibility_changed.connect(func() -> void: if page.is_visible_in_tree(): poll())


## The rear-panel card (a flat section with one button) that opens this page.
func card() -> Control:
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.custom_minimum_size.x = 200.0
	v.add_theme_constant_override("separation", 8)
	v.add_child(_text("ZOOM", Color(ThemeBuilder.TEXT, 0.75), 10))
	var b := Button.new()
	b.text = "Zoom"
	b.custom_minimum_size = Vector2(0, 48)
	b.focus_mode = Control.FOCUS_NONE
	b.tooltip_text = "Zoom desktop client windows as sources"
	b.pressed.connect(open)
	v.add_child(b)
	return v


func open() -> void:
	if InspectorPanel.current != null:
		InspectorPanel.current.present(page)
	poll()


func _source_box(key: String, label: String) -> Control:
	var box := _section()
	box.add_child(_title(label))
	var r := {}
	r.window = _select([["", "Off"]], "", "The Zoom window grabbed as this source")
	r.window.item_selected.connect(func(i: int) -> void: _edit(key, "window", r.window.get_item_metadata(i)))
	box.add_child(r.window)
	var row := _row()
	r.hidden = _check("Hidden", false, "Keep the window under the GUI while it is grabbed")
	r.hidden.toggled.connect(func(on: bool) -> void: _edit(key, "hidden", on))
	row.add_child(r.hidden)
	r.size = _select(M.SIZES, "", "Grab size")
	r.size.item_selected.connect(func(i: int) -> void: _edit(key, "size", r.size.get_item_metadata(i)))
	row.add_child(r.size)
	box.add_child(row)
	r.live = _text("", ThemeBuilder.TEXT_MUTED, 11)
	box.add_child(r.live)
	r.host = _check("Host channel", false, "Make this source a Caspar host channel (route://) — needs Apply & restart")
	r.host.toggled.connect(func(on: bool) -> void: _host(key, on))
	box.add_child(r.host)
	r.host_note = _text("", ThemeBuilder.TEXT_MUTED, 11)
	box.add_child(r.host_note)
	_rows[key] = r
	return box


func _audio_section() -> Control:
	_audio_box = _section()
	_audio_box.add_child(_title("Audio"))
	_audio_on = _check("Zoom audio", false, "Route the meeting audio in and a feed out to the meeting")
	_audio_on.toggled.connect(func(on: bool) -> void: _audio("enabled", on))
	_audio_box.add_child(_audio_on)
	_audio_feed = _select([], "", "The feed sent into the meeting")
	_audio_feed.item_selected.connect(func(i: int) -> void: _audio("feed", _audio_feed.get_item_metadata(i)))
	_audio_box.add_child(_field("Send to meeting", _audio_feed))
	_audio_note = _note("")
	_audio_box.add_child(_audio_note)
	return _audio_box


# ---------------------------------------------------------------- poll

func poll() -> void:
	if _polling:
		return
	_polling = true
	var rz: Dictionary = await DevicesTarget.api.get_json("/api/zoom")
	var rh: Dictionary = await DevicesTarget.api.get_json("/api/zoom/host")
	var ra: Dictionary = await DevicesTarget.api.get_json("/api/zoom/audio")
	_polling = false
	if not is_inside_tree():
		return
	_apply(rz, rh, ra)


func _apply(rz: Dictionary, rh: Dictionary, ra: Dictionary) -> void:
	_syncing = true
	_z = M.body(rz)
	_status.text = M.status_line(_z) if M.available(rz) else "Zoom: %s" % (M.UNAVAILABLE if int(rz.get("status", 0)) == 404 else "no answer from the server")
	_quit.disabled = not M.running(_z)
	var host := M.body(rh)
	var host_ok := M.available(rh)
	for s in M.SOURCES:
		var key := str(s[0])
		var r: Dictionary = _rows[key]
		var src := M.source_of(_z, key)
		_set_options(r.window, M.window_options_for(_z, key), str(src.get("window", "")) if src.get("window") != null else "")
		r.hidden.set_pressed_no_signal(bool(src.get("hidden", false)))
		var size := str(src.get("size", "1920x1080"))
		var sizes: Array = M.SIZES.duplicate()
		if not M.SIZES.any(func(o: Array) -> bool: return o[0] == size):
			sizes.append([size, size])
		_set_options(r.size, sizes, size)
		var prev: int = _prev.get(key, -1)
		r.live.text = M.live_text(src, prev) if not src.is_empty() else ""
		r.live.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if M.live(src, prev) else ThemeBuilder.TEXT_MUTED)
		_prev[key] = int(src.get("published", 0)) if not src.is_empty() else -1
		var e := M.host_entry(host, key)
		r.host.disabled = not host_ok
		r.host.set_pressed_no_signal(bool(e.get("configured", false)))
		r.host_note.text = M.host_text(host, key) if host_ok else M.UNAVAILABLE
		r.host_note.visible = r.host_note.text != ""
	_host_note.text = "Host-channel changes need Apply & restart (Devices ▸ Apply)." if M.host_needs_restart(host) else ""
	_host_note.visible = _host_note.text != ""
	var av: Dictionary = M.audio_view(M.body(ra))
	var ok: bool = M.available(ra) and bool(av.available)
	_audio_on.disabled = not ok
	_audio_feed.disabled = not ok
	_audio_on.set_pressed_no_signal(av.enabled)
	_set_options(_audio_feed, av.feeds, av.feed)
	_audio_note.text = av.note if M.available(ra) else M.UNAVAILABLE
	_syncing = false


func _set_options(ob: OptionButton, options: Array, value: String) -> void:
	if ob.get_popup().visible:  # the operator is choosing: do not pull the list from under them
		return
	var same := ob.item_count == options.size()
	if same:
		for i in options.size():
			same = same and ob.get_item_metadata(i) == options[i][0] and ob.get_item_text(i) == options[i][1]
	if not same:
		_fill(ob, options, value)
		return
	for i in options.size():
		if options[i][0] == value:
			ob.select(i)


# ---------------------------------------------------------------- actions

func _post(path: String, body: Dictionary) -> bool:
	_err.text = ""
	var r: Dictionary = await DevicesTarget.api.post_json(path, body)
	var e := _reply_error(r)
	if e != "":
		_err.text = e
	poll()
	return e == ""


func _edit(key: String, field: String, value: Variant) -> void:
	if not _syncing:
		_post("/api/zoom/source", M.source_body(key, field, value))


func _host(key: String, on: bool) -> void:
	if not _syncing:
		_post("/api/zoom/host", M.host_body(key, on))


func _audio(field: String, value: Variant) -> void:
	if not _syncing:
		_post("/api/zoom/audio", M.audio_body(field, value))


func _start() -> void:
	_post("/api/zoom/launch", M.launch_body(_url.text))


func _quit_zoom() -> void:
	if await _confirm("Quit Zoom? This leaves the meeting.", "Quit Zoom"):
		_post("/api/zoom/quit", {})
