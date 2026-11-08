extends RefCounted
## WO-999 step 2 — runs one FragCoord config (fragcoord_glsl.gd) on the main RenderingDevice into `texture`, the twin of
## shadertoy_rd.gd for the other dialect (same surface: use / render / release / texture / error / compiles / gpu_ms, so
## scenes/shader.gd swaps them by `cfg.dialect`). FragCoord's rules:
## - Passes draw pass1..N, then main. A pass reads an aux pass drawn earlier this frame from its new half, itself and later
##   passes from last frame's (ping-pong pairs). `u_main` is main's previous frame (copied after each draw).
## - Buffers are the pass's `format`, rgba8 by default (FragCoord's; it clamps, which feedback shaders rely on).
## - `u_audio` is the shared 512×512 spectrogram (fc_spectrogram.gd), uploaded when it changed; `u_keyboard`, `u_webcam` and
##   unknown passes read opaque black (FragCoord's placeholder). Custom textures (URL images, videos, `proc3d:` LUTs, 3D and
##   cube samplers) read opaque white until they get sources: they mostly multiply a colour (a LUT), where black would
##   blank the shader.
## - Linear filtering, clamp to edge. Custom uniform values ride in the UBO, so `values` changes never recompile.
## Compiling (glslang) happens on the caller's thread; every GPU object is made, drawn and freed on the render thread.

const F := preload("res://features/visuals/fragcoord_glsl.gd")
const Spec := preload("res://features/visuals/fc_spectrogram.gd")
const AUDIO_W := 512  # shader.gd sizes its (unused here) audio strip by the runner's AUDIO_W

var texture := Texture2DRD.new()
var error := ""
var compiles := 0
var gpu_ms := 0.0
var _rd: RenderingDevice
var _spirv := []  # per pass: {name, format, alpha, samplers, types, spirv}
var _us := []  # fragcoord_glsl.gd uniforms()
var _values: Variant = {}
var _key := []  # what was compiled: [common, passes, uniforms]
var _dirty := false
var _size := Vector2i.ZERO
var _frame := 0
var _audio_rev := -1  # render thread: the spectrogram revision on the GPU
var _gpu := {}


func _init() -> void:
	_rd = RenderingServer.get_rendering_device()  # null headless: use() says so, render() no-ops


## Compile a config; "" on success, else the first error (line numbers are the pass's own). A config that differs from the
## running one only in `values` compiles nothing.
func use(cfg: Variant) -> String:
	error = ""
	var ps := F.passes(cfg)
	if ps.is_empty():
		error = "no main pass"
	elif _rd == null:
		error = "no GPU (headless)"
	if error != "":
		return error
	var us := F.uniforms(cfg)
	var values: Variant = cfg.get("values") if cfg.get("values") is Dictionary else {}
	var key := [str(cfg.get("common", "")), ps, us]
	if key == _key and not _spirv.is_empty():
		_values = values
		return ""
	compiles += 1
	var out := []
	for p in ps:
		var fr := F.fragment(str(cfg.get("common", "")), p, us)
		var src := RDShaderSource.new()
		src.source_vertex = F.G.VERTEX
		src.source_fragment = fr.code
		var sp := _rd.shader_compile_spirv_from_source(src)
		var e := (sp.compile_error_fragment + sp.compile_error_vertex).strip_edges()
		if e != "":
			error = "%s: %s" % [p.name, e.split("\n").slice(0, 3)]
			return error
		out.append({"name": p.name, "format": p.format, "alpha": p.alpha, "samplers": fr.samplers, "types": fr.types, "spirv": sp})
	_spirv = out
	_us = us
	_values = values
	_key = key
	_dirty = true
	return ""


## True when a pass samples `name` (u_audio, u_main…).
func uses(name: String) -> bool:
	return _spirv.any(func(p: Dictionary) -> bool: return name in p.samplers)


## Draw one frame at `size`. `_audio` is the Shadertoy strip shader.gd keeps; FragCoord reads the shared spectrogram.
func render(size: Vector2i, time: float, delta: float, _audio := PackedByteArray()) -> void:
	if _rd == null or _spirv.is_empty() or size.x < 8 or size.y < 8:
		return
	var rebuild := _dirty or size != _size
	_dirty = false
	_size = size
	var audio := PackedByteArray()
	var rev := -1
	if uses("u_audio"):
		var sp: RefCounted = Spec.shared()
		audio = sp.pull(Engine.get_frames_drawn(), delta)
		rev = sp.rev
	var slots := F.slot_values(_us, _values)
	RenderingServer.call_on_render_thread(_draw.bind(rebuild, _spirv, size, time, delta, audio, rev, slots))


## Free everything (the scene leaves the stage).
func release() -> void:
	_spirv = []
	_key = []
	texture.texture_rd_rid = RID()
	if _rd != null:
		RenderingServer.call_on_render_thread(_free_gpu.bind(_gpu))
	_gpu = {}


func _draw(rebuild: bool, spirv: Array, size: Vector2i, time: float, delta: float, audio: PackedByteArray, rev: int,
		slots: PackedFloat32Array) -> void:
	if rebuild:  # the new set is live before the old one is freed
		var old := _gpu
		_gpu = _build(spirv, size)
		texture.texture_rd_rid = _gpu.image
		_free_gpu(old)
		_frame = 0
		_audio_rev = -1
	var g := _gpu
	if g.is_empty():
		return
	if g.has("audio") and rev != _audio_rev and audio.size() == Spec.W * Spec.H * Spec.BPP:
		_rd.texture_update(g.audio, 0, audio)
		_audio_rev = rev
	_read_gpu_time()
	var par := _frame & 1
	var ubo := _ubo_bytes(size, time, delta, slots)
	_rd.capture_timestamp("fragcoord begin")
	for p in g.passes:
		_rd.buffer_update(p.ubo, 0, F.UBO_SIZE, ubo)
		var dl := _rd.draw_list_begin(p.fb[par], RenderingDevice.DRAW_CLEAR_COLOR_ALL if _frame == 0 else RenderingDevice.DRAW_DEFAULT_ALL,
			PackedColorArray([Color(0, 0, 0, 0)]))
		_rd.draw_list_bind_render_pipeline(dl, p.pipeline)
		_rd.draw_list_bind_uniform_set(dl, p.sets[par], 0)
		_rd.draw_list_draw(dl, false, 1, 3)
		_rd.draw_list_end()
	if g.has("prev"):  # u_main: this frame's main is next frame's backbuffer
		_rd.texture_copy(g.image, g.prev, Vector3.ZERO, Vector3.ZERO, Vector3(size.x, size.y, 1), 0, 0, 0, 0)
	_rd.capture_timestamp("fragcoord end")
	_frame += 1


func _read_gpu_time() -> void:
	var begin := -1
	for i in _rd.get_captured_timestamps_count():
		var n := _rd.get_captured_timestamp_name(i)
		if n == "fragcoord begin":
			begin = _rd.get_captured_timestamp_gpu_time(i)
		elif n == "fragcoord end" and begin >= 0:
			gpu_ms = (_rd.get_captured_timestamp_gpu_time(i) - begin) / 1e6  # ns


static func _data_format(f: String) -> int:
	if f.ends_with("32f"):
		return RenderingDevice.DATA_FORMAT_R32G32B32A32_SFLOAT
	if f.ends_with("16f"):
		return RenderingDevice.DATA_FORMAT_R16G16B16A16_SFLOAT
	return RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM  # rgba8 and the 8-bit narrower ones


func _build(spirv: Array, size: Vector2i) -> Dictionary:
	var g := {"passes": [], "bufs": {}}
	var st := RDSamplerState.new()
	st.min_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	st.mag_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	st.repeat_u = RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	st.repeat_v = RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	g.sampler = _rd.sampler_create(st)
	g.black = _tex(Vector2i.ONE, RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM, 0, PackedByteArray([0, 0, 0, 255]))
	g.white = {"sampler2D": _tex(Vector2i.ONE, RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM, 0, PackedByteArray([255, 255, 255, 255]))}
	for type in ["sampler3D", "samplerCube"]:
		if spirv.any(func(p: Dictionary) -> bool: return type in p.types):
			g.white[type] = _white(type)
	if spirv.any(func(p: Dictionary) -> bool: return "u_audio" in p.samplers):
		g.audio = _tex(Vector2i(Spec.W, Spec.H), RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM,
			RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT, PackedByteArray())
	var target := RenderingDevice.TEXTURE_USAGE_COLOR_ATTACHMENT_BIT | RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT
	var main: Dictionary = spirv[-1]
	g.image = _tex(size, _data_format(main.format), target | RenderingDevice.TEXTURE_USAGE_CAN_COPY_FROM_BIT, PackedByteArray())
	if spirv.any(func(p: Dictionary) -> bool: return "u_main" in p.samplers):
		g.prev = _tex(size, _data_format(main.format), target, PackedByteArray())
	for p in spirv:
		if p.name != "main":
			g.bufs[p.name] = [_tex(size, _data_format(p.format), target, PackedByteArray()),
				_tex(size, _data_format(p.format), target, PackedByteArray())]
	var drawn := {}
	for p in spirv:
		var shader := _rd.shader_create_from_spirv(p.spirv, "fragcoord " + p.name)
		var outs: Array = g.bufs[p.name] if p.name != "main" else [g.image, g.image]
		var fb := [_rd.framebuffer_create([outs[0]]), _rd.framebuffer_create([outs[1]])]
		var blend := RDPipelineColorBlendState.new()
		blend.attachments = [RDPipelineColorBlendStateAttachment.new()]
		var pipeline := _rd.render_pipeline_create(shader, _rd.framebuffer_get_format(fb[0]), RenderingDevice.INVALID_FORMAT_ID,
			RenderingDevice.RENDER_PRIMITIVE_TRIANGLES, RDPipelineRasterizationState.new(), RDPipelineMultisampleState.new(),
			RDPipelineDepthStencilState.new(), blend)
		var ubo := _rd.uniform_buffer_create(F.UBO_SIZE)
		var sets := []
		for par in 2:
			var us := [_uniform(RenderingDevice.UNIFORM_TYPE_UNIFORM_BUFFER, 0, [ubo])]
			for i in p.samplers.size():
				var tex := _source(g, p.samplers[i], str(p.types[i]), par, drawn)
				us.append(_uniform(RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE, i + 1, [g.sampler, tex]))
			sets.append(_rd.uniform_set_create(us, shader, 0))
		drawn[p.name] = true
		g.passes.append({"shader": shader, "pipeline": pipeline, "ubo": ubo, "fb": fb, "sets": sets})
	return g


## The texture a sampler reads in parity `par`: an aux pass drawn earlier this frame → its new half, else last frame's.
func _source(g: Dictionary, name: String, type: String, par: int, drawn: Dictionary) -> RID:
	if name == "u_audio" and g.has("audio"):
		return g.audio
	if name == "u_main" and g.has("prev"):
		return g.prev
	var pass_name := name.substr(2) if name.begins_with("u_pass") else ""
	if g.bufs.has(pass_name):
		return g.bufs[pass_name][par if drawn.has(pass_name) else 1 - par]
	if name in F.SAMPLERS or pass_name != "":
		return g.black
	return g.white.get(type, g.white.sampler2D)


## A 1-texel opaque white 3D or cube texture (custom samplers without a source yet).
func _white(type: String) -> RID:
	var f := RDTextureFormat.new()
	f.width = 1
	f.height = 1
	f.format = RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM
	f.usage_bits = RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT
	var px := PackedByteArray([255, 255, 255, 255])
	if type == "sampler3D":
		f.texture_type = RenderingDevice.TEXTURE_TYPE_3D
		return _rd.texture_create(f, RDTextureView.new(), [px])
	f.texture_type = RenderingDevice.TEXTURE_TYPE_CUBE
	f.array_layers = 6
	return _rd.texture_create(f, RDTextureView.new(), [px, px, px, px, px, px])


func _free_gpu(g: Dictionary) -> void:
	if g.is_empty():
		return
	for p in g.passes:  # dependents first: sets and framebuffers, then pipelines, shaders, textures
		for s in p.sets:
			if _rd.uniform_set_is_valid(s):
				_rd.free_rid(s)
		for f in p.fb:
			if _rd.framebuffer_is_valid(f):
				_rd.free_rid(f)
		if _rd.render_pipeline_is_valid(p.pipeline):
			_rd.free_rid(p.pipeline)
		_rd.free_rid(p.shader)
		_rd.free_rid(p.ubo)
	var texs: Array = [g.image, g.black] + g.white.values() + g.bufs.values().reduce(func(a: Array, b: Array) -> Array: return a + b, [])
	for k in ["audio", "prev"]:
		if g.has(k):
			texs.append(g[k])
	for t in texs:
		if _rd.texture_is_valid(t):
			_rd.free_rid(t)
	_rd.free_rid(g.sampler)


func _tex(size: Vector2i, format: int, usage: int, data: PackedByteArray) -> RID:
	var f := RDTextureFormat.new()
	f.width = size.x
	f.height = size.y
	f.format = format
	f.usage_bits = RenderingDevice.TEXTURE_USAGE_SAMPLING_BIT | usage
	return _rd.texture_create(f, RDTextureView.new(), [data] if data.size() > 0 else [])


func _uniform(type: int, binding: int, ids: Array) -> RDUniform:
	var u := RDUniform.new()
	u.uniform_type = type
	u.binding = binding
	for id in ids:
		u.add_id(id)
	return u


## The std140 FragCoord block (fragcoord_glsl.gd BLOCK): 44 floats with u_frame an int at float 38, then the slots.
## Visuals has no pointer or orbit camera for a shader: u_mouse 0, the camera 3 units back on +z looking at the origin.
func _ubo_bytes(size: Vector2i, time: float, delta: float, slots: PackedFloat32Array) -> PackedByteArray:
	var f := PackedFloat32Array()
	f.resize(F.C_AT)
	f[0] = size.x
	f[1] = size.y
	f[2] = time
	f[3] = delta
	var d := Time.get_datetime_dict_from_system()
	f[8] = d.year
	f[9] = d.month - 1  # FragCoord takes Shadertoy's iDate as is: JS getMonth()
	f[10] = d.day
	f[11] = d.hour * 3600 + d.minute * 60 + d.second
	f[14] = 3.0  # u_camera_pos (0, 0, 3)
	f[15] = DisplayServer.screen_get_refresh_rate() if DisplayServer.get_name() != "headless" else 60.0
	if f[15] <= 0.0:
		f[15] = 60.0
	f[18] = -1.0  # u_camera_dir (0, 0, -1)
	for i in 4:  # u_camera_view: identity, translated by -pos (column-major; column 3 = (0, 0, -3, 1))
		f[20 + i * 5] = 1.0
	f[34] = -3.0
	f.append_array(slots)
	var b := f.to_byte_array()
	b.encode_s32(38 * 4, _frame)
	return b
