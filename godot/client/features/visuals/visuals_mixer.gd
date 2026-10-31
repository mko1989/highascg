extends Node
## WO-877 — show transitions for the Visuals: two decks (visuals_deck.gd: a layer stack each, WO-890), one live. A new look
## loads into the idle deck and crossfades in over `fade` seconds; the canvas (`out_vp`, what Send publishes) is the two decks
## mixed, times the master (fader and blackout, faded too). The idle deck renders nothing and holds no layers.
## WO-890: an edit of the stack (a drop, a fader, mute, order) is not a look change — the live deck takes it in place
## (unchanged layers keep running, new / removed ones fade on their own); only `force` (a look, the autopilot) uses the decks.
## WO-908: `dj` — A/B banks (visuals_dj.gd): both decks stay on stage, `x` is the crossfader (moved by hand, MIDI, or AUTO /
## CUT towards the other side over `fade_s`), `live` is the bank being edited (on air or in PRV) and every stack edit or look
## goes into it in place — faded when it is on the canvas, cut when it is not.

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
var dj := false
var goal := -1.0  # WO-908: where AUTO is moving `x` (0 or 1); -1 = still
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
	return goal >= 0.0 if dj else x != float(live)


## WO-908: the deck on the canvas (DJ: the crossfader's side; mixed half and half: B).
func air() -> int:
	return int(x >= 0.5) if dj else live


## WO-908: deck `i`'s share of the canvas.
func weight(i: int) -> float:
	return x if i == 1 else 1.0 - x


func resize(size: Vector2i) -> void:
	out_vp.size = size
	_rect.size = Vector2(size)
	for d in decks:
		d.resize(size)


## The layer stack (visuals_layers.gd, bottom → top) with the configs of its shaders (id → GET /api/shaders/:id).
## Not `force`: the live deck edits in place (new / removed layers fade over `seconds`). `force` (a look): the idle deck
## loads the whole stack and the decks crossfade over `seconds`. Seconds <= 0 cut.
func go(layers: Array, cfgs: Dictionary, seconds: float, force := false, cam: Variant = null) -> void:
	if not force or dj:
		if dj and weight(live) <= 0.0:
			seconds = 0.0  # WO-908: the PRV bank cuts — nobody sees it change
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


## WO-908: A/B banks on (bank `edit` takes the edits, the crossfader at `at`) or off (the bank on the canvas stays, the
## other fades out over `fade_s` and is emptied).
func set_dj(on: bool, edit := 0, at := 0.0) -> void:
	if on:
		live = edit
		x = clampf(at, 0.0, 1.0)
	else:
		live = air()
	dj = on
	goal = -1.0
	_apply()


## WO-908: the crossfader by hand (or MIDI): stops an AUTO.
func set_x(v: float) -> void:
	x = clampf(v, 0.0, 1.0)
	goal = -1.0
	_mat.set_shader_parameter("x", x)


## WO-908: AUTO — the crossfader to the other side over `fade_s`; `cut` (or fade 0) jumps there.
func take(cut := false) -> void:
	if not dj:
		return
	if goal < 0.0:
		goal = 1.0 - float(air())
	if cut or fade_s <= 0.0:
		x = goal
		goal = -1.0
	_mat.set_shader_parameter("x", x)


## Stage audio goes to both decks (a fading-out spectrum keeps moving).
func audio_frame(d: Variant) -> void:
	for k in decks:
		if not k.is_empty():
			k.audio_frame(d)


func step(delta: float) -> void:
	var was := fading()
	if was:
		var v := delta / fade_s if fade_s > 0.0 else 1.0
		x = move_toward(x, goal if dj else float(live), v)
		if dj and x == goal:
			goal = -1.0
	master = move_toward(master, 0.0 if blackout else level, delta / BLACKOUT_S)
	_mat.set_shader_parameter("x", x)
	_mat.set_shader_parameter("master", master)
	for d in decks:
		d.step(delta)
	if was and not fading():
		_apply()


func _apply() -> void:
	for i in decks.size():
		var shows := running and (dj or i == live or fading())
		if not dj and i != live and not fading():
			decks[i].clear()
		decks[i].set_running(shows)
	out_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if running else SubViewport.UPDATE_DISABLED
	_mat.set_shader_parameter("x", x)
