extends VSplitContainer
## WO-863 — the Visuals tab (owner 30.10): the canvas (the visual's output, at the chosen screen's aspect) centred at the top,
## under it the work area — 3D (an orbit camera into the same world) or Flow (the audio → parameter graph). The Inspector page
## holds the base parameters and Output; Send publishes the canvas into shm ring `visuals` (WO-743) and plays it on the screen's
## PGM channel (`PLAY ch-layer SHM NAME visuals`, WO-742). Audio: the WO-861 parts in every `audio_fft` WS frame.

const M := preload("res://features/visuals/visuals_model.gd")
const Scene := preload("res://features/visuals/visuals_scene.gd")
const Flow := preload("res://features/visuals/visuals_flow.gd")
const Page := preload("res://features/visuals/visuals_page.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const AUDIO_STALE_MS := 1000

var slice := {}
var out_vp: SubViewport
var scene: Scene
var flow: Flow
var page: Page
var publisher: Publisher
var sending := {}  # {channel, layer} while on air
var _buses := {}
var _audio_at := -AUDIO_STALE_MS
var _env := {}
var _trace := {}
var _canvas: TextureRect
var _orbit_cam: Camera3D
var _orbit := Vector3(0.0, 0.25, 16.0)  # yaw, pitch, distance
var _view3d: SubViewportContainer
var _mode := "flow"


func _ready() -> void:
	var world := World3D.new()
	out_vp = SubViewport.new()
	out_vp.world_3d = world
	out_vp.size = M.RENDER_SIZES[0]
	add_child(out_vp)
	scene = Scene.new()
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
	publisher = Publisher.new()
	add_child(publisher)
	if _g("Ws"):
		_g("Ws").on("audio_fft", func(d: Variant) -> void:
			_buses = M.buses_of(d)
			_audio_at = Time.get_ticks_msec())
	if _g("Store"):
		_g("Store").project_changed.connect(func(_p: Dictionary) -> void: _load())
		_g("Store").changed.connect(func(path: String, _v: Variant) -> void:
			if path == "*" or path == "channelMap":
				_load())
	visibility_changed.connect(_on_shown)
	_load()
	_set_mode(_mode)
	_on_shown()
	if _g("Config") and _g("Config").args.has("probe-visuals-send"):  # dev: --probe-visuals-send=<screen index>:<seconds>
		_probe_send.call_deferred(str(_g("Config").args["probe-visuals-send"]))


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
	page.set_state(slice, _cm())
	_resize()
	_sync_send_ui("")


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
	scene.params = M.evaluate(slice.graph, _buses if live else M.buses_of(null), slice.params, _env, delta, _trace)
	if _mode == "flow" and is_visible_in_tree():
		flow.show_levels(_trace)
	if _mode == "3d":
		var b := Basis.from_euler(Vector3(-_orbit.y, _orbit.x, 0.0))
		_orbit_cam.transform = Transform3D(b, b * Vector3(0, 0, _orbit.z))


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
