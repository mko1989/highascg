extends PanelContainer
## WO-959 — one button for a switch that has options (owner 05.11: "test card enable, and options should be a one
## button. clicking the button brings up options, clicking tick enables it. the same for border"). The tick on the
## left switches it (`toggled`), the label opens the options (`opened`). The frame turns accent while it is on.
## Callers that follow server state use `set_on` (no signal).

const ThemeBuilder := preload("res://app/theme_builder.gd")

signal toggled(on: bool)
signal opened

var tick: CheckBox
var label: Button


func _init(text: String, tick_tip: String, open_tip: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 0)
	add_child(row)
	tick = CheckBox.new()
	tick.focus_mode = Control.FOCUS_NONE
	tick.tooltip_text = tick_tip
	tick.toggled.connect(func(on: bool) -> void:
		_style()
		toggled.emit(on))
	row.add_child(tick)
	label = Button.new()
	label.flat = true
	label.text = text + " ▾"
	label.focus_mode = Control.FOCUS_NONE
	label.tooltip_text = open_tip
	label.pressed.connect(func() -> void: opened.emit())
	row.add_child(label)
	_style()


func is_on() -> bool:
	return tick.button_pressed


func set_on(on: bool) -> void:
	tick.set_pressed_no_signal(on)
	_style()


func set_busy(busy: bool) -> void:
	tick.disabled = busy


func _style() -> void:
	var sb := ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.ACCENT if tick.button_pressed else ThemeBuilder.BORDER, 1)
	sb.set_content_margin_all(0)
	sb.content_margin_left = 4
	add_theme_stylebox_override("panel", sb)
	label.add_theme_color_override("font_color", ThemeBuilder.ACCENT if tick.button_pressed else ThemeBuilder.TEXT)
