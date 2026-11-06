extends VBoxContainer
## WO-978 — the test puppet in the Markers section (markers_section.gd): on / off, path, speed, size, and its state.
## Owner, 06.11: "i need a puppet marker, and psn to chamsys". The server walks it (src/tracking/puppet.js) and writes
## it to the hub as marker 1, so it goes out to the desk like a real person (PSN, Follow). It is off at every server
## start and switches itself off after two hours; the 3D previs draws it magenta (marker_pins_3d.gd).

const PM := preload("res://features/previs/tracking/puppet_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HelpDialog := preload("res://app/help_dialog.gd")
const PATH := "/api/tracking/puppet"

var _on: CheckButton
var _pattern: OptionButton
var _speed: SpinBox
var _size: SpinBox
var _state: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	add_child(HSeparator.new())
	_on = CheckButton.new()
	_on.text = "Test puppet"
	_on.tooltip_text = "A simulated person walking the stage as marker 1 — tests what the lighting desk receives (PSN).\nOff at every server start; switches itself off after two hours."
	_on.toggled.connect(func(_v: bool) -> void: _send())
	add_child(HelpDialog.beside(_on, "tracking-desk-test"))
	var g := GridContainer.new()
	g.columns = 2
	_pattern = OptionButton.new()
	for l in PM.LABELS:
		_pattern.add_item(l)
	_pattern.item_selected.connect(func(_i: int) -> void: _send())
	_pair(g, "Path", _pattern)
	_speed = _spin(0.05, 5.0, 0.05, "m/s")
	_pair(g, "Speed", _speed)
	_size = _spin(0.1, 20.0, 0.1, "m")
	_size.tooltip_text = "Circle radius, half the line / square / figure-8 width"
	_pair(g, "Size", _size)
	add_child(g)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	var t := Timer.new()  # position + time left stay current while the page is open
	t.wait_time = 1.0
	t.timeout.connect(func() -> void:
		if is_visible_in_tree():
			_poll())
	add_child(t)
	t.start()
	_poll()


func _poll() -> void:
	var res: Dictionary = await Api.get_json(PATH)
	_adopt(res.data if res.ok else null)


func _send() -> void:
	var body := PM.body(_on.button_pressed, PM.PATTERNS[maxi(0, _pattern.selected)], _speed.value, _size.value)
	var res: Dictionary = await Api.post_json(PATH, body)
	_adopt(res.data if res.data is Dictionary else null)


## Server state → controls (no signals) + the status line.
func _adopt(d: Variant) -> void:
	_state.text = PM.summary(d)
	if not (d is Dictionary):
		return
	_on.set_pressed_no_signal(d.get("enabled") == true)
	_pattern.select(maxi(0, PM.PATTERNS.find(str(d.get("pattern", "circle")))))
	if not _speed.get_line_edit().has_focus():
		_speed.set_value_no_signal(float(d.get("speed", 1.0)))
	if not _size.get_line_edit().has_focus():
		_size.set_value_no_signal(float(d.get("size", 2.0)))


func _spin(lo: float, hi: float, step: float, suffix: String) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.suffix = suffix
	s.value_changed.connect(func(_v: float) -> void: _send())
	return s


func _pair(g: GridContainer, text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)
