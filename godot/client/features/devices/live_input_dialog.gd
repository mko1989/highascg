extends Node
## WO-605 slice 11 — the "Add live input" dialog (web live-input-modal.js + -shell.js + -shell-v4l2.js) over
## live_input_flow.gd: type, hint, one section per type (DeckLink port + host channel, NDI discover / name,
## system browser URL + size, webpage URL / template + CG, ALSA device, V4L2 device + format / fps / audio), then
## "Add live source" and its status line. A fresh dialog per open, like the web modal; it closes 1.5 s after an add.
## Opened by the Devices "Add live input" band's "+" and the Matrix view's "+ Live input".

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/devices/live_input_model.gd")
const Flow := preload("res://features/devices/live_input_flow.gd")
const SR := preload("res://features/devices/stream_record_model.gd")

signal dirty  ## Caspar restart-dirty
signal added  ## web onAdded: the Devices tab reloads

var _dlg: AcceptDialog
var _flow: Flow
var _w := {}  # field id / view key → control
var _sections := {}  # kind → its section
var _syncing := false


class _Io:
	extends RefCounted
	var c

	func _init(owner: Node) -> void:
		c = owner

	static func _web(r: Dictionary) -> Dictionary:
		var err := ""
		if not r.ok:
			err = "HTTP %d: %s" % [r.status, r.error] if int(r.get("status", 0)) > 0 else str(r.error)
		return {"ok": r.ok, "data": r.data, "error": err}

	func get_json(path: String) -> Dictionary:
		return _web(await Api.get_json(path))

	func post_json(path: String, body: Variant) -> Dictionary:
		return _web(await Api.post_json(path, body))

	func load_settings() -> Dictionary:
		await Settings.load_from_server()
		return Settings.settings

	func dirty() -> void:
		c.dirty.emit()

	func added() -> void:
		c.added.emit()
		c._close_later()

	func changed() -> void:
		c._render()


func is_open() -> bool:
	return _dlg != null and is_instance_valid(_dlg) and _dlg.visible


func open() -> void:
	if is_open():
		_dlg.queue_free()
	_build()
	_flow = Flow.new(Settings.settings, {"channelMap": Store.get_value("channelMap"),
		"configComparison": Store.get_value("configComparison"), "templates": Store.get_value("templates")}, _Io.new(self))
	_render()
	_dlg.popup_centered(Vector2i(560, 0))
	await _flow.start()


func _close_later() -> void:
	var d := _dlg
	await get_tree().create_timer(1.5).timeout
	if is_instance_valid(d):
		d.queue_free()


func _build() -> void:
	_w = {}
	_sections = {}
	_dlg = AcceptDialog.new()
	_dlg.title = "Add live input"
	_dlg.ok_button_text = "Add live source"
	_dlg.dialog_hide_on_ok = false
	_dlg.confirmed.connect(func() -> void: _flow.submit())
	_dlg.canceled.connect(_dlg.queue_free)
	add_child(_dlg)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	v.custom_minimum_size.x = 520
	_dlg.add_child(v)
	v.add_child(_text("Type"))
	var kind := _select("kind", v)
	_fill(kind, M.KINDS, "decklink")
	kind.item_selected.connect(func(i: int) -> void: _flow.set_kind(kind.get_item_metadata(i)))
	var hint := RichTextLabel.new()
	hint.bbcode_enabled = true
	hint.fit_content = true
	hint.add_theme_font_size_override("normal_font_size", 12)
	hint.add_theme_font_size_override("bold_font_size", 12)
	hint.add_theme_font_size_override("mono_font_size", 12)
	hint.add_theme_color_override("default_color", ThemeBuilder.TEXT_MUTED)
	_w.hint = hint
	v.add_child(hint)
	_decklink(_section("decklink", v))
	_ndi(_section("ndi", v))
	_browser_display(_section("browser_display", v))
	_browser(_section("browser", v))
	_live_audio(_section("live_audio", v))
	_v4l2(_section("usb_video", v))
	var st := _text("")
	st.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_w.status = st
	v.add_child(st)


func _decklink(v: VBoxContainer) -> void:
	var row := HBoxContainer.new()
	v.add_child(row)
	row.add_child(_text("Caspar host channel: "))
	row.add_child(_mark("ch_fixed", _text("—", ThemeBuilder.TEXT)))
	var note := _mark("ch_note", _text(""))
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	note.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(note)
	v.add_child(_text("SDI port"))
	var ports := HBoxContainer.new()
	v.add_child(ports)
	_select("decklink-slot", ports).custom_minimum_size.x = 200
	ports.add_child(_mark("port_status", _text("")))


func _ndi(v: VBoxContainer) -> void:
	v.add_child(_text("NDI source"))
	var row := HBoxContainer.new()
	v.add_child(row)
	row.add_child(_button("Discover NDI sources", func() -> void: _flow.discover_ndi()))
	row.add_child(_mark("ndi_status", _text("")))
	_select("ndi-select", v)
	v.add_child(_text("Or type name manually"))
	_line("ndi-manual", v, "Exact NDI source name")
	var attr := _text(SR.NDI_ATTRIBUTION)
	attr.add_theme_font_size_override("font_size", 10)
	v.add_child(attr)


func _browser_display(v: VBoxContainer) -> void:
	v.add_child(_text("URL"))
	_line("browser-display-url", v, "https://...")
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	v.add_child(row)
	for f in [["browser-display-width", "Width (px)"], ["browser-display-height", "Height (px)"], ["browser-display-fps", "FPS"]]:
		var col := VBoxContainer.new()
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(col)
		col.add_child(_text(f[1]))
		_line(f[0], col, "")
	var note := _text(M.BD_NOTE)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(note)


func _browser(v: VBoxContainer) -> void:
	_check("browser-use-template", "Template", v)
	_w.url_label = _text("URL")
	v.add_child(_w.url_label)
	_line("browser-url", v, "https://...")
	_w.template_label = _text("Template")
	v.add_child(_w.template_label)
	_select("browser-template", v)
	_check("browser-as-cg", M.CG_TEXT, v)


func _live_audio(v: VBoxContainer) -> void:
	v.add_child(_text("ALSA / USB capture device"))
	var row := HBoxContainer.new()
	v.add_child(row)
	row.add_child(_button("Refresh devices", func() -> void: _flow.refresh_audio()))
	row.add_child(_mark("audio_status", _text("")))
	_select("audio-select", v)
	v.add_child(_text("Or type ALSA URI manually"))
	_line("audio-manual", v, "alsa://hw:1,0")
	v.add_child(_mark("audio_hint", _text("")))


func _v4l2(v: VBoxContainer) -> void:
	v.add_child(_text("USB / V4L2 capture device"))
	var row := HBoxContainer.new()
	v.add_child(row)
	row.add_child(_button("Refresh devices", func() -> void: _flow.refresh_v4l2()))
	row.add_child(_mark("v4l2_status", _text("")))
	_select("v4l2-select", v)
	v.add_child(_text("Or type device path manually"))
	_line("v4l2-manual", v, "/dev/video0")
	v.add_child(_text("Label (optional)"))
	_line("v4l2-label", v, "ATEM PGM")
	var fmt := HBoxContainer.new()
	fmt.add_theme_constant_override("separation", 12)
	v.add_child(fmt)
	var c1 := VBoxContainer.new()
	fmt.add_child(c1)
	c1.add_child(_text("Format"))
	_fill(_select("v4l2-format", c1), M.V4L2_FORMATS.map(func(f: String) -> Array: return [f, f]), "auto")
	var c2 := VBoxContainer.new()
	fmt.add_child(c2)
	c2.add_child(_text("FPS (0=auto)"))
	_line("v4l2-fps", c2, "")
	v.add_child(_mark("v4l2_hint", _text("")))
	v.add_child(_text("Audio (optional)"))
	_select("v4l2-audio-select", v)
	v.add_child(_text("Or type ALSA device manually"))
	_line("v4l2-audio-manual", v, "none or hw:3,0")


# ---------------------------------------------------------------- render

## Push the flow state into the controls (option lists rebuilt only when they change).
func _render() -> void:
	if _dlg == null or not is_instance_valid(_dlg) or _flow == null:
		return
	_syncing = true
	var s: Dictionary = _flow.s
	for k in _sections:
		_sections[k].visible = k == s.kind
	_w.hint.text = M.bbcode(s.hint)
	_w.status.text = s.status
	_w.status.add_theme_color_override("font_color", Color("#e74c3c") if s.error else ThemeBuilder.TEXT_MUTED)
	_dlg.get_ok_button().disabled = s.busy
	for k in ["ch_fixed", "ch_note", "port_status", "ndi_status", "audio_status", "audio_hint", "v4l2_status", "v4l2_hint"]:
		_w[k].text = s[k]
	_fill(_w["decklink-slot"], s.ports, s["decklink-slot"])
	_fill(_w["ndi-select"], s.ndi, s["ndi-select"])
	_fill(_w["browser-template"], s.templates, s["browser-template"])
	_fill(_w["audio-select"], s.audio, s["audio-select"])
	_fill(_w["v4l2-select"], s.v4l2, s["v4l2-select"])
	_fill(_w["v4l2-audio-select"], s["v4l2-audio"], s["v4l2-audio-select"])
	for id in _w:
		if _w[id] is LineEdit and _w[id].text != str(s[id]):
			_w[id].text = str(s[id])
		elif _w[id] is CheckBox:
			_w[id].set_pressed_no_signal(s[id])
	var tpl: bool = s["browser-use-template"]
	_w.url_label.visible = not tpl
	_w["browser-url"].visible = not tpl
	_w.template_label.visible = tpl
	_w["browser-template"].visible = tpl
	_syncing = false


## Options [[value, label(, disabled)]…] into `ob` (rebuilt when the list changed), then select `value`.
static func _fill(ob: OptionButton, options: Array, value: Variant) -> void:
	var sig := JSON.stringify(options)
	if ob.get_meta("options", "") != sig:
		ob.set_meta("options", sig)
		ob.clear()
		for i in options.size():
			ob.add_item(str(options[i][1]), i)
			ob.set_item_metadata(i, str(options[i][0]))
			if options[i].size() > 2 and options[i][2]:
				ob.set_item_disabled(i, true)
	for i in ob.item_count:
		if ob.get_item_metadata(i) == str(value):
			ob.select(i)
			return
	ob.select(-1)


# ---------------------------------------------------------------- widgets

func _section(kind: String, parent: VBoxContainer) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 4)
	_sections[kind] = v
	parent.add_child(v)
	return v


func _mark(key: String, c: Control) -> Control:
	_w[key] = c
	return c


func _select(id: String, parent: Control) -> OptionButton:
	var ob := OptionButton.new()
	ob.focus_mode = Control.FOCUS_NONE
	ob.fit_to_longest_item = false
	ob.clip_text = true
	ob.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	if id != "kind":
		ob.item_selected.connect(func(i: int) -> void:
			if not _syncing:
				_flow.set_field(id, ob.get_item_metadata(i)))
	_w[id] = ob
	parent.add_child(ob)
	return ob


func _line(id: String, parent: Control, hint: String) -> LineEdit:
	var e := LineEdit.new()
	e.placeholder_text = hint
	e.text_changed.connect(func(t: String) -> void:
		if not _syncing:
			_flow.set_field(id, t))
	_w[id] = e
	parent.add_child(e)
	return e


func _check(id: String, text: String, parent: Control) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.focus_mode = Control.FOCUS_NONE
	c.toggled.connect(func(on: bool) -> void:
		if not _syncing:
			_flow.set_field(id, on))
	_w[id] = c
	parent.add_child(c)
	return c


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(cb)
	return b


func _text(text: String, color: Color = ThemeBuilder.TEXT_MUTED) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", color)
	return l
