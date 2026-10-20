extends TextureRect
## WO-608 R4 — connection eyes (client/components/connection-eye.js): green = this host's Caspar AMCP connected,
## red = server or AMCP down, blue = offline (preshow) mode. Blink every 30 s (left closed → right closed → open,
## 250 ms phases); for 5 s after AMCP connects, random open / left / right frames every 280–780 ms. The hover
## panel (CPU / GPU / disk) is a later WO-608 step — the tooltip carries the connection state; a click opens the logs.

const DIR := "res://assets/ui/"
const FRAMES := {
	"green": ["both_open_green", "left_closed_green", "right_closed_green"],
	"red": ["red_eyes_open", "red_left_closed", "red_right_closed"],
	"blue": ["eyes_blue_open", "eyes_blue_l_closed", "eyes_blue_r_closed"],
}
const BLINK_EVERY_S := 30.0
const BLINK_PHASE_S := 0.25
const CELEBRATION_S := 5.0

signal clicked
signal context_requested  # right-click → app/connection_menu.gd (A/B hosts)

var connected := false
var offline := false
var _tex := {}  # "green/0" → Texture2D
var _frame := 0  # 0 open, 1 left closed, 2 right closed
var _celebrate_until := 0.0


func _ready() -> void:
	expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	custom_minimum_size = Vector2(64, 32)
	mouse_filter = Control.MOUSE_FILTER_STOP
	mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	for k in FRAMES:
		for i in 3:
			_tex["%s/%d" % [k, i]] = load_png(DIR + FRAMES[k][i] + ".png")
	var t := Timer.new()
	t.wait_time = BLINK_EVERY_S
	t.autostart = true
	t.timeout.connect(_blink)
	add_child(t)
	_show()


## Runtime load from the raw file, like the font (no editor import step).
static func load_png(path: String) -> Texture2D:
	var img := Image.new()
	if img.load_png_from_buffer(FileAccess.get_file_as_bytes(path)) != OK:
		return null
	return ImageTexture.create_from_image(img)


func _gui_input(e: InputEvent) -> void:
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		clicked.emit()
		accept_event()
	elif e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_RIGHT:
		context_requested.emit()
		accept_event()


func set_state(is_connected: bool, is_offline: bool, tip: String) -> void:
	tooltip_text = tip
	offline = is_offline
	if is_connected and not connected:
		_celebrate_until = _now() + CELEBRATION_S
		_celebrate()
	connected = is_connected
	_show()


func _colour() -> String:
	return "blue" if offline else ("green" if connected else "red")


func _show() -> void:
	texture = _tex.get("%s/%d" % [_colour(), _frame])


static func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


func _blink() -> void:
	if _now() < _celebrate_until or _frame != 0:
		return
	for f in [1, 2, 0]:
		_frame = f
		_show()
		if f != 0:
			await get_tree().create_timer(BLINK_PHASE_S).timeout


func _celebrate() -> void:
	while connected and _now() < _celebrate_until:
		_frame = randi() % 3
		_show()
		await get_tree().create_timer(randf_range(0.28, 0.78)).timeout
	_frame = 0
	_show()
