extends VSplitContainer
## WO-863 — the Visuals tab (owner 30.10): the canvas (the visual's output, at the chosen screen's aspect) centred at the top,
## under it the work area — 3D (an orbit camera into the same world) or Flow (the audio → parameter graph). The Inspector page
## holds the base parameters and Output; Send publishes the canvas into shm ring `visuals` (WO-743) and plays it on the screen's
## PGM channel (`PLAY ch-layer SHM NAME visuals`, WO-742). Audio: the WO-861 parts in every `audio_fft` WS frame, moved by
## Sync (WO-866, visuals_sync.gd); the page's sensitivity sliders set the box's detectors.

const M := preload("res://features/visuals/visuals_model.gd")
const Stage := preload("res://features/visuals/visuals_stage.gd")
const Flow := preload("res://features/visuals/visuals_flow.gd")
const Page := preload("res://features/visuals/visuals_page.gd")
const Sync := preload("res://features/visuals/visuals_sync.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const AUDIO_STALE_MS := 1000

var slice := {}
var out_vp: SubViewport
var scene: Stage
var flow: Flow
var page: Page
var publisher: Publisher
var sending := {}  # {channel, layer} while on air
var _buses := {}
var _audio_at := -AUDIO_STALE_MS
var _env := {}
var _sync_state := Sync.new_state()
var _sens_post: SceneTreeTimer
var _sens_want := {}
var _trace := {}
var _canvas: TextureRect
var _orbit_cam: Camera3D
var _orbit := Vector3(0.0, 0.25, 16.0)  # yaw, pitch, distance
var _view3d: SubViewportContainer
var _mode := "flow"
var _shader_list := []  # WO-874: GET /api/shaders rows, fetched once the Shader scene is first used
var _shader_cfg := {}  # the config on stage
var _shader_seq := 0


func _ready() -> void:
	var world := World3D.new()
	out_vp = SubViewport.new()
	out_vp.world_3d = world
	out_vp.size = M.RENDER_SIZES[0]
	add_child(out_vp)
	scene = Stage.new()
	out_vp.add_child(scene)
	_canvas = TextureRect.new()
	_canvas.texture = out_vp.get_texture()
	_canvas.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_canvas.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_canvas.custom_minimum_size.y = 240
	_canvas.tooltip_text = "The visual's output — Send (Inspector) puts it on the screen"
	add_child(_canvas)
	var work := VBoxContainer.new()
	add_child(work)
	var bar := HBoxContainer.new()
	work.add_child(bar)
	var group := ButtonGroup.new()
	for m in [["3d", "3D"], ["flow", "Flow"]]:
		var b := Button.new()
		b.text = m[1]
		b.toggle_mode = true
		b.button_group = group
		b.button_pressed = m[0] == _mode
		b.pressed.connect(func() -> void: _set_mode(m[0]))
		bar.add_child(b)
	var hint := Label.new()
	hint.text = "Flow: right-click adds a node · drag an output dot to an input · Delete removes"
	hint.modulate = Color(1, 1, 1, 0.6)
	bar.add_child(hint)
	_view3d = SubViewportContainer.new()
	_view3d.stretch = true
	_view3d.size_flags_vertical = Control.SIZE_EXPAND_FILL
	var vp3 := SubViewport.new()
	vp3.world_3d = world
	_orbit_cam = Camera3D.new()
	vp3.add_child(_orbit_cam)
	_view3d.add_child(vp3)
	_view3d.gui_input.connect(_orbit_input)
	work.add_child(_view3d)
	flow = Flow.new()
	flow.size_flags_vertical = Control.SIZE_EXPAND_FILL
	flow.changed.connect(func(g: Dictionary) -> void:
		slice.graph = M.normalize_graph(g)
		_store())
	work.add_child(flow)
	page = Page.new()
	page.params_changed.connect(func(p: Dictionary) -> void:
		slice.params = M.params_of(p)
		_store())
	page.output_changed.connect(func(o: Dictionary) -> void:
		slice.output = o
		_resize()
		_store())
	page.send_toggled.connect(func(on: bool) -> void: send(on))
	page.scenes_changed.connect(func(main: String, overlay: String) -> void:
		slice.scene = main
		slice.overlay = overlay if overlay != main else ""
		scene.set_layers(slice.scene, slice.overlay)
		_fetch_shader()
		_store())
	page.shader_changed.connect(func(id: String) -> void:
		slice.shader = id
		_fetch_shader()
		_store())
	page.burst_pressed.connect(func() -> void: scene.fire())
	page.sync_changed.connect(func(ms: float) -> void:
		slice.sync = ms
		_store())
	page.sensitivity_changed.connect(_post_sensitivity)
	publisher = Publisher.new()
	add_child(publisher)
	if _g("Ws"):
		_g("Ws").on("audio_fft", func(d: Variant) -> void:
			_buses = M.buses_of(d)
			scene.audio_frame(d)
			_audio_at = Time.get_ticks_msec()
			Sync.observe(_sync_state, d, _buses, _audio_at))
	if _g("Store"):
		_g("Store").project_changed.connect(func(_p: Dictionary) -> void: _load())
		_g("Store").changed.connect(func(path: String, _v: Variant) -> void:
			if path == "*" or path == "channelMap":
				_load())
	visibility_changed.connect(_on_shown)
	_load()
	_get_sensitivity.call_deferred()
	_set_mode(_mode)
	_on_shown()
	if _g("Config") and _g("Config").args.has("probe-visuals-send"):  # dev: --probe-visuals-send=<screen index>:<seconds>
		_probe_send.call_deferred(str(_g("Config").args["probe-visuals-send"]))
	if _g("Config") and _g("Config").args.has("probe-visuals-shots"):  # dev: --probe-visuals-shots=<dir> (WO-873)
		_probe_shots.call_deferred(str(_g("Config").args["probe-visuals-shots"]))
	if _g("Config") and _g("Config").args.has("probe-visuals-shaders"):  # dev: --probe-visuals-shaders=<dir> (WO-874)
		_probe_shaders.call_deferred(str(_g("Config").args["probe-visuals-shaders"]))


func _exit_tree() -> void:
	if page != null and not page.is_inside_tree():  # never adopted by the Inspector
		page.free()


## Autoloads by name: the headless test runner has none (the tab still builds there).
func _g(name: String) -> Node:
	return get_tree().root.get_node_or_null(name) if is_inside_tree() else null


func _project() -> Variant:
	return _g("Store").project if _g("Store") else {}


func _cm() -> Variant:
	return _g("Store").get_value("channelMap", {}) if _g("Store") else {}


func _load() -> void:
	slice = M.slice_of(_project())
	flow.set_graph(slice.graph)
	scene.set_layers(slice.scene, slice.overlay)
	page.set_state(slice, _cm())
	_fetch_shader()
	_resize()
	_sync_send_ui("")


## WO-874: the Shader scene's code from the box's library (list once, then the picked config); the page shows why it is dark.
func _fetch_shader() -> void:
	if not "shader" in [slice.scene, slice.overlay]:
		return
	_shader_seq += 1
	var seq := _shader_seq
	var api: Variant = _g("DevicesTarget").box_api if _g("DevicesTarget") else null
	if api == null:
		page.set_shader_status("No box connection: the shader library lives on the box.")
		return
	if _shader_list.is_empty():
		var l: Dictionary = await api.get_json("/api/shaders")
		if l.get("ok") and l.get("data") is Dictionary and l.data.get("shaders") is Array:
			_shader_list = l.data.shaders
			page.set_shaders(_shader_list)
	var id := str(slice.shader)
	if id == "":
		scene.set_shader(null)
		page.set_shader_status("Pick a shader.")
		return
	if _shader_cfg.get("id") != id:
		var r: Dictionary = await api.get_json("/api/shaders/" + id.uri_encode())
		if seq != _shader_seq:
			return  # a newer pick is on its way
		_shader_cfg = r.data if r.get("ok") and r.get("data") is Dictionary else {"id": id}
	var e := scene.set_shader(_shader_cfg)
	page.set_shader_status("" if e == "" else "Shader: " + e)


func _store() -> void:
	var p: Variant = _project()
	if not p is Dictionary or _g("ProjectSync") == null:
		return
	p["visuals"] = slice.duplicate(true)
	_g("ProjectSync").mark_dirty()


## The canvas renders at the chosen height and the screen's aspect (programResolutions).
func _resize() -> void:
	var cm: Variant = _cm()
	var res: Array = cm.get("programResolutions", []) if cm is Dictionary and cm.get("programResolutions") is Array else []
	var i := int(slice.output.screen)
	var r: Dictionary = res[i] if i < res.size() and res[i] is Dictionary else {}
	out_vp.size = M.render_size(int(slice.output.size), float(r.get("w", 0)), float(r.get("h", 0)))


func _process(delta: float) -> void:
	var live := Time.get_ticks_msec() - _audio_at < AUDIO_STALE_MS
	_trace.clear()
	var buses: Dictionary = Sync.apply(_sync_state, _buses, slice.sync, Time.get_ticks_msec()) if live else M.buses_of(null)
	scene.params = M.evaluate(slice.graph, buses, slice.params, _env, delta, _trace)
	if _mode == "flow" and is_visible_in_tree():
		flow.show_levels(_trace)
	if _mode == "3d":
		var b := Basis.from_euler(Vector3(-_orbit.y, _orbit.x, 0.0))
		_orbit_cam.transform = Transform3D(b, b * Vector3(0, 0, _orbit.z))


func _get_sensitivity() -> void:
	var dt := _g("DevicesTarget")
	if dt == null or dt.box_api == null:
		return
	var r: Dictionary = await dt.box_api.get_json("/api/audio/parts-sensitivity")
	if r.get("ok") and r.get("data") is Dictionary and r.data.get("sensitivity") is Dictionary:
		page.set_sensitivity(r.data.sensitivity)


## Slider drags post at most every 250 ms; the last value always goes out.
func _post_sensitivity(map: Dictionary) -> void:
	_sens_want = map
	if _sens_post != null or _g("DevicesTarget") == null:
		return
	_sens_post = get_tree().create_timer(0.25)
	await _sens_post.timeout
	_sens_post = null
	await _g("DevicesTarget").box_api.post_json("/api/audio/parts-sensitivity", _sens_want)


func _set_mode(m: String) -> void:
	_mode = m
	_view3d.visible = m == "3d"
	flow.visible = m == "flow"


func _orbit_input(e: InputEvent) -> void:
	var mm := e as InputEventMouseMotion
	if mm and mm.button_mask & MOUSE_BUTTON_MASK_LEFT:
		_orbit.x -= mm.relative.x * 0.01
		_orbit.y = clampf(_orbit.y + mm.relative.y * 0.01, -1.4, 1.4)
	var mb := e as InputEventMouseButton
	if mb and mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
		_orbit.z = clampf(_orbit.z * (0.9 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else 1.1), 2.0, 80.0)


## Shown or on air → render every frame; otherwise the canvas sleeps (the publisher keeps it on while sending).
func _on_shown() -> void:
	var shown := is_visible_in_tree()
	out_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if shown or not sending.is_empty() else SubViewport.UPDATE_DISABLED
	set_process(shown or not sending.is_empty())
	if InspectorPanel.current == null:
		return
	if shown:
		InspectorPanel.current.present(page)
	else:
		InspectorPanel.current.release(page)


func can_send() -> String:
	if _g("DevicesTarget") == null or not _g("DevicesTarget").on_box():
		return "Send works on the box itself (the ring is local shared memory)."
	if not Publisher.available():
		return "libhshm_sink is not loaded (godot/extensions/hshm/build.sh)."
	if page.screen_channel() <= 0:
		return "No screen destination."
	return ""


func send(on: bool) -> void:
	if on and sending.is_empty():
		var why := can_send()
		if why == "":
			var cm: Variant = _cm()
			var res: Array = cm.get("programResolutions", []) if cm is Dictionary and cm.get("programResolutions") is Array else []
			var i := int(slice.output.screen)
			var fps := int(res[i].get("fps", 50)) if i < res.size() and res[i] is Dictionary else 50
			why = publisher.start(out_vp, M.RING, fps)
		if why == "":
			var ch := page.screen_channel()
			var r: Dictionary = await _g("DevicesTarget").box_api.post_json("/api/play", M.play_body(ch, int(slice.output.layer)))
			if r.ok:
				sending = {"channel": ch, "layer": int(slice.output.layer)}
			else:
				publisher.stop()
				why = "PLAY failed: %s" % str(r.get("error", r.get("status", "")))
		_sync_send_ui(why)
	elif not on and not sending.is_empty():
		await _g("DevicesTarget").box_api.post_json("/api/stop", M.stop_body(sending.channel, sending.layer))
		publisher.stop()
		sending = {}
		_sync_send_ui("")
	_on_shown()


func _sync_send_ui(why: String) -> void:
	var on := not sending.is_empty()
	var note := why
	if note == "" and on:
		note = "On air: ring %s → ch %d layer %d at %dx%d." % [M.RING, sending.channel, sending.layer, out_vp.size.x, out_vp.size.y]
	elif note == "":
		note = can_send()
	page.set_sending(on, can_send() == "", note)


## dev probe (no pointer on the owner's screen): send to a screen for some seconds, print each step, stop.
func _probe_send(arg: String) -> void:
	var p := arg.split(":")
	await get_tree().create_timer(4.0).timeout
	slice.output.screen = int(p[0])
	page.set_state(slice, _cm())
	_resize()
	await send(true)
	print("[probe-visuals] send: ", sending, " · ", page._note.text)
	await get_tree().create_timer(float(p[1]) if p.size() > 1 else 10.0).timeout
	await send(false)
	print("[probe-visuals] stopped: ", sending.is_empty())


## dev probe (WO-873): each scene (and tunnel + particles) with a burst, the canvas saved as <dir>/<scene>.png, then quit.
func _probe_shots(dir: String) -> void:
	await get_tree().create_timer(3.0).timeout
	out_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	set_process(true)
	RenderingServer.viewport_set_measure_render_time(out_vp.get_viewport_rid(), true)
	var r: Dictionary = await _g("DevicesTarget").box_api.get_json("/api/shaders/sh-sa-ribbons")  # WO-874 layer shots
	scene.set_shader(r.data if r.get("ok") else null)
	for pair in [["rings", ""], ["particles", ""], ["starfield", ""], ["tunnel", ""], ["tunnel", "particles"],
			["shader", "particles"], ["tunnel", "shader"], ["spectrum", ""], ["spectrum", "shader"], ["tunnel", "spectrum"]]:
		scene.set_layers(pair[0], pair[1])
		await get_tree().create_timer(1.0).timeout
		var gpu := 0.0
		for i in 30:  # GPU ms of the canvas viewport, mean over 30 frames
			await get_tree().process_frame
			gpu += RenderingServer.viewport_get_measured_render_time_gpu(out_vp.get_viewport_rid()) / 30.0
		if pair[0] != "spectrum":  # WO-875: the spectrum shots show the music, not a burst
			scene.fire()
		await get_tree().create_timer(0.25).timeout
		var shot: String = str(pair[0]) + ("+" + str(pair[1]) if pair[1] != "" else "")
		var err := out_vp.get_texture().get_image().save_png("%s/%s.png" % [dir, shot])
		print("[probe-visuals] shot %s → %s · canvas %dx%d GPU %.2f ms" % [shot, error_string(err), out_vp.size.x, out_vp.size.y, gpu])
	get_tree().quit()


## dev probe (WO-874): every library shader as the main scene for 1 s — compile result, canvas GPU ms (mean of 20 frames),
## mean brightness — and a 320-wide shot <dir>/<id>.png; then quit.
func _probe_shaders(dir: String) -> void:
	await get_tree().create_timer(3.0).timeout
	out_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	set_process(true)
	RenderingServer.viewport_set_measure_render_time(out_vp.get_viewport_rid(), true)
	slice.scene = "shader"
	slice.overlay = ""
	scene.set_layers("shader", "")
	var api: Variant = _g("DevicesTarget").box_api
	var l: Dictionary = await api.get_json("/api/shaders")
	var list: Array = l.data.shaders if l.get("ok") else []
	print("[probe-shaders] %d shaders, canvas %dx%d" % [list.size(), out_vp.size.x, out_vp.size.y])
	for row in list:
		var r: Dictionary = await api.get_json("/api/shaders/" + str(row.id).uri_encode())
		var e := scene.set_shader(r.data if r.get("ok") else {})
		await get_tree().create_timer(0.8).timeout
		var gpu := 0.0
		for i in 20:
			await get_tree().process_frame
			gpu += RenderingServer.viewport_get_measured_render_time_gpu(out_vp.get_viewport_rid()) / 20.0
		var img := out_vp.get_texture().get_image()
		img.resize(320, maxi(1, 320 * img.get_height() / img.get_width()))
		var lum := 0.0
		for y in range(0, img.get_height(), 4):
			for x in range(0, img.get_width(), 4):
				lum += img.get_pixel(x, y).get_luminance()
		lum /= ceilf(img.get_height() / 4.0) * ceilf(img.get_width() / 4.0)
		img.save_png("%s/%s.png" % [dir, row.id])
		var st := 0.0
		for layer in scene.layers:
			if layer.has_method("set_shader"):
				st = float(layer.get("runner").gpu_ms)
		print("[probe-shaders] %s · %s · canvas GPU %.2f ms · shader GPU %.2f ms · lum %.3f" % [row.id, "OK" if e == "" else e,
			gpu, st, lum])
	get_tree().quit()

