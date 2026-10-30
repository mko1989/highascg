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
}
const BURST_ON := 0.5
const BURST_REARM := 0.3

var params := {}
var camera: Camera3D
var layers: Array[Node3D] = []
var _ids := []
var _env: Environment
var _armed := true
var _manual := false
var _flash := 0.0


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
	if _ids.is_empty():
		set_layers("rings", "")
	_process(0.0)


## Main scene and second layer by id ("" = none); unknown ids fall back to rings / none. Rebuilds only what changed.
func set_layers(main: String, overlay: String) -> void:
	var want := [main if SCENES.has(main) else "rings"]
	if SCENES.has(overlay) and overlay != want[0]:
		want.append(overlay)
	if want == _ids:
		return
	for l in layers:
		l.queue_free()
	layers.clear()
	for id in want:
		var s: Node3D = SCENES[id].new()
		s.name = id
		add_child(s)
		layers.append(s)
	_ids = want


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
	for l in layers:
		l.step(p, delta, burst)
	var hue := float(p.get("hue", 0.55))
	var glow := float(p.get("glow", 0.3))
	var flash := maxf(float(p.get("flash", 0.0)), _flash * 0.4)
	_env.glow_intensity = 0.4 + glow * 1.6
	_env.background_color = Color.from_hsv(fposmod(hue + 0.5, 1.0), 0.6, 0.02 + flash * 0.25)
