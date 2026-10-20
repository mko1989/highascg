extends HBoxContainer
## WO-605 — the Devices tab's header row (web device-view-toolbar.js): title, the cable-loops slider, the view
## toggle, the status line, Cancel cable / Reset all cabling / Apply Caspar config, the snapshot arrow and reload.
## Slice 10: "Matrix view" swaps the panels for the routing matrix (matrix_view.gd); the pick is a per-client pref
## (web localStorage `device-view-matrix`, here user://devices.cfg [view] mode). The loops slider hides with it.

signal loops_changed(n: int)
signal view_changed(mode: String)  # "" (panels) | "matrix"
signal cancel_pressed
signal reset_pressed
signal apply_pressed
signal save_pressed
signal reload_pressed

const ThemeBuilder := preload("res://app/theme_builder.gd")
const SnapshotDialogs := preload("res://features/devices/snapshot_dialogs.gd")
const PREFS := "user://devices.cfg"
const APPLY := "Apply Caspar config (restart)"

var cancel_btn: Button
var apply_btn: Button
var _status: Label
var _loops: Control
var _matrix: CheckBox


func _init() -> void:
	add_theme_constant_override("separation", 10)
	add_child(_label("Devices", ThemeBuilder.TEXT, 17))
	var gap := Control.new()
	gap.custom_minimum_size.x = 24
	add_child(gap)
	_loops = HBoxContainer.new()
	_loops.add_theme_constant_override("separation", 10)
	add_child(_loops)
	_loops.add_child(_label("Cable loops", ThemeBuilder.TEXT_MUTED, 13))
	var s := HSlider.new()
	s.min_value = 0
	s.max_value = 2
	s.step = 1
	s.custom_minimum_size = Vector2(70, 0)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.focus_mode = Control.FOCUS_NONE
	_loops.add_child(s)
	var value := _label("0", ThemeBuilder.TEXT, 13)
	_loops.add_child(value)
	s.value_changed.connect(func(x: float) -> void:
		value.text = str(int(x))
		loops_changed.emit(int(x)))
	_matrix = CheckBox.new()
	_matrix.text = "Matrix view"
	_matrix.tooltip_text = "Dense Dante-style routing matrix."
	_matrix.focus_mode = Control.FOCUS_NONE
	_matrix.add_theme_font_size_override("font_size", 13)
	_matrix.button_pressed = saved_view() == "matrix"
	_matrix.toggled.connect(func(_on: bool) -> void:
		save_view(mode())
		_sync_mode()
		view_changed.emit(mode()))
	add_child(_matrix)
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(fill)
	_status = _label("", ThemeBuilder.TEXT_MUTED, 12)
	add_child(_status)
	cancel_btn = _button("Cancel cable", cancel_pressed.emit)
	cancel_btn.visible = false
	add_child(cancel_btn)
	add_child(_button("Reset all cabling", reset_pressed.emit))
	apply_btn = _button(APPLY, apply_pressed.emit)
	add_child(apply_btn)
	add_child(SnapshotDialogs.save_button(save_pressed.emit))
	var r := Button.new()
	r.text = "↻"
	r.tooltip_text = "Reload devices"
	r.focus_mode = Control.FOCUS_NONE
	r.pressed.connect(reload_pressed.emit)
	add_child(r)
	_sync_mode()


func mode() -> String:
	return "matrix" if _matrix.button_pressed else ""


func _sync_mode() -> void:
	_loops.visible = mode() == ""


func set_status(text: String, ok: bool) -> void:
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)


## Gesture state → Cancel cable and the Apply button (busy / applying / restart-dirty).
func sync(g: Node) -> void:
	cancel_btn.visible = g.armed()
	apply_btn.disabled = g.busy
	apply_btn.text = "Applying…" if g.applying else APPLY
	apply_btn.add_theme_color_override("font_color", ThemeBuilder.WARN if g.restart_dirty else ThemeBuilder.TEXT)
	apply_btn.tooltip_text = "Cabling changed — restart Caspar to apply" if g.restart_dirty else ""


static func saved_view() -> String:
	var cfg := ConfigFile.new()
	return str(cfg.get_value("view", "mode", "")) if cfg.load(PREFS) == OK else ""


static func save_view(m: String) -> void:
	var cfg := ConfigFile.new()
	cfg.load(PREFS)
	cfg.set_value("view", "mode", m)
	cfg.save(PREFS)


func _button(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 12)
	b.pressed.connect(on_press)
	return b


func _label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
