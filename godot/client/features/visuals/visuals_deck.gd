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
## WO-1051: solo positions (1-based stack positions, the Visuals as a Live source picked per layer in Sources ▸ Live): each has
## its own transparent composite `solo[n]` (premultiplied, no black back, no base tint) and the layer at that position — a
## fading-out one at its old place too — draws there instead of `out`. Re-routing only re-parents the draw rect (WO-1049's
## pattern): nothing restarts. A solo composite renders while something draws there, then once more (transparent).
## WO-1054: each layer's place (x, y, size, rot) moves its draw rect (_place), in place, in any composite.
## WO-1053: composites are per route KEY — `L<n>` (a position on its own, WO-1051) or a group name (several positions in
## one composite, drawn in stack order): `solo` is keyed by the key, set_solo takes {position: key}.

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
var solo := {}  # WO-1051/1053: route key ("L4", "overlay") → its composite SubViewport (transparent)
var _route_to := {}  # WO-1053: position (1-based) → the key its layer draws into (a kept composite may be empty)
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
	for n in solo:
		solo[n].size = size
	for s in slots + leaving:
		s.vp.size = size
		s.rect.size = Vector2(size)
		_place(s)


## Shown (on the canvas, or fading on the mixer) or asleep: only layers that show render.
func set_running(on: bool) -> void:
	running = on
	_update()


## One frame: the fade-in / fade-out weights move; a layer that has faded out is freed; the backdrop follows the base's tint.
func step(delta: float) -> void:
	_backdrop()
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
	for n in solo:
		ms += RenderingServer.viewport_get_measured_render_time_gpu(solo[n].get_viewport_rid())
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


## WO-1053: `route` as {position: key}; an Array of positions (WO-1051) gives each its own key `L<n>`.
static func routes_of(route: Variant) -> Dictionary:
	if route is Dictionary:
		return (route as Dictionary).duplicate()
	var out := {}
	for n in (route if route is Array else []):
		out[int(n)] = key_of(n)
	return out


## WO-1053: a route key; a bare position is its own key `L<n>`.
static func key_of(k: Variant) -> String:
	return k if k is String else "L%d" % int(k)


## WO-1053: the distinct keys of `route` + `keep`, in first-position order.
static func keys_of(route: Dictionary, keep: Array = []) -> Array:
	var out := []
	for k in route.values() + keep.map(func(x: Variant) -> String: return key_of(x)):
		if not k in out:
			out.append(k)
	return out


## WO-1051/1053: positions route to their key's composite ({position: key}, or an Array of positions = own keys); `keep`
## keys keep a composite (empty, transparent: a ring draining after its key stopped being wanted). Composites outside both
## are freed. Only draw rects move — nothing restarts, also when a layer moves from one key to another.
func set_solo(route: Variant, keep: Array = []) -> void:
	_route_to = routes_of(route)
	var want := keys_of(_route_to, keep)
	for n in want:
		if not solo.has(n):
			var vp := SubViewport.new()
			vp.disable_3d = true
			vp.transparent_bg = true
			vp.size = _size
			vp.render_target_update_mode = SubViewport.UPDATE_ONCE
			add_child(vp)
			solo[n] = vp
	_order()
	for n in solo.keys():
		if not n in want:
			var vp: SubViewport = solo[n]
			solo.erase(n)
			remove_child(vp)
			vp.queue_free()
	_update()


## WO-1051: does anything on stage (fading out included) draw into key `k`'s composite (a position = its own key)?
func draws_solo(k: Variant) -> bool:
	var key := key_of(k)
	return solo.has(key) and (slots + leaving).any(func(s: Dictionary) -> bool: return s.rect.get_parent() == solo[key])


## WO-1051/1053: the composite stack position `n` (1-based) draws into: its key's composite while routed, else `out`.
func _target(n: int) -> SubViewport:
	var key: Variant = _route_to.get(n)
	return solo[key] if key != null and solo.has(key) else out


## Drawing order: the stack, each fading-out layer back at its old place. Every layer renders on a transparent world; the
## bottom one is the base, whose tinted background the deck paints behind the stack (_backdrop). WO-945: the base used to
## switch its viewport to an opaque background, and a SubViewport whose transparent_bg flips draws nothing for that frame —
## removing (or moving) the bottom layer flashed the layer that was leaving under it.
func _order() -> void:
	var order := slots.duplicate()
	var gone := leaving.duplicate()
	gone.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.at < b.at)
	for s in gone:
		order.insert(clampi(s.at, 0, order.size()), s)
	var at := {out: 1}  # the next child index per composite (out: 0 is the black backdrop; a key composite has none) —
	# WO-1053: a group's layers land in its composite in stack order
	for s in order:
		var i := slots.find(s)
		var to := _target((i if i >= 0 else int(s.at)) + 1)  # WO-1051: by stack position (a leaving layer: its old one)
		if s.rect.get_parent() != to:
			if s.rect.get_parent() != null:
				s.rect.get_parent().remove_child(s.rect)
			to.add_child(s.rect)
		to.move_child(s.rect, at.get(to, 0))
		at[to] = at.get(to, 0) + 1
	var base := _base()
	for i in slots.size():
		slots[i].stage.set_base(i == base)  # WO-945: the tint and a game's overlay mode only — the viewport stays transparent


## WO-1051: the base (its tint behind `out`) is the bottom layer that is not solo; -1 = none.
func _base() -> int:
	return slots.find_custom(func(s: Dictionary) -> bool: return s.rect.get_parent() == out)


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


## The base layer's background (its hue + audio flash, visuals_stage.gd bg_tint) behind the stack, at the base's opacity:
## what its opaque world used to give, the fader dimming it to black as before.
func _backdrop() -> void:
	var c := Color.BLACK
	var i := _base()
	if i >= 0:
		var b: Dictionary = slots[i]
		c = (b.stage.bg_tint as Color) * float(b.get("a", 0.0))
	_back.color = Color(c.r, c.g, c.b, 1.0)


func _update() -> void:
	for s in slots + leaving:
		var l: Dictionary = s.layer
		var a := float(l.get("opacity", 1.0)) * (1.0 if l.get("visible", true) else 0.0) * float(s.w)
		s.a = a
		var sh := _shader(str(l.get("blend", "normal")))
		if s.mat.shader != sh:
			s.mat.shader = sh
		s.mat.set_shader_parameter("opacity", a)
		s.rect.visible = a > 0.0
		_place(s)
		var on := running and a > 0.0
		s.vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if on else SubViewport.UPDATE_DISABLED
		s.stage.set_process(on)
	out.render_target_update_mode = SubViewport.UPDATE_ALWAYS if running else SubViewport.UPDATE_DISABLED
	for n in solo:  # WO-1051: while something draws there; ONCE leaves it transparent after the last layer left (or asleep)
		var used := draws_solo(n)
		solo[n].render_target_update_mode = SubViewport.UPDATE_ALWAYS if running and used else (
			SubViewport.UPDATE_ONCE if not used else SubViewport.UPDATE_DISABLED)


## WO-1054: the layer's place (visuals_layers.gd PLACE) on its draw rect, in whichever composite it draws into (`out` or a
## route key's): pivot at the canvas centre, scaled by `size`, rotated by `rot`, offset by (x·W, −y·H). The rect only moves —
## the layer's own picture is the same, and what it no longer covers shows what is under it (the black back, or transparency).
func _place(s: Dictionary) -> void:
	var p := L.place_of(s.layer)
	var sz := Vector2(_size)
	s.rect.pivot_offset = sz * 0.5
	s.rect.position = Vector2(float(p["x"]) * sz.x, -float(p["y"]) * sz.y)
	s.rect.scale = Vector2.ONE * float(p["size"])
	s.rect.rotation_degrees = float(p["rot"])
