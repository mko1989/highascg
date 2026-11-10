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
var _meeting_box: VBoxContainer
var _meeting_status: Label
var _join: Button
var _mic: CheckBox
var _cam: CheckBox
var _win := {}  # "speaker" | "share" → Button
var _people_box: VBoxContainer
var _settings_note: Label
var _ui_pending := 0  # Meeting POSTs in flight: the poll leaves the toggles alone until they answer


func _init() -> void:
	page.add_theme_constant_override("separation", 8)
	page.add_child(_title("Zoom"))
	_status = _note("")
	page.add_child(_status)
	page.add_child(_meeting_section())
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
	r.fit = _check("Fill frame", false, "Only the picture inside the Zoom window, scaled to fill the frame (no Zoom bars)")
	r.fit.toggled.connect(func(on: bool) -> void: _edit(key, "fit", on))
	row.add_child(r.fit)
	box.add_child(row)
	r.live = _text("", ThemeBuilder.TEXT_MUTED, 11)
	box.add_child(r.live)
	r.host = _check("Live input", false, "Play this source on a layer of an input channel (route://<ch>-<layer>) — no restart")
	r.host.toggled.connect(func(on: bool) -> void: _host(key, on))
	box.add_child(r.host)
	r.host_note = _text("", ThemeBuilder.TEXT_MUTED, 11)
	box.add_child(r.host_note)
	_rows[key] = r
	return box


func _meeting_section() -> Control:
	_meeting_box = _section()
	_meeting_box.add_child(_title("Meeting"))
	_meeting_status = _note("")
	_meeting_box.add_child(_meeting_status)
	_join = _button("Join", func() -> void: _ui(M.join_body()), "Join from the open preview")
	_join.visible = false  # only while Zoom shows its join preview
	_meeting_box.add_child(_join)
	var tg := _row()
	_mic = _check("Microphone", false, "Zoom's real microphone state")
	_mic.toggled.connect(func(on: bool) -> void: _toggle("mic", on))
	tg.add_child(_mic)
	_cam = _check("Camera", false, "Zoom's real camera state")
	_cam.toggled.connect(func(on: bool) -> void: _toggle("cam", on))
	tg.add_child(_cam)
	_meeting_box.add_child(tg)
	_meeting_box.add_child(_caption("Main window shows"))
	var wr := _row()
	var grp := ButtonGroup.new()
	for w in [["speaker", "Speaker"], ["share", "Share"]]:
		var b := Button.new()
		b.text = w[1]
		b.toggle_mode = true
		b.button_group = grp
		b.focus_mode = Control.FOCUS_NONE
		var which: String = w[0]
		b.toggled.connect(func(on: bool) -> void: if on and not _syncing: _ui(M.main_window_body(which)))
		wr.add_child(b)
		_win[which] = b
	_meeting_box.add_child(wr)
	var pr := _row()
	pr.add_child(_button("Refresh", _participants, "List the participants (briefly drives the Zoom window)"))
	pr.add_child(_button("Unpin", func() -> void: _ui(M.pin_body("")), "Remove the pin"))
	_meeting_box.add_child(_caption("Participants"))
	_meeting_box.add_child(pr)
	_people_box = VBoxContainer.new()
	_meeting_box.add_child(_people_box)
	_meeting_box.add_child(_button("Apply Zoom settings", _apply_settings, "Set Zoom's options for playout (briefly drives the Zoom window)"))
	_settings_note = _note("")
	_meeting_box.add_child(_settings_note)
	return _meeting_box


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
	var ru: Dictionary = await DevicesTarget.api.get_json("/api/zoom/ui")
	_polling = false
	if not is_inside_tree():
		return
	_apply(rz, rh, ra)
	_apply_ui(ru)


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
		r.fit.set_pressed_no_signal(bool(src.get("fit", false)))
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
	_host_note.text = "Zoom inputs need Apply & restart once (Devices ▸ Apply): no input channel for them yet." if M.host_needs_restart(host) else ""
	_host_note.visible = _host_note.text != ""
	var av: Dictionary = M.audio_view(M.body(ra))
	var ok: bool = M.available(ra) and bool(av.available)
	_audio_on.disabled = not ok
	_audio_feed.disabled = not ok
	_audio_on.set_pressed_no_signal(av.enabled)
	_set_options(_audio_feed, av.feeds, av.feed)
	_audio_note.text = av.note if M.available(ra) else M.UNAVAILABLE
	_syncing = false


func _apply_ui(ru: Dictionary) -> void:
	var ok := M.available(ru)
	var u := M.body(ru)
	_meeting_status.text = M.ui_status(u) if ok else M.UNAVAILABLE
	_join.visible = ok and M.join_visible(u)
	var sr: Variant = u.get("settings")
	_settings_note.text = M.settings_line(sr if sr is Dictionary else {})
	if _ui_pending > 0:  # an operator click is still being answered: keep what they set
		return
	_syncing = true
	for k in ["mic", "cam"]:
		var v := M.toggle_view(u, k)
		var cb: CheckBox = _mic if k == "mic" else _cam
		cb.disabled = not ok or not v.enabled
		cb.set_pressed_no_signal(v.pressed)
	var cur := M.main_window(u)
	for k in _win:
		_win[k].disabled = not ok or (k == "share" and not M.share_tab_exists(u))
		_win[k].set_pressed_no_signal(ok and k == cur)
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


## A Meeting action: held (_ui_pending) so the poll cannot flip a toggle back before Zoom answers.
func _ui(body: Dictionary) -> Dictionary:
	_err.text = ""
	_ui_pending += 1
	var r: Dictionary = await DevicesTarget.api.post_json("/api/zoom/ui", body)
	_ui_pending -= 1
	var e := _reply_error(r)
	if e != "":
		_err.text = e
	poll()
	return r if e == "" else {}


func _toggle(kind: String, on: bool) -> void:
	if not _syncing:
		_ui(M.toggle_body(kind, on))


func _participants() -> void:
	var r := await _ui(M.participants_body())
	for c in _people_box.get_children():
		c.queue_free()
	for p in M.pin_rows(M.body(r)):
		var row := _row()
		var l := _text(p.label, ThemeBuilder.TEXT_MUTED, 11)
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(l)
		if p.pin:
			var name: String = p.name
			row.add_child(_button("Pin", func() -> void: _ui(M.pin_body(name)), "Pin %s in the main window" % name))
		_people_box.add_child(row)


func _apply_settings() -> void:
	_ui(M.settings_body())  # answers at once; the progress and the result arrive with the poll (state.settings)
