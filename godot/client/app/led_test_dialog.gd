extends AcceptDialog
## WO-629 — "Test card…" (web led-test-modal.js): pattern, grid geometry, labels, and per channel "Show test card" +
## "Full LED grid". Everything is stored in node (POST /api/led-test-card/settings — node re-applies while the card is
## up); "Show" switches that channel right away (POST …/channel). Edits post 0.4 s after the last change.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://app/led_test_model.gd")

const POST_DELAY_S := 0.4

signal notice(n: Dictionary)

var settings: Dictionary = {}
var _patterns: Array = []
var _filling := false
var _post: Timer
var _body: VBoxContainer
var _f := {}  # field name → control
var _show := {}  # channel → CheckBox
var _grid := {}  # channel → CheckBox


func _init() -> void:
	title = "LED test card"
	ok_button_text = "Close"
	size = Vector2i(640, 640)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.custom_minimum_size = Vector2(600, 560)
	add_child(scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_theme_constant_override("separation", 8)
	scroll.add_child(_body)
	_post = Timer.new()
	_post.one_shot = true
	_post.timeout.connect(_send)
	add_child(_post)
	visibility_changed.connect(func() -> void:
		if not visible and not _post.is_stopped():
			_post.stop()
			_send())  # closing never drops the last edit


func open() -> void:
	for c in _body.get_children():
		c.queue_free()
	_body.add_child(_muted("Loading…"))
	popup_centered()
	var res: Dictionary = await Api.get_json("/api/led-test-card/settings")
	for c in _body.get_children():
		c.queue_free()
	if not res.ok or not (res.data is Dictionary):
		_body.add_child(_muted("Could not load the test card settings: " + str(res.error)))
		return
	settings = res.data.get("settings", {})
	_patterns = res.data.get("patterns", [])
	_build(res.data.get("channels", []))


func _build(channels: Array) -> void:
	_filling = true
	_f.clear()
	_show.clear()
	_grid.clear()
	var look := _section("Pattern")
	var pat := OptionButton.new()
	pat.item_selected.connect(func(_i: int) -> void:
		_sync_extras()
		_changed())
	_f.pattern = pat
	look.add_child(_row("Pattern", pat))
	var marks := HBoxContainer.new()
	marks.add_child(_check("showCircle", "Circle"))
	marks.add_child(_check("showCross", "Crosshair"))
	look.add_child(marks)
	_f.chars_row = _row("", _spin("charCount", 1, 48))
	look.add_child(_f.chars_row)
	_f.speed_row = _row("Builder speed (1 slow – 10 fast)", _spin("builderSpeed", 1, 10))
	look.add_child(_f.speed_row)
	var grid := _section("LED grid (channels with Full LED grid)")
	var g := GridContainer.new()
	g.columns = 4
	for k in [["cols", "Columns", 256], ["rows", "Rows", 256], ["panelWidth", "Panel width (px)", 16384], ["panelHeight", "Panel height (px)", 16384]]:
		var l := Label.new()
		l.text = k[1]
		g.add_child(l)
		g.add_child(_spin(k[0], 1, k[2]))
	grid.add_child(g)
	var labels := _section("Labels")
	var title_edit := LineEdit.new()
	title_edit.text = str(settings.get("centerLabel", "HighAsCG"))
	title_edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_edit.text_changed.connect(func(_t: String) -> void: _changed())
	_f.centerLabel = title_edit
	labels.add_child(_row("Title / brand", title_edit))
	labels.add_child(_check("showCenterCharacter", "Show center character (graphic + title)"))
	labels.add_child(_check("showPanelLabels", "Panel R×C labels (grid mode)"))
	labels.add_child(_check("showSpecLine", "Resolution line (footer, grid mode)"))
	var chs := _section("Channels")
	if channels.is_empty():
		chs.add_child(_muted("Connect to Caspar to list its channels."))
	for row in channels:
		var ch := str(int(row.index))
		var line := HBoxContainer.new()
		var show := CheckBox.new()
		show.text = "Show"
		show.button_pressed = (settings.get("channelsEnabled", {}) as Dictionary).get(ch) == true
		show.toggled.connect(_switch_channel.bind(int(row.index)))
		_show[ch] = show
		line.add_child(show)
		var full := CheckBox.new()
		full.text = "Full LED grid"
		full.button_pressed = (settings.get("gridByChannel", {}) as Dictionary).get(ch) == true
		full.toggled.connect(func(_on: bool) -> void:
			_fill_patterns()
			_changed())
		_grid[ch] = full
		line.add_child(full)
		var l := Label.new()
		l.text = M.channel_label(row)
		l.modulate = ThemeBuilder.TEXT_MUTED
		line.add_child(l)
		chs.add_child(line)
	_fill_patterns()
	_sync_extras()
	_filling = false


func _fill_patterns() -> void:
	var pat: OptionButton = _f.pattern
	var want := str(settings.get("pattern", "grid-white")) if pat.item_count == 0 else _pattern_id()
	pat.clear()
	var rows := M.pattern_rows(_patterns, M.any_on(_collect_grid()))
	for i in rows.size():
		pat.add_item(str(rows[i].name), i)
		pat.set_item_metadata(i, rows[i].id)
		pat.set_item_disabled(i, rows[i].disabled)
		if rows[i].id == want and not rows[i].disabled:
			pat.select(i)
	if pat.selected < 0 and pat.item_count > 0:
		pat.select(0)  # the builder lost its last grid channel → back to the plain grid, as node normalises it
		_sync_extras()


func _sync_extras() -> void:
	var e := M.extras(_pattern_id())
	_f.chars_row.visible = e.chars
	(_f.chars_row.get_child(0) as Label).text = e.chars_label
	_f.speed_row.visible = e.speed


func _pattern_id() -> String:
	var pat: OptionButton = _f.pattern
	return str(pat.get_item_metadata(pat.selected)) if pat.selected >= 0 else "grid-white"


func _collect_grid() -> Dictionary:
	var m := {}
	for ch in _grid:
		if (_grid[ch] as CheckBox).button_pressed:
			m[ch] = true
	return m


func collect() -> Dictionary:
	var out := {"pattern": _pattern_id(), "centerLabel": (_f.centerLabel as LineEdit).text.strip_edges(), "gridByChannel": _collect_grid()}
	for k in ["cols", "rows", "panelWidth", "panelHeight", "charCount", "builderSpeed"]:
		out[k] = int((_f[k] as SpinBox).value)
	for k in ["showCircle", "showCross", "showCenterCharacter", "showPanelLabels", "showSpecLine"]:
		out[k] = (_f[k] as CheckBox).button_pressed
	return out


func _changed() -> void:
	if not _filling:
		_post.start(POST_DELAY_S)


func _send() -> void:
	var res: Dictionary = await Api.post_json("/api/led-test-card/settings", collect())
	if not res.ok:
		notice.emit({"text": "Test card settings not saved: " + str(res.error), "tone": "error"})
		return
	settings = res.data.get("settings", settings)
	var applied: Variant = res.data.get("applied")
	if applied is Dictionary:
		var n := M.switch_notice({"ok": applied.get("ok", false), "data": applied}, true)
		if not n.is_empty():
			notice.emit(n)


func _switch_channel(on: bool, ch: int) -> void:
	if _filling:
		return
	var res: Dictionary = await Api.post_json("/api/led-test-card/channel", {"channel": ch, "enabled": on})
	var n := M.switch_notice(res, on)
	if not n.is_empty():
		notice.emit(n)
	if not res.ok and _show.has(str(ch)):
		(_show[str(ch)] as CheckBox).set_pressed_no_signal(not on)


func _section(text: String) -> VBoxContainer:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	_body.add_child(l)
	var box := VBoxContainer.new()
	_body.add_child(box)
	return box


func _row(text: String, c: Control) -> HBoxContainer:
	var h := HBoxContainer.new()
	var l := Label.new()
	l.text = text
	l.custom_minimum_size = Vector2(240, 0)
	h.add_child(l)
	h.add_child(c)
	return h


func _check(key: String, text: String) -> CheckBox:
	var b := CheckBox.new()
	b.text = text
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.button_pressed = settings.get(key, true) != false
	b.toggled.connect(func(_on: bool) -> void: _changed())
	_f[key] = b
	return b


func _spin(key: String, lo: int, hi: int) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 1
	s.value = int(settings.get(key, lo))
	s.custom_minimum_size = Vector2(110, 0)
	s.value_changed.connect(func(_v: float) -> void: _changed())
	_f[key] = s
	return s


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.modulate = ThemeBuilder.TEXT_MUTED
	return l
