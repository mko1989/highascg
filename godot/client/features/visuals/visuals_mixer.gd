extends Node
## WO-877 — show transitions for the Visuals: two decks (visuals_deck.gd: a layer stack each, WO-890), one live. A new look
## loads into the idle deck and crossfades in over `fade` seconds; the canvas (`out_vp`, what Send publishes) is the two decks
## mixed, times the master (fader and blackout, faded too). The idle deck renders nothing and holds no layers.
## WO-890: an edit of the stack (a drop, a fader, mute, order) is not a look change — the live deck takes it in place
## (unchanged layers keep running, new / removed ones fade on their own); only `force` (a look, the autopilot) uses the decks.

const Deck := preload("res://features/visuals/visuals_deck.gd")
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

signal switched(deck: Node)

var out_vp: SubViewport
var decks: Array[Node] = []
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
		var d: Node = Deck.new()
		add_child(d)
		decks.append(d)
	_mat = ShaderMaterial.new()
	_mat.shader = Shader.new()
	_mat.shader.code = MIX
	_mat.set_shader_parameter("a", decks[0].out.get_texture())
	_mat.set_shader_parameter("b", decks[1].out.get_texture())
	_rect = ColorRect.new()
	_rect.material = _mat
	out_vp.add_child(_rect)
	resize(Vector2i(1280, 720))
	_apply()


## The live deck (the one taking params, bursts and edits).
func deck() -> Node:
	return decks[live]


func deck_of(i: int) -> Node:
	return decks[i]


func fading() -> bool:
	return x != float(live)


func resize(size: Vector2i) -> void:
	out_vp.size = size
	_rect.size = Vector2(size)
	for d in decks:
		d.resize(size)


## The layer stack (visuals_layers.gd, bottom → top) with the configs of its shaders (id → GET /api/shaders/:id).
## Not `force`: the live deck edits in place (new / removed layers fade over `seconds`). `force` (a look): the idle deck
## loads the whole stack and the decks crossfade over `seconds`. Seconds <= 0 cut.
func go(layers: Array, cfgs: Dictionary, seconds: float, force := false, cam: Variant = null) -> void:
	if not force:
		if cam is Vector3:  # WO-896: the camera pose of the stack (a look carries its own; the outgoing deck keeps its pose)
			deck().cam = cam
		deck().apply(layers, cfgs, seconds)
		_apply()
		return
	var next := 1 - live
	var d := deck_of(next)
	d.clear()
	d.params = deck().params.duplicate()
	d.cam = cam if cam is Vector3 else deck().cam
	d.apply(layers, cfgs, 0.0)
	live = next
	fade_s = seconds
	if seconds <= 0.0:
		x = float(live)
	_apply()
	switched.emit(d)


## Canvas on or asleep (the tab hidden and not on air): the decks that show render, the rest are off.
func set_running(on: bool) -> void:
	running = on
	_apply()


## Stage audio goes to both decks (a fading-out spectrum keeps moving).
func audio_frame(d: Variant) -> void:
	for k in decks:
		if not k.is_empty():
			k.audio_frame(d)


func step(delta: float) -> void:
	var was := fading()
	if was:
		var v := delta / fade_s if fade_s > 0.0 else 1.0
		x = move_toward(x, float(live), v)
	master = move_toward(master, 0.0 if blackout else level, delta / BLACKOUT_S)
	_mat.set_shader_parameter("x", x)
	_mat.set_shader_parameter("master", master)
	for d in decks:
		d.step(delta)
	if was and not fading():
		_apply()


func _apply() -> void:
	for i in decks.size():
		var shows := running and (i == live or fading())
		if i != live and not fading():
			decks[i].clear()
		decks[i].set_running(shows)
	out_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if running else SubViewport.UPDATE_DISABLED
	_mat.set_shader_parameter("x", x)
