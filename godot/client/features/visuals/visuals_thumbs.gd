extends Node
## WO-885 — thumbnails for Sources ▸ Visuals, rendered on this client's GPU: a small private stage (its own World3D in a
## SubViewport, like a mixer deck) runs each visual through STEPS frames of a fixed synthetic beat, so audio-reactive shaders
## show what they do with music, and the frame is cached in DIR as <key>.png — a shader's key carries its updatedAt, so an
## edited shader renders again. One visual per frame at most, only for rows someone asked for (an open folder); a shader that
## does not compile gets none (the row keeps its placeholder and says why).

const Stage := preload("res://features/visuals/visuals_stage.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const DIR := "user://visual_thumbs/v1"  # bump when the scenes' look or the beat changes
const SIZE := Vector2i(192, 108)
const STEPS := 48  # frames of 1/12 s: the visual 4 s in
const BPM := 120.0

signal thumb_ready(key: String, tex: Texture2D)

var fetch: Callable  # shader id → its config (GET /api/shaders/:id; awaitable; null = unavailable)
var failed := {}  # key → why
var _vp: SubViewport
var _stage: Node3D
var _cache := {}  # key → Texture2D
var _queue := []  # [key, payload]
var _busy := false


func _ready() -> void:
	_vp = SubViewport.new()
	_vp.size = SIZE
	_vp.world_3d = World3D.new()
	_vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	_stage = Stage.new()
	_stage.start_scene = ""
	_vp.add_child(_stage)
	add_child(_vp)
	_stage.set_process(false)  # stepped by hand, STEPS at a time
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DIR))


## The thumbnail when known (memory or disk), else null.
func texture(key: String) -> Texture2D:
	if key == "":
		return null
	if not _cache.has(key):
		var path := ProjectSettings.globalize_path(DIR.path_join(key + ".png"))
		if FileAccess.file_exists(path):
			var img := Image.load_from_file(path)
			if img != null and not img.is_empty():
				_cache[key] = ImageTexture.create_from_image(img)
	return _cache.get(key)


## Render `key` (a catalog row's thumb) unless it is known, queued or failed; thumb_ready fires when it lands.
func request(key: String, payload: Dictionary) -> void:
	if key == "" or texture(key) != null or failed.has(key) or _queue.any(func(j: Array) -> bool: return j[0] == key):
		return
	_queue.append([key, payload])
	_pump()


## Forget the queue (the list was closed or rebuilt); a render in flight finishes.
func clear_queue() -> void:
	_queue.clear()


func pending() -> int:
	return _queue.size() + (1 if _busy else 0)


func _pump() -> void:
	if _busy:
		return
	_busy = true
	while not _queue.is_empty() and is_inside_tree():
		var job: Array = _queue.pop_front()
		var tex: Texture2D = await _render(job[0], job[1])
		if tex != null:
			_cache[job[0]] = tex
			thumb_ready.emit(job[0], tex)
		else:
			thumb_ready.emit(job[0], null)
		if is_inside_tree():
			await get_tree().process_frame
	_busy = false
	_stage.clear()  # no shader kept compiled between batches


func _render(key: String, p: Dictionary) -> Texture2D:
	if RenderingServer.get_rendering_device() == null:
		failed[key] = "no GPU"
		return null
	var scene := str(p.get("scene", ""))
	_stage.set_layers(scene, "")
	if scene == "shader":
		var cfg: Variant = await fetch.call(str(p.get("shader", ""))) if fetch.is_valid() else null
		if not is_inside_tree():
			return null
		if not cfg is Dictionary:
			failed[key] = "the box did not send this shader"
			return null
		var e: String = _stage.set_shader(cfg)
		if e != "":
			failed[key] = e
			return null
	_stage.params = M.PARAM_DEFAULTS.duplicate()
	for i in STEPS:
		var t := i / 12.0
		var beat := beat_frame(t)
		_stage.params.burst = 1.0 if fposmod(t, 60.0 / BPM) < 0.09 else 0.0
		_stage.audio_frame(beat)
		_stage._process(1.0 / 12.0)
	_vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	await RenderingServer.frame_post_draw
	if not is_inside_tree():
		return null
	var img := _vp.get_texture().get_image()
	if img == null or img.is_empty():
		failed[key] = "no frame"
		return null
	img.convert(Image.FORMAT_RGB8)
	img.save_png(ProjectSettings.globalize_path(DIR.path_join(key + ".png")))
	return ImageTexture.create_from_image(img)


## A fixed `audio_fft`-shaped frame at `t` s: a 120 BPM kick in the lows, a moving mid band, a falling spectrum and a wave.
static func beat_frame(t: float) -> Dictionary:
	var kick := exp(-fposmod(t, 60.0 / BPM) * 9.0)
	var freq := PackedByteArray()
	var wave := PackedByteArray()
	freq.resize(512)
	wave.resize(512)
	for i in 512:
		var base := 200.0 * exp(-i / 140.0) + 30.0 * (0.5 + 0.5 * sin(i * 0.37 + t * 3.1))
		var low := 70.0 * kick * exp(-i / 20.0)
		var mid := 60.0 * exp(-pow((i - 120.0 - 60.0 * sin(t * 0.9)) / 25.0, 2.0))
		freq[i] = clampi(int(base + low + mid), 0, 255)
		wave[i] = clampi(int(128.0 + (60.0 + 50.0 * kick) * sin(i * 0.11 + t * 19.0) * sin(i * 0.013 + 0.4)), 0, 255)
	return {"freq": Marshalls.raw_to_base64(freq), "wave": Marshalls.raw_to_base64(wave)}
