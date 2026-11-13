extends Button
## WO-1059 — LTC out in the timeline transport: the outgoing timecode while it runs (green), dim while silent or off,
## red when the device is gone (the reason is the tooltip).
## WO-1060 — LTC is per timeline: a click chooses / unchooses the shown timeline (`ltcOut` on the timeline, project
## data); only chosen timelines send timecode while they play. Choosing one also turns LTC out on if it was off.
## State: WS `ltc.status` (5 Hz while the service runs) + GET /api/ltc at start and after a toggle.

const LM := preload("res://features/settings/ltc_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var transport: Node  # timeline_transport.gd: `tab.active()` is the shown timeline, `edited` saves it

var _enabled := false
var _shown := ""
var _last: Variant = null
var _tl_on := false


func _ready() -> void:
	flat = true
	focus_mode = Control.FOCUS_NONE  # Space stays the play key
	custom_minimum_size.x = 150
	add_theme_font_size_override("font_size", 15)
	pressed.connect(_toggle)
	show_status(null)
	Ws.on("ltc.status", show_status)
	_fetch()


## The shown timeline changed or was edited (transport.sync).
func set_timeline_on(on: bool) -> void:
	if on == _tl_on:
		return
	_tl_on = on
	show_status(_last)


func show_status(d: Variant) -> void:
	_last = d
	var r: Dictionary = LM.readout(d, _tl_on)
	if d is Dictionary and d.get("config") is Dictionary and d.config.get("output") is Dictionary:
		_enabled = d.config.output.get("enabled") == true
	tooltip_text = str(r.tip)
	var key := "%s|%s" % [r.text, r.state]
	if key == _shown:
		return
	_shown = key
	text = str(r.text)
	var c: Color = {"run": ThemeBuilder.SUCCESS, "error": ThemeBuilder.ERROR}.get(r.state, ThemeBuilder.TEXT_MUTED)
	for n in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		add_theme_color_override(n, c)


func _fetch() -> void:
	var r: Dictionary = await Api.get_json("/api/ltc")
	if r.ok:
		show_status(r.data)


func _toggle() -> void:
	var tl: Dictionary = transport.tab.active() if transport != null else {}
	if tl.is_empty():
		return
	var on: bool = tl.get("ltcOut") != true
	if on:
		tl["ltcOut"] = true
	else:
		tl.erase("ltcOut")
	set_timeline_on(on)
	transport.edited.emit()
	if on and not _enabled:
		var r: Dictionary = await Api.post_json("/api/ltc/config", {"output": {"enabled": true}})
		if r.ok and r.data is Dictionary:
			show_status(r.data)
		else:
			_fetch()
