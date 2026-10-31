extends Node3D
## WO-873 — the Visuals stage: owns the camera and the WorldEnvironment (bloom = glow, a hue-tinted background, flash), hosts the
## main scene and an optional second layer in one world (e.g. Tunnel + Particles), and turns the `burst` parameter into
## one-shots: a rising edge through 0.5, re-armed below 0.3 (so "kick → Shape → burst" in Flow is "on kick, burst").
## Scenes (scenes/<id>.gd) are content only: `step(params, delta, burst)`. The 3D view's orbit camera shares this world.

const SCENES := {
	"rings": preload("res://features/visuals/scenes/rings.gd"),
	"particles": preload("res://features/visuals/scenes/particles.gd"),
	"starfield": preload("res://features/visuals/scenes/starfield.gd"),
	"tunnel": preload("res://features/visuals/scenes/tunnel.gd"),
	"shader": preload("res://features/visuals/scenes/shader.gd"),  # WO-874
	"spectrum": preload("res://features/visuals/scenes/spectrum.gd"),  # WO-875
	"game": preload("res://features/visuals/scenes/game.gd"),  # WO-876
}
const Smooth := preload("res://features/visuals/spectrum_smooth.gd")
const BURST_ON := 0.5
const BURST_REARM := 0.3
const AUDIO_STALE_MS := 1000

var params := {}
var camera: Camera3D
var layers: Array[Node3D] = []
var _ids := []
var _env: Environment
var _armed := true
var _manual := false
var _flash := 0.0
var _shader_cfg: Variant = null
var shader_error := ""
var _audio := PackedByteArray()
var _audio_at := -AUDIO_STALE_MS
var _smoother := Smooth.new()
var _smooth_cfg: Variant = null  # WO-875: the node's audioCapture.spectrum, from each frame
var _shown := PackedByteArray()
var start_scene := "rings"  # WO-877: "" for the mixer's idle deck


func _ready() -> void:
	camera = Camera3D.new()
	camera.position = Vector3(0, 0, 14)
	camera.fov = 60
	camera.far = 400.0
	add_child(camera)
	var we := WorldEnvironment.new()
	_env = Environment.new()
	_env.background_mode = Environment.BG_COLOR
	_env.glow_enabled = true
	_env.glow_hdr_threshold = 0.9  # only the content blooms, never the background
	_env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	we.environment = _env
	add_child(we)
	if _ids.is_empty() and start_scene != "":
		set_layers(start_scene, "")
	_process(0.0)


## The ids set_layers puts on stage: unknown main → rings, a second layer only when known and not the main again.
static func want(main: String, overlay: String) -> Array:
	var w := [main if SCENES.has(main) else "rings"]
	if SCENES.has(overlay) and overlay != w[0]:
		w.append(overlay)
	return w


## Main scene and second layer by id ("" = none); unknown ids fall back to rings / none. Rebuilds only what changed.
func set_layers(main: String, overlay: String) -> void:
	var w := want(main, overlay)
	if w == _ids:
		return
	clear()
	for id in w:
		var s: Node3D = SCENES[id].new()
		s.name = id
		if s.has_method("set_overlay"):
			s.set_overlay(not layers.is_empty())
		add_child(s)
		layers.append(s)
	_ids = w
	_apply_shader()


## WO-877: no scenes (the mixer's idle deck) — nothing renders, nothing reads a ring.
func clear() -> void:
	for l in layers:
		l.queue_free()
	layers.clear()
	_ids = []


## WO-874: the library shader the Shader scene runs (GET /api/shaders/:id; null = none). Its compile error, or "".
func set_shader(cfg: Variant) -> String:
	if typeof(cfg) == typeof(_shader_cfg) and cfg == _shader_cfg:
		return shader_error  # WO-877: the same shader again (a reload, a look with the same one) is no recompile, no time jump
	_shader_cfg = cfg
	return _apply_shader()


func _apply_shader() -> String:
	shader_error = ""
	for l in layers:
		if l.has_method("set_shader"):
			shader_error = l.set_shader(_shader_cfg) if _shader_cfg != null else "no shader picked"
	return shader_error


## WO-874: an `audio_fft` WS frame → the audio texture the shader and spectrum scenes read (row 0 the 512 FFT bytes, row 1
## the wave; player.js's layout). WO-875: row 0 is smoothed per rendered frame in _process, like player.js does.
func audio_frame(d: Variant) -> void:
	if not d is Dictionary or not d.get("freq") is String:
		return
	var freq := Marshalls.base64_to_raw(d.freq)
	var wave := Marshalls.base64_to_raw(d.wave) if d.get("wave") is String else PackedByteArray()
	_audio.resize(1024)
	for i in 512:
		_audio[i] = freq[i] if i < freq.size() else 0
		_audio[512 + i] = wave[i] if i < wave.size() else 128
	_smooth_cfg = d.get("smooth")
	_audio_at = Time.get_ticks_msec()


## WO-875: this frame's audio for the scenes — the smoothed spectrum (a stale feed falls away under gravity) + the wave.
func _audio_shown(delta: float) -> PackedByteArray:
	var live := Time.get_ticks_msec() - _audio_at < AUDIO_STALE_MS and _audio.size() == 1024
	var raw := _audio.slice(0, 512) if live else PackedByteArray()
	_shown = _smoother.step(raw, delta, _smooth_cfg).duplicate()
	_shown.resize(1024)
	for i in 512:
		_shown[512 + i] = _audio[512 + i] if live else 128
	return _shown


## The ids on stage, main first.
func ids() -> Array:
	return _ids.duplicate()


## A manual burst (the Inspector's Burst button); fires on the next frame.
func fire() -> void:
	_manual = true


## True on the frame `burst` rises through BURST_ON (or a manual fire); re-arms once it falls below BURST_REARM.
func burst_edge(v: float) -> bool:
	var fired := _manual
	_manual = false
	if _armed and v >= BURST_ON:
		_armed = false
		fired = true
	elif not _armed and v < BURST_REARM:
		_armed = true
	return fired


func _process(delta: float) -> void:
	var p := params
	var burst := burst_edge(float(p.get("burst", 0.0)))
	if burst:
		_flash = 1.0
	_flash = maxf(0.0, _flash - delta * 6.0)
	var audio := PackedByteArray()
	if layers.any(func(l: Node3D) -> bool: return l.has_method("set_audio")):
		audio = _audio_shown(delta)
	for l in layers:
		if l.has_method("set_audio"):
			l.set_audio(audio)
		l.step(p, delta, burst)
	var hue := float(p.get("hue", 0.55))
	var glow := float(p.get("glow", 0.3))
	var flash := maxf(float(p.get("flash", 0.0)), _flash * 0.4)
	_env.glow_intensity = 0.4 + glow * 1.6
	_env.background_color = Color.from_hsv(fposmod(hue + 0.5, 1.0), 0.6, 0.02 + flash * 0.25)
