extends AcceptDialog
## WO-770 — "VR…" in the Previs toolbar (owner 25.10: "there should be an explicit start vr sesion in the gui, with the
## pin in the modal"). Start brings up WiVRn and the VR client (POST /api/vr/start), the PIN shows big while pairing is
## on, the state follows the headset (GET /api/vr/status, once a second while open), "Pair a new headset" asks WiVRn
## for a fresh PIN (/api/vr/pair), "End VR session" closes the VR window and stops WiVRn (/api/vr/stop). The server
## also stops WiVRn by itself when the VR window is closed.

const M := preload("res://features/previs/xr/vr_session_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _state: Label
var _pin: Label
var _detail: Label
var _start: Button
var _pair: Button
var _end: Button
var _poll: Timer
var _busy := false


func _init() -> void:
	title = "VR session"
	ok_button_text = "Close"
	size = Vector2i(520, 340)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	add_child(v)
	_state = Label.new()
	_state.add_theme_font_size_override("font_size", 20)
	v.add_child(_state)
	_pin = Label.new()
	_pin.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_pin.add_theme_font_size_override("font_size", 64)
	_pin.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	v.add_child(_pin)
	_detail = Label.new()
	_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_detail.custom_minimum_size.x = 480
	_detail.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	v.add_child(_detail)
	var row := HBoxContainer.new()
	v.add_child(row)
	_start = _button(row, "Start VR session", "/api/vr/start")
	_pair = _button(row, "Pair a new headset", "/api/vr/pair")
	_end = _button(row, "End VR session", "/api/vr/stop")
	_poll = Timer.new()
	_poll.wait_time = 1.0
	_poll.timeout.connect(refresh)
	add_child(_poll)
	visibility_changed.connect(func() -> void:
		if visible:
			_poll.start()
		else:
			_poll.stop())


func _button(row: HBoxContainer, text: String, path: String) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(func() -> void: _post(path))
	row.add_child(b)
	return b


func open() -> void:
	popup_centered()
	_show({"installed": true, "starting": true})
	_state.text = "Reading the VR state…"
	await refresh()


func refresh() -> void:
	if _busy:
		return
	var r: Dictionary = await Api.get_json("/api/vr/status")
	if not visible or _busy:
		return
	if r.ok and r.data is Dictionary:
		_show(r.data)
	else:
		_show({"installed": true, "error": "Could not read the VR state: %s" % str(r.get("error", ""))})


func _post(path: String) -> void:
	_busy = true
	_show({"installed": true, "starting": true})
	_state.text = {"/api/vr/start": "Starting the VR session…", "/api/vr/pair": "Asking WiVRn for a PIN…"}.get(path, "Ending the VR session…")
	var r: Dictionary = await Api.post_json(path, {})
	_busy = false
	if not r.ok:
		var d: Variant = r.get("data")
		_show({"installed": true, "error": str(d.get("error", r.error)) if d is Dictionary else str(r.get("error", ""))})
		return
	await refresh()


func _show(s: Dictionary) -> void:
	var v := M.view(s)
	_state.text = v.state
	_pin.text = " ".join(Array(str(v.pin).split("")))  # 1 2 3 4 5 6: easier to read off and type in the headset
	_pin.visible = v.pin != ""
	_detail.text = v.detail
	_detail.visible = v.detail != ""
	_start.visible = v.start
	_pair.visible = v.pair
	_end.visible = v.end
	for b in [_start, _pair, _end]:
		b.disabled = _busy


## The Previs toolbar's "VR…" (the dialog rides on it).
static func toolbar_button() -> Button:
	var b := Button.new()
	b.text = "VR…"
	b.tooltip_text = "Start a VR session: WiVRn streams the stage to a Quest headset (PIN, state, a window of the headset view)."
	var d: AcceptDialog = load("res://features/previs/xr/vr_session_dialog.gd").new()
	b.add_child(d)
	b.pressed.connect(func() -> void: d.open())
	return b
