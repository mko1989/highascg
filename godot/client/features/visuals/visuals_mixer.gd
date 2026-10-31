extends Node
## WO-877 — show transitions for the Visuals: two decks (a SubViewport with its own world and Stage each), one live. A new look
## loads into the idle deck and crossfades in over `fade` seconds; the canvas (`out_vp`, what Send publishes) is the two decks
## mixed, times the master (fader and blackout, faded too). The idle deck renders nothing and holds no scenes.

const Stage := preload("res://features/visuals/visuals_stage.gd")
const MIX := """shader_type canvas_item;
uniform sampler2D a : filter_nearest;
uniform sampler2D b : filter_nearest;
uniform float x = 0.0;
uniform float master = 1.0;
void fragment() {
	COLOR = vec4(mix(texture(a, UV).rgb, texture(b, UV).rgb, x) * master, 1.0);
}
"""
const BLACKOUT_S := 0.4

signal switched(stage: Node3D)

var out_vp: SubViewport
var decks: Array[SubViewport] = []
var live := 0
var x := 0.0  # deck 1's weight in the mix; reaches `live` when a fade ends
var fade_s := 1.0
var level := 1.0  # the master fader
var blackout := false
var master := 1.0  # what is on the canvas: level, or 0 in a blackout, moving towards it
var running := true
var _mat: ShaderMaterial
var _rect: ColorRect


func _init() -> void:
	out_vp = SubViewport.new()
	out_vp.disable_3d = true
	add_child(out_vp)
	for i in 2:
		var vp := SubViewport.new()
		vp.world_3d = World3D.new()
		var s: Node3D = Stage.new()
		s.start_scene = "rings" if i == 0 else ""
		vp.add_child(s)
		add_child(vp)
		decks.append(vp)
	_mat = ShaderMaterial.new()
	_mat.shader = Shader.new()
	_mat.shader.code = MIX
	_mat.set_shader_parameter("a", decks[0].get_texture())
	_mat.set_shader_parameter("b", decks[1].get_texture())
	_rect = ColorRect.new()
	_rect.material = _mat
	out_vp.add_child(_rect)
	resize(Vector2i(1280, 720))
	_apply()


## The live deck's Stage (the one taking params, bursts and shader picks).
func stage() -> Node3D:
	return stage_of(live)


func stage_of(i: int) -> Node3D:
	return decks[i].get_child(0)


func fading() -> bool:
	return x != float(live)


func resize(size: Vector2i) -> void:
	out_vp.size = size
	_rect.size = Vector2(size)
	for vp in decks:
		vp.size = size


## Main + second layer (+ the shader config when one runs). Same layers as on air → just the shader; else the idle deck takes
## them and fades in (`force`: fade even when the layers match — a look with another shader). Seconds <= 0 cut.
func go(main: String, overlay: String, shader_cfg: Variant, seconds: float, force := false) -> void:
	var now := stage()
	if not force and now.ids() == Stage.want(main, overlay):
		if shader_cfg != null or now.ids().has("shader"):
			now.set_shader(shader_cfg)
		return
	var next := 1 - live
	var s := stage_of(next)
	s.set_layers(main, overlay)
	s.set_shader(shader_cfg)
	s.params = now.params.duplicate()
	live = next
	fade_s = seconds
	if seconds <= 0.0:
		x = float(live)
	_apply()
	switched.emit(s)


## Canvas on or asleep (the tab hidden and not on air): the decks that show render, the rest are off.
func set_running(on: bool) -> void:
	running = on
	_apply()


## Stage audio goes to both decks (a fading-out spectrum keeps moving).
func audio_frame(d: Variant) -> void:
	for i in decks.size():
		if not stage_of(i).ids().is_empty():
			stage_of(i).audio_frame(d)


func step(delta: float) -> void:
	var was := fading()
	if was:
		var v := delta / fade_s if fade_s > 0.0 else 1.0
		x = move_toward(x, float(live), v)
	master = move_toward(master, 0.0 if blackout else level, delta / BLACKOUT_S)
	_mat.set_shader_parameter("x", x)
	_mat.set_shader_parameter("master", master)
	if was and not fading():
		_apply()


func _apply() -> void:
	for i in decks.size():
		var shows := running and (i == live or fading())
		decks[i].render_target_update_mode = SubViewport.UPDATE_ALWAYS if shows else SubViewport.UPDATE_DISABLED
		stage_of(i).set_process(shows)
		if i != live and not fading():
			stage_of(i).clear()
	out_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if running else SubViewport.UPDATE_DISABLED
	_mat.set_shader_parameter("x", x)
