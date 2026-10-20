extends HBoxContainer
## WO-608 header — the web header right group (header-bar.js statusEl): wall clock between the PGM timer and the eyes
## (owner todos27, placement 4).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const HeaderModel := preload("res://app/header_model.gd")

var clock: Label
var _tick: Timer


func _ready() -> void:
	add_theme_constant_override("separation", 10)
	clock = Label.new()
	clock.add_theme_font_size_override("font_size", 15)
	clock.tooltip_text = "Wall clock (this computer)"
	add_child(clock)
	_tick = Timer.new()
	_tick.wait_time = 1.0
	_tick.timeout.connect(_update_clock)
	add_child(_tick)
	_tick.start()
	_update_clock()


func _update_clock() -> void:
	clock.text = HeaderModel.clock_text(Time.get_time_dict_from_system())
