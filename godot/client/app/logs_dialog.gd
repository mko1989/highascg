extends AcceptDialog
## WO-608 — server logs (web client/components/logs-modal.js), opened from the connection eyes. HighAsCG lines load
## from GET /api/logs (level / category filter in node) and then arrive live as WS `log_line`; the Caspar log file
## is tailed every 2 s (the pane is replaced only when the file changed). The AMCP line under the Caspar pane sends through POST /api/raw; the reply shows under it. Copy / Clear HighAsCG.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const L := preload("res://app/logs_model.gd")

const POLL_S := 2.0

var _high_on := true
var _caspar_on := true
var _categories: Array = L.default_categories()
var _levels: Array = L.DEFAULT_LEVELS.duplicate()
var _high: TextEdit
var _caspar: TextEdit
var _high_pane: Control
var _caspar_pane: Control
var _pause: CheckBox
var _cats: MenuButton
var _amcp: LineEdit
var _reply: Label  # the last AMCP command + reply (the 2 s tail would replace an echo in the pane)
var _poll: Timer
var _last_caspar := ""
var _gen := 0  # a filter change outdates a pending load


func _init() -> void:
	title = "Server logs"
	ok_button_text = "Close"
	exclusive = false
	size = Vector2i(1400, 820)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	add_child(body)
	body.add_child(_toolbar())
	var split := HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.custom_minimum_size = Vector2(1360, 700)
	body.add_child(split)
	_high = _text()
	_high_pane = _pane("HighAsCG  ● live", _high)
	split.add_child(_high_pane)
	_caspar = _text()
	_amcp = LineEdit.new()
	_amcp.text_submitted.connect(_send_amcp)
	_reply = Label.new()
	_reply.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_reply.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_caspar_pane = _pane("CasparCG", _caspar, _amcp)
	_caspar_pane.add_child(_reply)
	split.add_child(_caspar_pane)
	_poll = Timer.new()
	_poll.wait_time = POLL_S
	_poll.timeout.connect(_load_caspar)
	add_child(_poll)
	Ws.message.connect(_on_ws)
	visibility_changed.connect(func() -> void:
		if not visible:
			_poll.stop())


func open() -> void:
	var c: Variant = Settings.get_setting("caspar", {})
	var cd: Dictionary = c if c is Dictionary else {}
	_amcp.placeholder_text = "AMCP → %s:%s  (Enter sends)" % [str(cd.get("host", "127.0.0.1")), str(int(cd.get("port", 5250)))]
	popup_centered()
	_load_high()
	_last_caspar = ""
	_load_caspar()
	_poll.start()


func _toolbar() -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	for spec in [["HighAsCG", func(on: bool) -> void: _high_on = on; _sync_panes(); _load_high()],
			["CasparCG", func(on: bool) -> void: _caspar_on = on; _sync_panes(); _load_caspar()]]:
		var b := CheckButton.new()
		b.text = spec[0]
		b.button_pressed = true
		b.toggled.connect(spec[1])
		row.add_child(b)
	row.add_child(VSeparator.new())
	for lv in L.LEVELS:
		var cb := CheckBox.new()
		cb.text = lv
		cb.button_pressed = _levels.has(lv)
		cb.toggled.connect(func(on: bool) -> void:
			if on and not _levels.has(lv):
				_levels.append(lv)
			elif not on:
				_levels.erase(lv)
			_load_high())
		row.add_child(cb)
	_cats = MenuButton.new()
	_cats.flat = false
	_cats.get_popup().hide_on_checkable_item_selection = false
	_cats.get_popup().index_pressed.connect(_toggle_category)
	_fill_categories()
	row.add_child(_cats)
	row.add_child(VSeparator.new())
	_pause = CheckBox.new()
	_pause.text = "Pause"
	row.add_child(_pause)
	for spec in [["Copy", _copy], ["Clear HighAsCG", _clear_high]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(spec[1])
		row.add_child(b)
	return row


func _text() -> TextEdit:
	var te := TextEdit.new()
	te.editable = false
	te.size_flags_vertical = Control.SIZE_EXPAND_FILL
	te.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	te.add_theme_font_size_override("font_size", 12)
	return te


func _pane(heading: String, te: TextEdit, extra: Control = null) -> Control:
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var h := Label.new()
	h.text = heading
	h.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(h)
	v.add_child(te)
	if extra != null:
		v.add_child(extra)
	return v


func _sync_panes() -> void:
	_high_pane.visible = _high_on
	_caspar_pane.visible = _caspar_on


func _fill_categories() -> void:
	var pop := _cats.get_popup()
	pop.clear()
	pop.add_check_item("All")
	pop.set_item_checked(0, _categories.size() == L.CATEGORIES.size())
	pop.add_separator()
	for c in L.CATEGORIES:
		pop.add_check_item(c[1])
		pop.set_item_checked(pop.item_count - 1, _categories.has(c[0]))
	_cats.text = "Categories (%d/%d) ▾" % [_categories.size(), L.CATEGORIES.size()]


func _toggle_category(i: int) -> void:
	if i == 0:
		var all := _categories.size() == L.CATEGORIES.size()
		_categories = [] if all else L.CATEGORIES.map(func(c: Array) -> String: return c[0])
	elif i >= 2:
		var id: String = L.CATEGORIES[i - 2][0]
		if _categories.has(id):
			_categories.erase(id)
		else:
			_categories.append(id)
	_fill_categories()
	_load_high()


func _load_high() -> void:
	if not _high_on or not visible:
		return
	_gen += 1
	var gen := _gen
	_high.text = "(loading…)"
	var res: Dictionary = await Api.get_json(L.query(_categories, _levels))
	if gen != _gen:
		return
	var lines: Variant = (res.data as Dictionary).get("highascg", []) if res.ok and res.data is Dictionary else null
	if not (lines is Array):
		_high.text = "(could not load: %s)" % str(res.get("error", ""))
		return
	_high.text = "\n".join((lines as Array).map(func(l: Variant) -> String: return str(l)))
	_to_bottom(_high)


func _load_caspar() -> void:
	if not _caspar_on or not visible or _pause.button_pressed:
		return
	var res: Dictionary = await Api.get_json("/api/logs?lines=500&highascg=0")
	if not res.ok or not (res.data is Dictionary):
		return
	var lines: Variant = (res.data as Dictionary).get("caspar", [])
	var text := "\n".join((lines as Array).map(func(l: Variant) -> String: return str(l))) if lines is Array else ""
	if text == "":
		text = "(no Caspar log at %s)" % str(res.data.get("casparPath", "?"))
	if text == _last_caspar:
		return
	_last_caspar = text
	var at_end := _at_bottom(_caspar)
	_caspar.text = text
	if at_end:
		_to_bottom(_caspar)


func _on_ws(type: String, data: Variant) -> void:
	if type != "log_line" or not visible or not _high_on or _pause.button_pressed:
		return
	var rec := L.record(data)
	if not L.matches(rec, _categories, _levels):
		return
	var at_end := _at_bottom(_high)
	_high.text = L.append("" if _high.text == "(loading…)" else _high.text, rec.line)
	if at_end:
		_to_bottom(_high)


func _send_amcp(cmd: String) -> void:
	cmd = cmd.strip_edges()
	if cmd == "":
		return
	_amcp.editable = false
	var stamp := Time.get_time_string_from_system()
	_reply.text = ">> [%s] %s" % [stamp, cmd]
	var res: Dictionary = await Api.post_json("/api/raw", {"cmd": cmd})
	var body: Variant = (res.data as Dictionary).get("data", res.data) if res.data is Dictionary else res.data
	var reply := str(body).strip_edges().replace("\r\n", "\n") if res.ok else "!! " + str(res.error)
	_reply.text = ">> [%s] %s\n%s" % [stamp, cmd, ("<< " + reply) if res.ok else reply]
	_amcp.text = ""
	_amcp.editable = true
	_amcp.grab_focus()


func _copy() -> void:
	var parts: Array = []
	if _high_on:
		parts.append("=== HighAsCG ===\n" + _high.text)
	if _caspar_on:
		parts.append("=== CasparCG ===\n" + _caspar.text)
	DisplayServer.clipboard_set("\n\n".join(parts))


func _clear_high() -> void:
	await Api.post_json("/api/logs/clear", {"target": "highascg"})
	_high.text = ""


func _at_bottom(te: TextEdit) -> bool:
	return te.scroll_vertical >= te.get_v_scroll_bar().max_value - te.get_v_scroll_bar().page - 3


func _to_bottom(te: TextEdit) -> void:
	te.set_deferred("scroll_vertical", 1e9)
