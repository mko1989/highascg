extends HBoxContainer
## WO-608 header slice 2 — round status badges right of FTB: one per configured stream / record output (grey idle,
## red on air — web header-bar-streaming.js) and the hot-backup L / F letter (header-bar-replication.js). A click opens
## the Devices tab, where those outputs and the server's replication live.
## Sources: settings streamOutputs / recordOutputs; GET /api/streaming-channel + WS `streaming_channel`;
## GET /api/replication/status every 2.5 s (web POLL_MS) + WS `replication_status`.

const M := preload("res://app/header_badges_model.gd")

const REPL_POLL_S := 2.5

signal devices_requested

var _stream_status: Variant = null
var _repl: Dictionary = {}
var _poll: Timer
var _polling := false


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	Settings.changed.connect(render)
	Ws.on("streaming_channel", func(d: Variant) -> void:
		_stream_status = d
		render())
	Ws.on("replication_status", func(_d: Variant) -> void: _poll_replication())
	Ws.connected.connect(_refresh_stream)
	_poll = Timer.new()
	_poll.wait_time = REPL_POLL_S
	_poll.timeout.connect(_poll_replication)
	add_child(_poll)
	_poll.start()
	_refresh_stream()
	_poll_replication()


func _refresh_stream() -> void:
	var r: Dictionary = await Api.get_json("/api/streaming-channel")
	if r.ok:
		_stream_status = r.data
		render()


func _poll_replication() -> void:
	if _polling:
		return
	_polling = true
	var r: Dictionary = await Api.get_json("/api/replication/status")
	_polling = false
	var next := M.replication_badge(r.data) if r.ok else {}
	if next != _repl:
		_repl = next
		render()


func render() -> void:
	for c in get_children():
		if c is Button:
			c.queue_free()
	for b in M.stream_badges(Settings.get_setting("streamOutputs"), Settings.get_setting("recordOutputs"), _stream_status):
		_add(badge(b))
	if not _repl.is_empty():
		_add(badge(_repl))


func _add(btn: Button) -> void:
	btn.pressed.connect(func() -> void: devices_requested.emit())
	add_child(btn)


static func badge(b: Dictionary) -> Button:
	var btn := Button.new()
	btn.text = str(b.label)
	btn.tooltip_text = str(b.tip)
	btn.focus_mode = Control.FOCUS_NONE
	btn.custom_minimum_size = Vector2(24, 24)
	btn.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	btn.add_theme_font_size_override("font_size", 10)
	var t: Array = M.TONES.get(str(b.tone), M.TONES.idle)
	for state in ["normal", "hover", "pressed"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = t[0].lightened(0.12) if state == "hover" else t[0]
		sb.border_color = t[1]
		sb.set_border_width_all(1)
		sb.set_corner_radius_all(12)
		btn.add_theme_stylebox_override(state, sb)
	for k in ["font_color", "font_hover_color", "font_pressed_color"]:
		btn.add_theme_color_override(k, t[2])
	btn.set_meta("label", str(b.label))
	return btn
