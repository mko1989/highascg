extends HBoxContainer
## WO-616 T12 — the "3D stage overlay" toggle + opacity row of the tracking Inspector page (tracking_page.gd; split
## out by WO-711 for the 500-line limit). `changed` fires on the operator's edit only; set_state() is silent.

signal changed(on: bool, opacity: float)

var on := false
var opacity := 0.6
var _cb: CheckBox
var _sl: HSlider


func _ready() -> void:
	_cb = CheckBox.new()
	_cb.text = "3D stage overlay"
	_cb.tooltip_text = "The previs stage through this camera's solved pose and lens — LED-wall edges must sit on the real walls."
	_cb.toggled.connect(func(v: bool) -> void:
		on = v
		changed.emit(on, opacity))
	add_child(_cb)
	_sl = HSlider.new()
	_sl.min_value = 0.05
	_sl.max_value = 1.0
	_sl.step = 0.05
	_sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_sl.tooltip_text = "Overlay opacity"
	_sl.value_changed.connect(func(v: float) -> void:
		opacity = v
		changed.emit(on, opacity))
	add_child(_sl)
	set_state(on, opacity)


## Initial overlay state (previs_tab's ui.cfg) — no signal.
func set_state(p_on: bool, p_opacity: float) -> void:
	on = p_on
	opacity = p_opacity
	if _cb != null:
		_cb.set_pressed_no_signal(on)
		_sl.set_value_no_signal(opacity)
