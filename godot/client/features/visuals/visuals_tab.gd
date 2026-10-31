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
const Launcher := preload("res://features/visuals/game_launcher.gd")
const Mixer := preload("res://features/visuals/visuals_mixer.gd")
const Probes := preload("res://features/visuals/visuals_probes.gd")
const ShowCtl := preload("res://features/visuals/visuals_show_ctl.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const AUDIO_STALE_MS := 1000

var slice := {}
var out_vp: SubViewport  # the canvas: the mixer's two decks mixed (WO-877)
var mixer: Mixer
var scene: Stage:  # the live deck's stage
	get:
		return mixer.stage()
var flow: Flow
var page: Page
var publisher: Publisher
var ring_name := M.RING  # dev: --visuals-ring=<name>, so a probe client never writes the operator's ring
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
var _shader_seq := 0
var launcher := Launcher.new()  # WO-876: the Game scene's window
var _game_error := ""
var _shader_cache := {}  # WO-877: id → config, so a look's shader is ready before its fade starts
var show_ctl: ShowCtl  # WO-877/878: looks, autopilot, master, show keys


func _ready() -> void:
	mixer = Mixer.new()
	add_child(mixer)
	out_vp = mixer.out_vp
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
	vp3.world_3d = scene.get_parent().world_3d
	mixer.switched.connect(func(s: Node3D) -> void: vp3.world_3d = s.get_parent().world_3d)  # the orbit follows the live deck
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
	page.ring_toggled.connect(func(on: bool) -> void:
		slice.output.ring = on
		_store()
		_sync_send_ui(_sync_ring()))
	page.scenes_changed.connect(func(main: String, overlay: String) -> void:
		slice.scene = main
		slice.overlay = overlay if overlay != main else ""
		_go(false)
		_store())
	page.shader_changed.connect(func(id: String) -> void:
		slice.shader = id
		_go(true)  # WO-877: another shader crossfades in too
		_store())
	page.burst_pressed.connect(func() -> void: scene.fire())
	show_ctl = ShowCtl.new(self)
	add_child(show_ctl)
	page.game_changed.connect(func(path: String) -> void:
		slice.game = path
		_store()
		if launcher.running():
			_play_game(true))
	page.game_play.connect(_play_game)
	var tick := Timer.new()  # WO-876: the game window's state (closed by hand, starting, on the ring)
	tick.wait_time = 1.0
	tick.timeout.connect(_game_status)
	tick.timeout.connect(func() -> void: show_ctl.status())
	add_child(tick)
	tick.start()
	page.sync_changed.connect(func(ms: float) -> void:
		slice.sync = ms
		_store())
	page.sensitivity_changed.connect(_post_sensitivity)
	publisher = Publisher.new()
	add_child(publisher)
	if _g("Config") and _g("Config").args.has("visuals-ring"):
		ring_name = str(_g("Config").args["visuals-ring"])
	if _g("Ws"):
		_g("Ws").on("audio_fft", func(d: Variant) -> void:
			_buses = M.buses_of(d)
			mixer.audio_frame(d)
			_audio_at = Time.get_ticks_msec()
			show_ctl.audio(d)
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
	if _g("Config"):  # not under the test runner (it shares user://)
		_resume_send.call_deferred()
	if _g("Config") and _g("Config").args.has("probe-visuals-send"):  # dev: --probe-visuals-send=<screen index>:<seconds>
		(func() -> void: Probes.send(self, str(_g("Config").args["probe-visuals-send"]))).call_deferred()
	if _g("Config") and _g("Config").args.has("probe-visuals-onair"):  # dev: --probe-visuals-onair=<dir> (+ -channel)
		(func() -> void: Probes.onair(self, str(_g("Config").args["probe-visuals-onair"]))).call_deferred()
	if _g("Config") and _g("Config").args.has("probe-visuals-auto"):  # dev: --probe-visuals-auto=<seconds> (WO-878)
		(func() -> void: Probes.autopilot(self, float(_g("Config").args["probe-visuals-auto"]))).call_deferred()
	if _g("Config") and _g("Config").args.has("probe-visuals-shots"):  # dev: --probe-visuals-shots=<dir> (WO-873)
		(func() -> void: Probes.shots(self, str(_g("Config").args["probe-visuals-shots"]))).call_deferred()
	if _g("Config") and _g("Config").args.has("probe-visuals-ring"):  # dev: --probe-visuals-ring=<s>[:scene[:size[:shader]]] (WO-883)
		(func() -> void: Probes.ring(self, str(_g("Config").args["probe-visuals-ring"]))).call_deferred()
	if _g("Config") and _g("Config").args.has("probe-visuals-shaders"):  # dev: --probe-visuals-shaders=<dir> (WO-874)
		(func() -> void: Probes.shaders(self, str(_g("Config").args["probe-visuals-shaders"]))).call_deferred()


func _exit_tree() -> void:
	launcher.stop()
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
	page.set_games(Launcher.games())
	flow.set_graph(slice.graph)
	show_ctl.from_slice()
	_go(false)
	page.set_state(slice, _cm())
	_resize()
	_sync_send_ui(_sync_ring())


## WO-876: open (or close) the picked game's window on the screen this client is on.
func _play_game(on: bool) -> void:
	_game_error = launcher.play(slice.game, get_window().current_screen) if on else ""
	if not on:
		launcher.stop()
	_game_status()


func _game_status() -> void:
	if not "game" in [slice.get("scene"), slice.get("overlay")] and not launcher.running():
		return
	var live := scene.layers.any(func(l: Node3D) -> bool: return l.has_method("live") and l.live())
	var text := _game_error if _game_error != "" else Launcher.ready_error(str(slice.get("game", "")))
	if launcher.running():
		text = ("Playing in its own window — arrows, X = A, Z = B, Enter = Start, Shift = Select; a gamepad works too"
			if live else "Starting the game window…")
	elif text == "":
		text = "Play opens the game in its own window on this screen"
	page.set_game_status(launcher.running(), text)


## WO-877: the slice's scenes on stage — a change crossfades over `fade` (visuals_mixer.gd); a shader is fetched first, so a
## look with one never fades in dark. `force`: fade even when the scenes match (a look with another shader or parameters).
func _go(force := false) -> void:
	_shader_seq += 1
	var seq := _shader_seq
	var uses := "shader" in [slice.scene, slice.overlay]
	var cfg: Variant = null
	if uses and str(slice.shader) != "":
		cfg = await _shader_config(str(slice.shader))
		if seq != _shader_seq:
			return  # a newer pick is on its way
	mixer.go(slice.scene, slice.overlay, cfg, slice.fade, force)
	if uses:
		_shader_status()


## WO-874: a library shader's config (GET /api/shaders/:id), cached; null without the box.
func _shader_config(id: String) -> Variant:
	if _shader_cache.has(id):
		return _shader_cache[id]
	var api: Variant = _g("DevicesTarget").box_api if _g("DevicesTarget") else null
	if api == null:
		return null
	var r: Dictionary = await api.get_json("/api/shaders/" + id.uri_encode())
	if not r.get("ok") or not r.get("data") is Dictionary:
		return {"id": id}
	_shader_cache[id] = r.data
	return r.data


## WO-874: the picker's list (fetched once) and why the Shader scene is dark, if it is.
func _shader_status() -> void:
	var api: Variant = _g("DevicesTarget").box_api if _g("DevicesTarget") else null
	if api == null:
		page.set_shader_status("No box connection: the shader library lives on the box.")
		return
	if _shader_list.is_empty():
		var l: Dictionary = await api.get_json("/api/shaders")
		if l.get("ok") and l.get("data") is Dictionary and l.data.get("shaders") is Array:
			_shader_list = l.data.shaders
			page.set_shaders(_shader_list)
	if str(slice.shader) == "":
		page.set_shader_status("Pick a shader.")
	else:
		page.set_shader_status("" if scene.shader_error == "" else "Shader: " + scene.shader_error)


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
	mixer.resize(M.render_size(int(slice.output.size), float(r.get("w", 0)), float(r.get("h", 0))))


func _process(delta: float) -> void:
	var live := Time.get_ticks_msec() - _audio_at < AUDIO_STALE_MS
	_trace.clear()
	var buses: Dictionary = Sync.apply(_sync_state, _buses, slice.sync, Time.get_ticks_msec()) if live else M.buses_of(null)
	scene.params = M.evaluate(slice.graph, buses, slice.params, _env, delta, _trace)
	mixer.step(delta)
	show_ctl.step(delta)
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


## Shown or publishing (on air or a Live source) → render every frame; otherwise the canvas sleeps.
func _on_shown() -> void:
	var shown := is_visible_in_tree() or publisher.sink != null
	mixer.set_running(shown)
	set_process(shown)
	if InspectorPanel.current == null:
		return
	if shown:
		InspectorPanel.current.present(page)
	else:
		InspectorPanel.current.release(page)


## "" when this client can write the ring (on the box, with libhshm_sink), else why not.
func can_publish() -> String:
	if _g("DevicesTarget") == null or not _g("DevicesTarget").on_box():
		return "Send works on the box itself (the ring is local shared memory)."
	if not Publisher.available():
		return "libhshm_sink is not loaded (godot/extensions/hshm/build.sh)."
	return ""


func can_send() -> String:
	var why := can_publish()
	if why == "" and page.screen_channel() <= 0:
		return "No screen destination."
	return why


## The output screen's channel rate (programResolutions), the ring's fps.
func _fps() -> int:
	var cm: Variant = _cm()
	var res: Array = cm.get("programResolutions", []) if cm is Dictionary and cm.get("programResolutions") is Array else []
	var i := int(slice.output.screen)
	return int(res[i].get("fps", 50)) if i < res.size() and res[i] is Dictionary else 50


## WO-883: the ring runs while the canvas is a Live source (output.ring) or on air; returns "" or why it could not start.
func _sync_ring() -> String:
	var want: bool = slice.output.get("ring") == true or not sending.is_empty()
	var why := ""
	if want and publisher.sink == null:
		why = can_publish()
		if why == "":
			why = publisher.start(out_vp, ring_name, _fps())
	elif not want and publisher.sink != null:
		publisher.stop()
	_on_shown()
	return why if slice.output.get("ring") == true else ""


func send(on: bool) -> void:
	if on and sending.is_empty():
		var why := can_send()
		if why == "" and publisher.sink == null:
			why = publisher.start(out_vp, ring_name, _fps())
		if why == "":
			var ch := page.screen_channel()
			var r: Dictionary = await _g("DevicesTarget").box_api.post_json("/api/play", M.play_body(ch, int(slice.output.layer), ring_name))
			if r.ok:
				sending = {"channel": ch, "layer": int(slice.output.layer)}
				_on_air_mark(sending)
			else:
				why = "PLAY failed: %s" % str(r.get("error", r.get("status", "")))
		_sync_ring()  # a failed Send leaves the ring only when it is a Live source
		_sync_send_ui(why)
	elif not on and not sending.is_empty():
		await _g("DevicesTarget").box_api.post_json("/api/stop", M.stop_body(sending.channel, sending.layer))
		sending = {}
		_on_air_mark({})
		_sync_ring()
		_sync_send_ui("")
	_on_shown()


## WO-880: "on air" survives the client. Send writes on_air_path, Send off removes it; a client started while it exists (a
## crash relaunch by run-client.sh, or a restart) sends again once the box answers — Caspar's shm producer holds the last
## frame meanwhile and takes the new ring on its own. Only Send off ends it.
var on_air_path := "user://visuals_on_air.json"  # a test points it elsewhere


func _on_air_mark(on: Dictionary) -> void:
	if on.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(on_air_path))
		return
	var f := FileAccess.open(on_air_path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify(on))


func _resume_send() -> void:
	if not FileAccess.file_exists(on_air_path):
		return
	for i in 60:  # the server may still be starting: up to ~2 min
		if not is_inside_tree() or not sending.is_empty():
			return
		if can_send() == "" and _g("Store") and not (_project() as Dictionary).is_empty():
			print("[visuals] on air before this client started — sending again")
			await send(true)
			if not sending.is_empty():
				return
		await get_tree().create_timer(2.0).timeout


func _sync_send_ui(why: String) -> void:
	var on := not sending.is_empty()
	var note := why
	if note == "" and on:
		note = "On air: ring %s → ch %d layer %d at %dx%d." % [ring_name, sending.channel, sending.layer, out_vp.size.x, out_vp.size.y]
	elif note == "" and publisher.sink != null:
		note = "Live source shm://%s at %dx%d — drag it from Sources ▸ Live onto a look." % [ring_name, out_vp.size.x, out_vp.size.y]
	elif note == "":
		note = can_send()
	page.set_sending(on, can_send() == "", note, publisher.sink != null, can_publish() == "")
