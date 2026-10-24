extends Control
## WO-745 (WO-738 §9) — the operator's game window. A libretro core (RetroHost) runs at its own rate, the picture
## fills this window (nearest filter) and goes out as the shm ring `--ring` (HshmSink), which the Live tab lists
## (WO-744) and Caspar plays (WO-742). The ring is the picture enlarged by a whole factor with sharp pixels (`--scale`,
## default the smallest that reaches 720 lines: NES ×3 = 768×720), so Caspar's scaler does not smear 256×240.
## Keyboard (RetroArch layout) and the first gamepad drive port 1. Sound plays here only: the ring carries no audio.
##   godot --path godot/retro -- --core <x_libretro.so> --game <file> [--ring retro] [--scale N]

const Keys := preload("res://retro_keys.gd")
const MAX_STEPS := 3  # frames caught up per redraw after a stall; beyond that, time is dropped

var host: RefCounted  # RetroHost and HshmSink come from ClassDB: the project parses without the extensions
var sink: RefCounted
var ring := "retro"
var ring_scale := 0  # 0 = auto (auto_scale)
var _view := TextureRect.new()
var _tex: ImageTexture
var _status := Label.new()
var _audio: AudioStreamGeneratorPlayback
var _acc := 0.0
var _keys_down := {}
var _pad_down := {}


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color.BLACK)  # letterbox around the game
	_view.set_anchors_preset(Control.PRESET_FULL_RECT)
	_view.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	add_child(_view)
	_status.position = Vector2(12, 12)
	add_child(_status)
	var err := _start(_args())
	if err != "":
		_status.text = "HighAsCG Retro: " + err
		push_error("retro: " + err)
		return
	get_window().title = "HighAsCG Retro — %s — source shm://%s" % [host.get_core_name(), ring]


## The smallest whole factor that makes `h` lines at least 720 tall (1 for a picture that already is).
static func auto_scale(h: int) -> int:
	return maxi(1, ceili(720.0 / maxf(1.0, h)))


static func parse_args(argv: PackedStringArray) -> Dictionary:
	var out := {}
	var i := 0
	while i < argv.size():
		if argv[i].begins_with("--") and i + 1 < argv.size():
			out[argv[i].substr(2)] = argv[i + 1]
			i += 2
		else:
			i += 1
	return out


func _args() -> Dictionary:
	return parse_args(OS.get_cmdline_user_args())


func _start(a: Dictionary) -> String:
	for cls in ["RetroHost", "HshmSink"]:
		if not ClassDB.class_exists(cls):
			return "%s is not loaded (run godot/retro/install.sh)" % cls
	if not a.has("core") or not a.has("game"):
		return "usage: --core <x_libretro.so> --game <file> [--ring name]"
	ring = str(a.get("ring", "retro"))
	ring_scale = clampi(int(a.get("scale", "0")), 0, 8)
	host = ClassDB.instantiate("RetroHost")
	var system := ProjectSettings.globalize_path("user://system")
	var saves := ProjectSettings.globalize_path("user://saves")
	DirAccess.make_dir_recursive_absolute(system)
	DirAccess.make_dir_recursive_absolute(saves)
	if not host.load_core(a.core, system, saves) or not host.load_game(a.game):
		return host.get_error()
	sink = ClassDB.instantiate("HshmSink")
	var gen := AudioStreamGenerator.new()
	gen.mix_rate = host.get_sample_rate()
	gen.buffer_length = 0.15
	var player := AudioStreamPlayer.new()
	player.stream = gen
	add_child(player)
	player.play()
	_audio = player.get_stream_playback()
	return ""


func _process(delta: float) -> void:
	if host == null or not host.is_running():
		return
	_poll_pad()
	_acc = minf(_acc + delta, MAX_STEPS / host.get_fps())
	var stepped := false
	while _acc >= 1.0 / host.get_fps():
		_acc -= 1.0 / host.get_fps()
		host.run_frame()
		stepped = true
	if stepped:
		_show_and_publish()
	_feed_audio()


func _show_and_publish() -> void:
	var w: int = host.get_width()
	var h: int = host.get_height()
	if w <= 0 or h <= 0:
		return
	var img: Image = host.get_image()
	if _tex == null or _tex.get_width() != w or _tex.get_height() != h:
		_tex = ImageTexture.create_from_image(img)
		_view.texture = _tex
	else:
		_tex.update(img)
	var n := ring_scale if ring_scale > 0 else auto_scale(h)
	if not sink.is_open() or sink.get_width() != w * n or sink.get_height() != h * n:
		if not sink.open(ring, w * n, h * n, roundi(host.get_fps())):
			_status.text = "ring: " + sink.get_error()
			return
	if n > 1:
		img.resize(w * n, h * n, Image.INTERPOLATE_NEAREST)
	sink.publish_rgba8(img.get_data(), false)  # opaque: straight and premultiplied are the same


func _feed_audio() -> void:
	var frames: PackedVector2Array = host.take_audio()
	if _audio == null or frames.is_empty():
		return
	var room := _audio.get_frames_available()
	_audio.push_buffer(frames if frames.size() <= room else frames.slice(0, room))


func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	var id := Keys.for_key(k.keycode)
	if id < 0 or host == null:
		return
	if k.pressed:
		_keys_down[id] = true
	else:
		_keys_down.erase(id)
	host.set_button(0, id, k.pressed or _pad_down.has(id))
	get_viewport().set_input_as_handled()


func _poll_pad() -> void:
	var pads := Input.get_connected_joypads()
	var now: Dictionary = Keys.pad_state(pads[0]) if not pads.is_empty() else {}
	for id in _pad_down.keys() + now.keys():
		if _pad_down.has(id) != now.has(id):
			host.set_button(0, id, now.has(id) or _keys_down.has(id))
	_pad_down = now


func _exit_tree() -> void:
	if sink != null:
		sink.close()  # unlinks the ring: Caspar holds the last frame, the Live row says "No frames" (WO-744)
	if host != null:
		host.unload()
