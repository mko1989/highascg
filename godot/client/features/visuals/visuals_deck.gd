extends Node
## WO-890 — one deck of the Visuals mixer (visuals_mixer.gd keeps two, A/B, for look crossfades): the layer stack
## (visuals_layers.gd) composited bottom → top. Each layer is a Stage (visuals_stage.gd: camera, environment, burst, audio)
## running ONE scene in its own World3D inside its own SubViewport; `out` (2D) draws them in order over black, each with
## its opacity — "normal" = premultiplied over (opaque content covers what is below, the black around it and the bloom
## add), "add" = added. Why one world per layer and not all scenes in one world (the WO-873 main + overlay): in one world
## the depth decides what covers what (a tunnel's walls hide everything at any order) and a 3D scene has no opacity of its
## own; a world per layer makes the list order the drawing order and the fader a plain alpha, for any scene, at the cost of
## one render per layer (hence the cap, visuals_layers.gd MAX, and muted / 0 % layers do not render at all).
## Edits are in place: a layer whose picture is unchanged keeps running (no restart, no shader recompile), a new one fades
## in and a removed one fades out over `fade` seconds, at its place in the stack; a fader moves at once.

const Stage := preload("res://features/visuals/visuals_stage.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const SRC := {
	"normal": "shader_type canvas_item;\nrender_mode blend_premul_alpha;\nuniform float opacity = 1.0;\n" +
		"void fragment() {\n\tCOLOR = texture(TEXTURE, UV) * opacity;\n}\n",
	"add": "shader_type canvas_item;\nrender_mode blend_add;\nuniform float opacity = 1.0;\n" +
		"void fragment() {\n\tCOLOR = vec4(texture(TEXTURE, UV).rgb, opacity);\n}\n",
}
static var _shaders := {}

var out: SubViewport
var slots := []  # the layers on stage, bottom → top: {vp, stage, rect, mat, key, layer, w (fade-in weight), to}
var leaving := []  # removed or replaced layers fading out, then freed: the same, + `at` (their place in the stack)
var running := true
var fade_s := 1.0
var measure := false  # dev probes: GPU time per viewport (gpu_ms)
var params := {}:  # the evaluated parameters (visuals_tab.gd, every frame) → every layer's stage
	set(v):
		params = v
		for s in slots + leaving:
			s.stage.params = v
## WO-896: the camera pose (visuals_camera.gd) of every layer on this deck, so a stack stays aligned. Per deck: a crossfade
## between looks with different poses keeps the outgoing deck where it was while the incoming one starts at its own.
var cam := Vector3(0.0, 0.0, 14.0):
	set(v):
		cam = v
		for s in slots + leaving:
			s.stage.pose = v
var _size := Vector2i(1280, 720)
var _back: ColorRect


func _init() -> void:
	out = SubViewport.new()
	out.disable_3d = true
	out.size = _size
	add_child(out)
	_back = ColorRect.new()
	_back.color = Color.BLACK
	_back.size = Vector2(_size)
	out.add_child(_back)


static func _shader(blend: String) -> Shader:
	if not _shaders.has(blend):
		var sh := Shader.new()
		sh.code = SRC.get(blend, SRC.normal)
		_shaders[blend] = sh
	return _shaders[blend]


## The stack becomes `layers` (normalised, bottom → top). `cfgs`: shader id → its config (GET /api/shaders/:id), for the
## shader layers that start now. Layers matching a running one (same picture: L.key) keep it; `seconds` fades the others.
func apply(layers: Array, cfgs: Dictionary, seconds: float) -> void:
	fade_s = seconds
	var pool := slots + leaving
	var next := []
	for l in layers:
		var k := L.key(l)
		var i := pool.find_custom(func(s: Dictionary) -> bool: return s.key == k)
		var s: Dictionary
		if i >= 0:
			s = pool[i]
			pool.remove_at(i)
		else:
			s = _slot(l, cfgs)
			s.w = 0.0 if seconds > 0.0 else 1.0
		if l.scene == "shader" and cfgs.get(str(l.get("shader", ""))) != null:
			s.stage.set_shader(cfgs[str(l.shader)])  # the same config again is no recompile (visuals_stage.gd)
		s.layer = l.duplicate(true)
		s.to = 1.0
		next.append(s)
	for s in pool:  # gone from the stack: fade out where it was
		if s.to > 0.0:
			s.at = slots.find(s)
			s.to = 0.0
		if seconds <= 0.0:
			s.w = 0.0
	slots = next
	leaving = pool
	_order()
	_reap()
	_update()


## Everything off stage at once (the mixer's idle deck, a deck about to load a look).
func clear() -> void:
	for s in slots + leaving:
		_free(s)
	slots = []
	leaving = []


func is_empty() -> bool:
	return slots.is_empty() and leaving.is_empty()


## The scene ids on stage, bottom first.
func ids() -> Array:
	return slots.map(func(s: Dictionary) -> String: return s.layer.scene)


## Every scene node on stage (e.g. the game's live()).
func scenes() -> Array:
	var out_ := []
	for s in slots:
		out_.append_array(s.stage.layers)
	return out_


func stage_at(i: int) -> Node3D:
	return slots[i].stage if i >= 0 and i < slots.size() else null


## The world of layer `i` (the 3D view's orbit camera looks into it).
func world_of(i: int) -> World3D:
	return slots[clampi(i, 0, slots.size() - 1)].vp.world_3d if not slots.is_empty() else null


## {layer index: compile error} of the shader layers that do not run.
func errors() -> Dictionary:
	var e := {}
	for i in slots.size():
		if slots[i].layer.scene == "shader" and slots[i].stage.shader_error != "":
			e[i] = slots[i].stage.shader_error
	return e


## The manual burst (Inspector button, Space) on every layer.
func fire() -> void:
	for s in slots:
		s.stage.fire()


func audio_frame(d: Variant) -> void:
	for s in slots + leaving:
		s.stage.audio_frame(d)


func resize(size: Vector2i) -> void:
	_size = size
	out.size = size
	_back.size = Vector2(size)
	for s in slots + leaving:
		s.vp.size = size
		s.rect.size = Vector2(size)


## Shown (on the canvas, or fading on the mixer) or asleep: only layers that show render.
func set_running(on: bool) -> void:
	running = on
	_update()


## One frame: the fade-in / fade-out weights move; a layer that has faded out is freed.
func step(delta: float) -> void:
	var moved := false
	for s in slots + leaving:
		if s.w != s.to:
			s.w = move_toward(s.w, s.to, delta / fade_s if fade_s > 0.0 else 1.0)
			moved = true
	if moved:
		_reap()
		_update()


## GPU ms of the last frame (dev probes, with `measure` set before the layers were made): every layer + the composite.
func gpu_ms() -> float:
	var ms := RenderingServer.viewport_get_measured_render_time_gpu(out.get_viewport_rid())
	for s in slots + leaving:
		ms += RenderingServer.viewport_get_measured_render_time_gpu(s.vp.get_viewport_rid())
	return ms


func _slot(l: Dictionary, cfgs: Dictionary) -> Dictionary:
	var vp := SubViewport.new()
	vp.world_3d = World3D.new()
	vp.size = _size
	vp.transparent_bg = true
	vp.render_target_update_mode = SubViewport.UPDATE_DISABLED
	var st: Node3D = Stage.new()
	st.start_scene = ""
	st.ready.connect(func() -> void:  # entering the tree switches _process on: only a layer that renders steps (a shader
		st.set_process(vp.render_target_update_mode != SubViewport.UPDATE_DISABLED), CONNECT_ONE_SHOT)  # runs on the GPU)
	vp.add_child(st)
	add_child(vp)
	st.set_process(false)
	st.set_layers(l.scene, "")
	if l.scene == "shader":
		st.set_shader(cfgs.get(str(l.get("shader", ""))))
	st.params = params
	st.pose = cam
	if measure:
		RenderingServer.viewport_set_measure_render_time(vp.get_viewport_rid(), true)
	var mat := ShaderMaterial.new()
	var rect := TextureRect.new()
	rect.texture = vp.get_texture()
	rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	rect.stretch_mode = TextureRect.STRETCH_SCALE
	rect.size = Vector2(_size)
	rect.material = mat
	rect.visible = false
	out.add_child(rect)
	return {"vp": vp, "stage": st, "rect": rect, "mat": mat, "key": L.key(l), "layer": l, "w": 1.0, "to": 1.0, "at": 0}


## Drawing order: the stack, each fading-out layer back at its old place; the bottom layer is the base (opaque, the tinted
## background), every other one renders on a transparent black world.
func _order() -> void:
	var order := slots.duplicate()
	var gone := leaving.duplicate()
	gone.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.at < b.at)
	for s in gone:
		order.insert(clampi(s.at, 0, order.size()), s)
	for i in order.size():
		out.move_child(order[i].rect, i + 1)  # 0 is the black backdrop
	for i in slots.size():
		slots[i].stage.set_base(i == 0)
		slots[i].vp.transparent_bg = i != 0


func _reap() -> void:
	for s in leaving.filter(func(x: Dictionary) -> bool: return x.w <= 0.0 and x.to <= 0.0):
		leaving.erase(s)
		_free(s)


func _free(s: Dictionary) -> void:
	s.rect.queue_free()
	s.vp.queue_free()
	if s.rect.get_parent() != null:
		s.rect.get_parent().remove_child(s.rect)
	if s.vp.get_parent() != null:
		s.vp.get_parent().remove_child(s.vp)


func _update() -> void:
	for s in slots + leaving:
		var l: Dictionary = s.layer
		var a := float(l.get("opacity", 1.0)) * (1.0 if l.get("visible", true) else 0.0) * float(s.w)
		var sh := _shader(str(l.get("blend", "normal")))
		if s.mat.shader != sh:
			s.mat.shader = sh
		s.mat.set_shader_parameter("opacity", a)
		s.rect.visible = a > 0.0
		var on := running and a > 0.0
		s.vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
		s.stage.set_process(on)
	out.render_target_update_mode = SubViewport.UPDATE_ALWAYS if running else SubViewport.UPDATE_DISABLED
