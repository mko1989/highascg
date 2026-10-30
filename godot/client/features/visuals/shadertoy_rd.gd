extends RefCounted
## WO-874 — runs one Shadertoy config (shadertoy_glsl.gd) on the main RenderingDevice into `texture` (a Texture2DRD the shader
## scene draws). Buffers A–D are ping-pong pairs (RGBA32F, linear, clamp — Shadertoy's defaults): a pass reads a buffer
## already drawn this frame from its new half, itself and later buffers from last frame's. Channel "audio" is the 512×2 R8
## texture (row 0 FFT, row 1 wave); unbound channels read black. Compiling (glslang) happens on the caller's thread, so a
## broken shader reports at once; every GPU object is made, drawn and freed on the render thread.

const G := preload("res://features/visuals/shadertoy_glsl.gd")
const AUDIO_W := 512

var texture := Texture2DRD.new()
var error := ""
var gpu_ms := 0.0  # the passes' GPU time, from the RD timestamps of a recent frame (they arrive a few frames late)
var _rd: RenderingDevice
var _spirv := []  # per pass: {name, letter, channels, spirv}
var _dirty := false
var _size := Vector2i.ZERO
var _frame := 0
var _gpu := {}  # render-thread objects: passes [{shader, pipeline, ubo, fb[2], sets[2]}], bufs {letter: [tex, tex]}, image…


func _init() -> void:
	_rd = RenderingServer.get_rendering_device()  # null headless (the test runner): use() says so, render() no-ops


## Compile a config; "" on success, else the first error (line numbers are the pass's own).
func use(cfg: Variant) -> String:
	error = ""
	var ps := G.passes(cfg)
	if ps.is_empty():
		error = "no image pass"
	elif _rd == null:
		error = "no GPU (headless)"
	var out := []
	var common := str(cfg.get("common", "")) if cfg is Dictionary else ""
	for p in ps if error == "" else []:
		var src := RDShaderSource.new()
		src.source_vertex = G.VERTEX
		src.source_fragment = G.fragment(common, p.source, p.alpha)
		var sp := _rd.shader_compile_spirv_from_source(src)
		var e := (sp.compile_error_fragment + sp.compile_error_vertex).strip_edges()
		if e != "":
			error = "%s: %s" % [p.name, e.split("\n").slice(0, 3)]
			break
		out.append({"name": p.name, "letter": G.letter(p.name), "channels": p.channels, "spirv": sp})
	if error != "":
		return error
	_spirv = out
	_dirty = true
	return ""


## Draw one frame at `size`. `audio` is 1024 bytes (FFT row then wave row).
func render(size: Vector2i, time: float, delta: float, audio: PackedByteArray) -> void:
	if _rd == null or _spirv.is_empty() or size.x < 8 or size.y < 8:
		return
	var rebuild := _dirty or size != _size
	_dirty = false
	_size = size
	RenderingServer.call_on_render_thread(_draw.bind(rebuild, _spirv, size, time, delta, audio))


## Free everything (the scene leaves the stage).
func release() -> void:
	_spirv = []
	texture.texture_rd_rid = RID()
	if _rd != null:
		RenderingServer.call_on_render_thread(_free_gpu.bind(_gpu))
	_gpu = {}


func _draw(rebuild: bool, spirv: Array, size: Vector2i, time: float, delta: float, audio: PackedByteArray) -> void:
	if rebuild:  # the new set is live before the old one is freed
		var old := _gpu
		_gpu = _build(spirv, size)
		texture.texture_rd_rid = _gpu.image
		_free_gpu(old)
		_frame = 0
	var g := _gpu
	if g.is_empty():
		return
	if audio.size() == AUDIO_W * 2:
		_rd.texture_update(g.audio, 0, audio)
	_read_gpu_time()
	var par := _frame & 1
	_rd.capture_timestamp("shadertoy begin")
	for p in g.passes:
		_rd.buffer_update(p.ubo, 0, G.UBO_SIZE, _ubo_bytes(size, time, delta, p.res))
		var dl := _rd.draw_list_begin(p.fb[par], RenderingDevice.DRAW_CLEAR_COLOR_ALL if _frame == 0 else RenderingDevice.DRAW_DEFAULT_ALL,
			PackedColorArray([Color(0, 0, 0, 0)]))
		_rd.draw_list_bind_render_pipeline(dl, p.pipeline)
		_rd.draw_list_bind_uniform_set(dl, p.sets[par], 0)
		_rd.draw_list_draw(dl, false, 1, 3)
		_rd.draw_list_end()
	_rd.capture_timestamp("shadertoy end")
	_frame += 1


func _read_gpu_time() -> void:
	var begin := -1
	for i in _rd.get_captured_timestamps_count():
		var n := _rd.get_captured_timestamp_name(i)
		if n == "shadertoy begin":
			begin = _rd.get_captured_timestamp_gpu_time(i)
		elif n == "shadertoy end" and begin >= 0:
			gpu_ms = (_rd.get_captured_timestamp_gpu_time(i) - begin) / 1e6  # ns


func _build(spirv: Array, size: Vector2i) -> Dictionary:
	var g := {"passes": [], "bufs": {}, "free": []}
	var sampler_state := RDSamplerState.new()
	sampler_state.min_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	sampler_state.mag_filter = RenderingDevice.SAMPLER_FILTER_LINEAR
	sampler_state.repeat_u = RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	sampler_state.repeat_v = RenderingDevice.SAMPLER_REPEAT_MODE_CLAMP_TO_EDGE
	g.sampler = _rd.sampler_create(sampler_state)
	g.audio = _tex(Vector2i(AUDIO_W, 2), RenderingDevice.DATA_FORMAT_R8_UNORM, RenderingDevice.TEXTURE_USAGE_CAN_UPDATE_BIT, PackedByteArray())
	var black := PackedByteArray()
	black.resize(4)
	g.black = _tex(Vector2i.ONE, RenderingDevice.DATA_FORMAT_R8G8B8A8_UNORM, 0, black)
	var target := RenderingDevice.TEXTURE_USAGE_COLOR_ATTACHMENT_BIT | RenderingDevice.TEXTURE_USAGE_CAN_COPY_TO_BIT
	for p in spirv:
		if p.letter != "":
			g.bufs[p.letter] = [_tex(size, RenderingDevice.DATA_FORMAT_R32G32B32A32_SFLOAT, target, PackedByteArray()),
				_tex(size, RenderingDevice.DATA_FORMAT_R32G32B32A32_SFLOAT, target, PackedByteArray())]
	g.image = _tex(size, RenderingDevice.DATA_FORMAT_R16G16B16A16_SFLOAT, target, PackedByteArray())
	var drawn := {}
	for p in spirv:
		var shader := _rd.shader_create_from_spirv(p.spirv, "shadertoy " + p.name)
		var outs: Array = g.bufs[p.letter] if p.letter != "" else [g.image, g.image]
		var fb := [_rd.framebuffer_create([outs[0]]), _rd.framebuffer_create([outs[1]])]
		var blend := RDPipelineColorBlendState.new()
		blend.attachments = [RDPipelineColorBlendStateAttachment.new()]
		var pipeline := _rd.render_pipeline_create(shader, _rd.framebuffer_get_format(fb[0]), RenderingDevice.INVALID_FORMAT_ID,
			RenderingDevice.RENDER_PRIMITIVE_TRIANGLES, RDPipelineRasterizationState.new(), RDPipelineMultisampleState.new(),
			RDPipelineDepthStencilState.new(), blend)
		var ubo := _rd.uniform_buffer_create(G.UBO_SIZE)
		var res := []
		var sets := []
		for par in 2:
			var us := [_uniform(RenderingDevice.UNIFORM_TYPE_UNIFORM_BUFFER, 0, [ubo])]
			for i in 4:
				var ch: String = p.channels[i]
				var tex: RID = g.black
				if ch == "audio":
					tex = g.audio
				elif g.bufs.has(ch):
					tex = g.bufs[ch][par if drawn.has(ch) else 1 - par]  # drawn this frame → its new half
				us.append(_uniform(RenderingDevice.UNIFORM_TYPE_SAMPLER_WITH_TEXTURE, i + 1, [g.sampler, tex]))
				if par == 0:
					res.append(Vector2(AUDIO_W, 2) if ch == "audio" else Vector2(size) if g.bufs.has(ch) else Vector2.ONE)
			sets.append(_rd.uniform_set_create(us, shader, 0))
		if p.letter != "":
			drawn[p.letter] = true
		g.passes.append({"shader": shader, "pipeline": pipeline, "ubo": ubo, "fb": fb, "sets": sets, "res": res})
	return g


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
	for t in [g.image, g.audio, g.black] + g.bufs.values().reduce(func(a: Array, b: Array) -> Array: return a + b, []):
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


## The std140 ShaderToy block (shadertoy_glsl.gd HEADER): 48 floats, iFrame an int at float 14.
func _ubo_bytes(size: Vector2i, time: float, delta: float, res: Array) -> PackedByteArray:
	var f := PackedFloat32Array()
	f.resize(48)
	f[0] = size.x
	f[1] = size.y
	f[2] = 1.0
	f[3] = time
	var d := Time.get_datetime_dict_from_system()
	f[8] = d.year
	f[9] = d.month - 1  # JS getMonth(), as Shadertoy
	f[10] = d.day
	f[11] = d.hour * 3600 + d.minute * 60 + d.second
	f[12] = delta
	f[13] = 1.0 / delta if delta > 0.0 else 60.0
	f[15] = 48000.0
	for i in 4:
		var r: Vector2 = res[i]
		f[16 + i * 4] = r.x
		f[17 + i * 4] = r.y
		f[18 + i * 4] = 1.0
		f[32 + i * 4] = time
	var b := f.to_byte_array()
	b.encode_s32(14 * 4, _frame)
	return b
