extends HSplitContainer
## WO-607 — Previs tab: stage view + side panel (stage objects, models from /api/previs/models, live source,
## screen meshes, camera presets). WO-617: view modes 2D front (default) · 2D plan · 3D; the 3D SubViewport
## renders only in 3D mode, and video surfaces are held only by what is visible (VideoSurfaces refcount).
## WO-616: a 4th mode, Camera — a tracking camera's picture with the stage drawn through its solved camera; its
## settings and calibration live on an Inspector page (WO-608 R2). T5b: its Markers mode drives the operator's
## markers (marker_driver → server hub) and draws them on the picture. T12: the 3D stage through the solved camera
## as an optional ghost overlay (camera_overlay.gd). T10c: 3D mode's "Tracking cameras" toggle shows each tracking
## camera's frustum + footprint and the grid's coverage (coverage_3d.gd), with a one-line verdict under the view.

const PrevisStage := preload("res://features/previs/previs_stage.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const StageBuilder := preload("res://features/previs/stage_builder.gd")
const StagePanel := preload("res://features/previs/stage_panel.gd")
const Stage2D := preload("res://features/previs/stage_2d_view.gd")
const TrackingView := preload("res://features/previs/tracking/tracking_view.gd")
const TrackingPage := preload("res://features/previs/tracking/tracking_page.gd")
const MarkerDriver := preload("res://features/previs/tracking/marker_driver.gd")
const FollowModel := preload("res://features/previs/tracking/follow_model.gd")
const ZoneModel := preload("res://features/previs/tracking/zone_model.gd")
const DetectModel := preload("res://features/previs/tracking/detect_model.gd")
const CameraOverlay := preload("res://features/previs/tracking/camera_overlay.gd")
const Coverage3D := preload("res://features/previs/tracking/coverage_3d.gd")
const TrackingModel := preload("res://features/previs/tracking/tracking_model.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const UI_CFG := "user://ui.cfg"
const MODES := ["front", "plan", "3d", "camera"]

var stage: PrevisStage
var builder: StageBuilder
var stage_panel: StagePanel
var _models: ItemList
var _meshes: VBoxContainer
var _source: OptionButton
var _status: Label
var _model_ids: Array = []
var view2d: Stage2D
var mode := "front"
var _sv: SubViewport
var _svc: SubViewportContainer
var _pictures: CheckBox
var _mode_btns := {}
var _glb_role := ""
var track_view: TrackingView
var track_page: TrackingPage
var markers: MarkerDriver
var coverage: Coverage3D
var _coverage_cb: CheckBox
var _coverage_note: Label


func _ready() -> void:
	split_offset = -320
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(left)
	left.add_child(_build_toolbar())
	var stack := Control.new()
	stack.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(stack)
	_svc = SubViewportContainer.new()
	_svc.stretch = true
	_svc.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.add_child(_svc)
	_sv = SubViewport.new()
	_sv.own_world_3d = true
	_sv.handle_input_locally = false
	_svc.add_child(_sv)
	stage = PrevisStage.new()
	_sv.add_child(stage)
	builder = StageBuilder.new()
	builder.live = false
	stage.add_child(builder)
	coverage = Coverage3D.new()
	stage.add_child(coverage)
	_svc.gui_input.connect(_on_3d_input)
	_coverage_note = Label.new()
	_coverage_note.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_WIDE)
	_coverage_note.offset_left = 10
	_coverage_note.offset_top = -30
	_coverage_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_coverage_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	stack.add_child(_coverage_note)
	view2d = Stage2D.new()
	view2d.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.add_child(view2d)
	track_view = TrackingView.new()
	track_view.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.add_child(track_view)
	var ghost := CameraOverlay.new()
	ghost.attach(_sv.find_world_3d(), stage.environment, PrevisStage.FLOOR_LAYER)
	track_view.add_child(ghost)
	track_view.ghost = ghost
	track_page = TrackingPage.new()
	markers = MarkerDriver.new()
	markers.key_focus = track_view
	add_child(markers)
	track_page.driver = markers
	track_page.changed.connect(_on_tracking_changed)
	track_page.ghost_changed.connect(func(on: bool, op: float) -> void:
		track_view.set_ghost(on, op)
		_apply_mode()
		_save_ui())
	markers.updated.connect(func() -> void:
		track_view.set_marks(markers.marks(), markers.selected)
		track_view.set_beams(_beams())
		if track_page.markers != null:
			track_page.markers.refresh()
		if track_page.follow != null:
			track_page.follow.refresh()
		if track_page.zones != null:
			track_page.zones.refresh()
		_push_zones())
	markers.detected.connect(func() -> void:
		track_view.set_detections(markers.detections)
		if track_page.detect != null:
			track_page.detect.refresh_status())
	track_view.grab.connect(func(px: Vector2) -> void: markers.grab_at(px))
	track_view.drag.connect(markers.drag_to)
	track_view.let_go.connect(markers.release)
	track_view.clicked.connect(track_page.click)
	track_view.picked.connect(track_page.pick)
	track_view.source_size.connect(track_page.adopt_size)
	add_child(_build_panel())
	stage.model_loaded.connect(_on_model_loaded)
	var framed := [false]
	stage_panel.stage_loaded.connect(func(n: int) -> void:
		if n > 0 and not framed[0]:
			framed[0] = true
			stage.frame_box.call_deferred(builder.bounds())
			view2d.fit.call_deferred())
	stage_panel.stage_changed.connect(func() -> void:
		view2d.set_objects(builder.objects.duplicate(true))
		track_page.set_objects(builder.objects.duplicate(true)))
	stage_panel.selection_changed.connect(func(id: String) -> void:
		view2d.select(id)
		builder.set_selected(id))
	view2d.rotated.connect(func(id: String, yaw: float) -> void:
		stage_panel.select(id)
		stage_panel.turn(yaw, true))
	view2d.selected.connect(func(id: String) -> void: stage_panel.select(id))
	view2d.moved.connect(func(id: String, pos: Array) -> void: stage_panel.move_object(id, pos))
	stage_panel.bind(builder)
	if Config.args.has("probe-stage-add"):  # dev: --probe-stage-add=<menu id> (0 LED, 1 TV, 2 projection)
		get_tree().create_timer(3.0).timeout.connect(func() -> void: stage_panel._on_add(int(Config.args["probe-stage-add"])))
	_glb_role = str(Config.args.get("previs-source", "opgui"))
	stage.set_live_texture(VideoSurfaces.texture(_glb_role))
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	_pictures.button_pressed = cfg.get_value("previs", "live_pictures", false) == true
	_coverage_cb.set_pressed_no_signal(cfg.get_value("previs", "coverage", false) == true)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _refresh_coverage())
	track_page.set_ghost(cfg.get_value("previs", "ghost_on", false) == true, float(cfg.get_value("previs", "ghost_opacity", 0.6)))
	track_view.set_ghost(track_page.ghost_on, track_page.ghost_opacity)
	set_mode(str(Config.args.get("previs-mode", cfg.get_value("previs", "mode", "front"))))
	visibility_changed.connect(_apply_mode)
	refresh_models()


func _on_tracking_changed() -> void:
	track_view.set_state(track_page.data, track_page.entry(), track_page.objects, track_page.active)
	if track_page.is_inside_tree():  # before the Inspector adopts it the page holds no project data (driver reads the project)
		markers.entry = track_page.entry()
		markers.set_defs(track_page.data.markers, track_page.data.grid)
	track_view.markers_mode = track_page.mode in ["markers", "follow", "detect"]
	track_view.follow_mode = track_page.mode == "follow"
	track_view.zones_mode = track_page.mode == "zones"
	track_view.detect_mode = track_page.mode == "detect"
	_push_zones()
	_push_masks()
	_apply_drive()
	_refresh_coverage()


## Fit / F: the stage objects, plus the tracking cameras and grid while they are shown (T10c).
func _fit_box() -> AABB:
	var b := builder.bounds()
	if not coverage.visible or coverage.box.size == Vector3.ZERO:
		return b
	return coverage.box if b.size == Vector3.ZERO else b.merge(coverage.box)


## WO-616 T10c: the tracking cameras + coverage on the 3D stage (only built while shown).
func _refresh_coverage() -> void:
	var on := mode == "3d" and _coverage_cb.button_pressed
	coverage.visible = on
	_coverage_note.visible = on
	if on:
		var pv: Variant = Store.project.get("previs")
		coverage.set_tracking(TrackingModel.normalize((pv as Dictionary).get("tracking") if pv is Dictionary else null))
		_coverage_note.text = coverage.summary


## WO-616 T9c: the camera's detection ROI masks (Detect mode).
func _push_masks() -> void:
	var ms = track_page.detect.masks if track_page.detect != null else null
	if ms == null:
		return
	track_view.set_masks(ms.shapes(), DetectModel.masks_active(ms.mk), ms.drawing and track_page.mode == "detect")
	track_view.set_walk_line(track_page.detect.walk.line())


## WO-616 T7: the trigger zones as floor loops + the server's occupancy.
func _push_zones() -> void:
	var zs: Dictionary = ZoneModel.normalize(track_page.data.get("zones"))
	var cur := str(track_page.zones.current().get("id", "")) if track_page.zones != null else ""
	var shapes := []
	for z in zs.list:
		var o: Variant = markers.zones.get(z.id)
		shapes.append({"name": z.name, "color": z.color, "loop": ZoneModel.loop3(z.vertices, markers.floor_z),
			"occupied": o is Dictionary and o.get("occupied") == true, "selected": z.id == cur})
	track_view.set_zones(shapes, track_page.zones != null and track_page.zones.drawing and track_page.mode == "zones")


## WO-616 T11: the follow fixtures' beams from the server's aims (project.fixtures, marker positions).
func _beams() -> Array:
	var targets := {}
	for id in markers.positions:
		var p: Dictionary = markers.positions[id]
		targets[id] = [p.x, p.y, p.z]
	var patch: Array = FollowModel.normalize(Store.project.get("fixtures")).patch
	return FollowModel.beams(patch, markers.follow, targets, markers.floor_z)


func _apply_drive() -> void:
	markers.driving = mode == "camera" and is_visible_in_tree() and track_page.mode in ["markers", "follow", "zones", "detect"]
	if not markers.driving:
		markers.release()


var _press_at := Vector2.INF


## 3D: orbit as before; a click without drag selects the object under the mouse.
func _on_3d_input(e: InputEvent) -> void:
	stage.handle_input(e)
	var mb := e as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		if mb.pressed:
			_press_at = mb.position
		elif mb.position.distance_to(_press_at) < 4.0:
			var id := builder.pick(stage.camera(), mb.position)
			if id != "":
				stage_panel.select(id)


## Keys while the previs is shown (text fields consume their own keys first):
## Delete remove · Ctrl+D duplicate · arrows nudge 5 cm (shift 50 cm; front: X/height, plan/3D: X/Z)
## · Q/E turn 5° (shift 15°) · F fit.
func _unhandled_key_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or not is_visible_in_tree():
		return
	if markers.driving and k.keycode in [KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN]:
		get_viewport().set_input_as_handled()  # the marker driver reads the arrows (held), not the stage nudge
		return
	var step := 0.5 if k.shift_pressed else 0.05
	var handled := true
	match k.keycode:
		KEY_DELETE, KEY_BACKSPACE:
			stage_panel.delete_selected()
		KEY_D when k.ctrl_pressed:
			stage_panel.duplicate_selected()
		KEY_LEFT:
			stage_panel.nudge(Vector3(-step, 0, 0))
		KEY_RIGHT:
			stage_panel.nudge(Vector3(step, 0, 0))
		KEY_UP:
			stage_panel.nudge(Vector3(0, step, 0) if mode == "front" else Vector3(0, 0, -step))
		KEY_DOWN:
			stage_panel.nudge(Vector3(0, -step, 0) if mode == "front" else Vector3(0, 0, step))
		KEY_Q:
			stage_panel.turn(15.0 if k.shift_pressed else 5.0)
		KEY_E:
			stage_panel.turn(-15.0 if k.shift_pressed else -5.0)
		KEY_F:
			view2d.fit()
			track_view.fit()
			stage.frame_box(_fit_box())
		_:
			handled = false
	if handled:
		get_viewport().set_input_as_handled()


## "front" | "plan" (2D, no 3D rendering) | "3d". Remembered per client (UI preference, not show data).
func set_mode(m: String) -> void:
	mode = m if MODES.has(m) else "front"
	for k in _mode_btns:
		(_mode_btns[k] as Button).set_pressed_no_signal(k == mode)
	_apply_mode()
	_save_ui()


func _save_ui() -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("previs", "mode", mode)
	cfg.set_value("previs", "live_pictures", _pictures.button_pressed)
	cfg.set_value("previs", "coverage", _coverage_cb.button_pressed)
	cfg.set_value("previs", "ghost_on", track_page.ghost_on)
	cfg.set_value("previs", "ghost_opacity", track_page.ghost_opacity)
	cfg.save(UI_CFG)


func _apply_mode() -> void:
	if _sv == null:
		return
	var shown := is_visible_in_tree()
	var is3d := mode == "3d"
	_svc.visible = is3d
	_sv.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE if is3d and shown else SubViewport.UPDATE_DISABLED
	builder.set_live((is3d or (mode == "camera" and track_view.ghost_on)) and shown)  # T12: the ghost shows live walls
	if is3d and shown and not stage.screens.is_empty():  # GLB screens only — no model, no hold
		VideoSurfaces.acquire(_glb_role, self)
	else:
		VideoSurfaces.release(_glb_role, self)
	var iscam := mode == "camera"
	view2d.visible = not is3d and not iscam
	if not is3d and not iscam and view2d.view != mode:
		view2d.set_view(mode)
	_pictures.disabled = is3d or iscam
	_coverage_cb.visible = is3d
	_refresh_coverage()
	view2d.set_live_pictures(_pictures.button_pressed and view2d.visible and shown)
	track_view.visible = iscam
	track_view.set_on(iscam and shown)
	_apply_drive()
	if InspectorPanel.current != null:
		if iscam and shown:
			InspectorPanel.current.present(track_page)
			track_page.set_objects(builder.objects.duplicate(true))
		else:
			InspectorPanel.current.release(track_page)


func _exit_tree() -> void:
	if track_page != null and not track_page.is_inside_tree():  # never adopted by the Inspector
		track_page.free()


func _build_toolbar() -> Control:
	var bar := HBoxContainer.new()
	var group := ButtonGroup.new()
	for spec in [["front", "2D front"], ["plan", "2D plan"], ["3d", "3D"], ["camera", "Camera"]]:
		var b := Button.new()
		b.text = spec[1]
		b.toggle_mode = true
		b.button_group = group
		var m: String = spec[0]
		b.pressed.connect(func() -> void: set_mode(m))
		bar.add_child(b)
		_mode_btns[m] = b
	_pictures = CheckBox.new()
	_pictures.text = "Live pictures"
	_pictures.tooltip_text = "2D only. Off = layout only: no video surfaces are read (Caspar and the client do no copying)."
	_pictures.toggled.connect(func(_on: bool) -> void: set_mode(mode))
	bar.add_child(_pictures)
	_coverage_cb = CheckBox.new()
	_coverage_cb.text = "Tracking cameras"
	_coverage_cb.tooltip_text = "Each tracking camera's view on the stage and where a standing person is seen by one camera or by two or more (fused)."
	_coverage_cb.toggled.connect(func(_on: bool) -> void:
		_refresh_coverage()
		_save_ui())
	bar.add_child(_coverage_cb)
	var fit := Button.new()
	fit.text = "Fit"
	fit.pressed.connect(func() -> void:
		view2d.fit()
		stage.frame_box(_fit_box()))
	bar.add_child(fit)
	return bar


func refresh_models() -> void:
	var res: Dictionary = await Api.get_json("/api/previs/models")
	_models.clear()
	_model_ids.clear()
	if not res.ok:
		_status.text = "no GLB model library (server previs module off) — the stage above works without it"
		return
	for m in (res.data as Dictionary).get("models", []):
		_models.add_item(str(m.get("name", m.get("id"))))
		_model_ids.append(str(m.get("id")))
	_status.text = "%d model(s) on the server" % _model_ids.size()
	if not _model_ids.is_empty() and Config.args.has("previs-autoload"):
		load_model(0)


func load_model(idx: int) -> void:
	if idx < 0 or idx >= _model_ids.size():
		return
	_status.text = "loading…"
	var res: Dictionary = await Api.get_bytes("/api/previs/models/%s" % _model_ids[idx])
	if not res.ok:
		_status.text = "download failed: %s" % res.error
		return
	if not stage.load_glb_bytes(res.bytes):
		_status.text = "not a glTF/GLB the runtime can read"
	# on success _on_model_loaded() has already written "N meshes, M screens"


func _set_source(role: String) -> void:
	VideoSurfaces.release(_glb_role, self)
	_glb_role = role
	stage.set_live_texture(VideoSurfaces.texture(role))
	_apply_mode()


func _on_model_loaded(meshes: Array) -> void:
	_apply_mode.call_deferred()  # (re)hold the GLB source now that screen meshes exist
	for c in _meshes.get_children():
		c.queue_free()
	for mi in meshes:
		var cb := CheckBox.new()
		cb.text = str((mi as MeshInstance3D).name)
		cb.button_pressed = stage.screens.has(mi)
		cb.toggled.connect(func(on: bool) -> void: stage.set_screen(mi, on))
		_meshes.add_child(cb)
	_status.text = "%d meshes, %d screens" % [meshes.size(), stage.screens.size()]


func _build_panel() -> Control:
	var panel := PanelContainer.new()
	panel.custom_minimum_size.x = ThemeBuilder.PANEL_W + 40
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	panel.add_child(v)
	v.add_child(_heading("Stage (WO-614)"))
	stage_panel = StagePanel.new()
	v.add_child(stage_panel)
	v.add_child(_heading("Models"))
	_models = ItemList.new()
	_models.custom_minimum_size.y = 120
	_models.item_activated.connect(load_model)
	_models.item_selected.connect(load_model)
	v.add_child(_models)
	v.add_child(_heading("Live source"))
	_source = OptionButton.new()
	for role in ["opgui", "pgm1", "prv1", "pgm2", "prv2"]:
		_source.add_item(role)
	_source.item_selected.connect(func(i: int) -> void: _set_source(_source.get_item_text(i)))
	v.add_child(_source)
	v.add_child(_heading("Camera"))
	var cams := HBoxContainer.new()
	for p in ["Front", "Top", "ISO"]:
		var b := Button.new()
		b.text = p
		b.pressed.connect(func() -> void: stage.fly_to_preset(p))
		cams.add_child(b)
	v.add_child(cams)
	v.add_child(_heading("Screens (live texture)"))
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_meshes = VBoxContainer.new()
	scroll.add_child(_meshes)
	v.add_child(scroll)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	v.add_child(_status)
	return panel


func _heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l
