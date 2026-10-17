extends Node
## WO-595 M0 spike — Godot drawing a Caspar channel from shared memory, UI over video, 3D previs.
## Keys: 1 canvas · 2 atlas · 3 previs · F fullscreen · H HUD · Esc quit.
## User args (after `--`): --shm=<path> | --name=<surface>  --mode=canvas|atlas|previs
##   --model=<file.glb>  --fullscreen  --screen=<n>  --quit-after=<s>  --screenshot=<png>
##   --log-every=<s>  --read-only (no upload; for --headless read benchmarks)
##   --reader=native|gdscript (default native when the hshm GDExtension is installed)

const ShmReader := preload("res://shm_reader.gd")
const ShmNative := preload("res://shm_native.gd")
const ShmTexture := preload("res://shm_texture.gd")
const ModeCanvas := preload("res://mode_canvas.gd")
const ModeAtlas := preload("res://mode_atlas.gd")
const ModePrevis := preload("res://mode_previs.gd")
const Stats := preload("res://stats.gd")

var args := {}
var reader  # shm_reader.gd (GDScript) or shm_native.gd (hshm GDExtension) — same interface
var native := false
var shm_tex: ShmTexture
var stats: Stats
var mode_name := ""
var mode_node: Node
var hud_layer: CanvasLayer
var hud: Label
var _last_log_ms := 0
var _quit_at_ms := -1


func _ready() -> void:
	args = _parse_args()
	var surface_path: String = args.get("shm", _default_path(str(args.get("name", "opgui"))))
	var want: String = str(args.get("reader", "native"))
	native = want == "native" and ShmNative.available()
	reader = ShmNative.new(surface_path) if native else ShmReader.new(surface_path)
	shm_tex = ShmTexture.new()
	stats = Stats.new()
	if args.has("fullscreen"):
		if args.has("screen"):
			get_window().current_screen = int(args["screen"])
		get_window().mode = Window.MODE_EXCLUSIVE_FULLSCREEN
	_build_hud()
	_set_mode(str(args.get("mode", "canvas")))
	if args.has("quit-after"):
		_quit_at_ms = Time.get_ticks_msec() + int(float(args["quit-after"]) * 1000.0)
	print("[m0] reader=%s surface=%s renderer=%s adapter=%s texture=%s bgra_supported=%s" % [
		"native" if native else "gdscript", surface_path, RenderingServer.get_current_rendering_method() + "/" + RenderingServer.get_current_rendering_driver_name(),
		RenderingServer.get_video_adapter_name(), shm_tex.kind, str(shm_tex.format_supported())])


func _process(delta: float) -> void:
	var t0 := Time.get_ticks_usec()
	var got: bool = reader.poll()
	if got and not args.has("read-only"):
		if native:
			shm_tex.update_native(reader.src)
		else:
			shm_tex.update(reader.frame, reader.width, reader.height)
	stats.sample(delta, got, reader, shm_tex, (Time.get_ticks_usec() - t0) / 1000.0)
	if mode_node != null and mode_node.has_method("tick"):
		mode_node.call("tick", delta, reader)
	if hud != null and hud_layer.visible:
		hud.text = stats.hud_text(mode_name, reader, shm_tex)
	var now := Time.get_ticks_msec()
	var every := int(float(args.get("log-every", "2")) * 1000.0)
	if now - _last_log_ms >= every:
		_last_log_ms = now
		print(stats.log_line(mode_name, reader, shm_tex))
	if _quit_at_ms >= 0 and now >= _quit_at_ms:
		_quit_at_ms = -1
		_finish()


func _unhandled_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo:
		return
	match k.keycode:
		KEY_1: _set_mode("canvas")
		KEY_2: _set_mode("atlas")
		KEY_3: _set_mode("previs")
		KEY_H: hud_layer.visible = not hud_layer.visible
		KEY_F:
			var w := get_window()
			w.mode = Window.MODE_WINDOWED if w.mode != Window.MODE_WINDOWED else Window.MODE_EXCLUSIVE_FULLSCREEN
		KEY_ESCAPE: _finish()


func _set_mode(mode: String) -> void:
	if mode_node != null:
		mode_node.queue_free()
		mode_node = null
	mode_name = mode
	match mode:
		"atlas":
			var a := ModeAtlas.new()
			add_child(a)
			a.setup(shm_tex.texture)
			mode_node = a
		"previs":
			var p := ModePrevis.new()
			add_child(p)
			p.setup(shm_tex.texture, str(args.get("model", "")))
			mode_node = p
		_:
			mode_name = "canvas"
			var c := ModeCanvas.new()
			add_child(c)
			c.setup(shm_tex.texture)
			mode_node = c
	move_child(mode_node, 0)


func _build_hud() -> void:
	hud_layer = CanvasLayer.new()
	hud_layer.layer = 100
	add_child(hud_layer)
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.6)
	sb.set_content_margin_all(8)
	panel.add_theme_stylebox_override("panel", sb)
	panel.position = Vector2(12, 12)
	hud_layer.add_child(panel)
	hud = Label.new()
	hud.add_theme_font_size_override("font_size", 14)
	panel.add_child(hud)


func _finish() -> void:
	if args.has("screenshot"):
		await RenderingServer.frame_post_draw
		var img := get_viewport().get_texture().get_image()
		var out := str(args["screenshot"])
		img.save_png(out)
		print("[m0] screenshot -> ", out)
	print("[m0] SUMMARY ", JSON.stringify(stats.summary(mode_name, reader, shm_tex)))
	get_tree().quit()  # GPU texture is released with the process (freeing it here races the last draw)


static func _default_path(surface: String) -> String:
	if OS.get_name() == "Linux" and DirAccess.dir_exists_absolute("/dev/shm"):
		return "/dev/shm/highascg-%s" % surface
	var tmp := OS.get_environment("TMPDIR")
	if tmp == "":
		tmp = "/tmp"
	return tmp.path_join("highascg-shm").path_join("highascg-%s" % surface)


static func _parse_args() -> Dictionary:
	var out := {}
	for a in OS.get_cmdline_user_args():
		var s: String = a
		if not s.begins_with("--"):
			continue
		var kv := s.substr(2).split("=", true, 1)
		out[kv[0]] = kv[1] if kv.size() > 1 else "1"
	return out
