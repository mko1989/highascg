extends HSplitContainer
## WO-607 — Previs tab: stage view + side panel (stage objects, models from /api/previs/models, live source,
## screen meshes, camera presets). WO-617: view modes 2D front (default) · 2D plan · 3D; the 3D SubViewport
## renders only in 3D mode, and video surfaces are held only by what is visible (VideoSurfaces refcount).

const PrevisStage := preload("res://features/previs/previs_stage.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const StageBuilder := preload("res://features/previs/stage_builder.gd")
const StagePanel := preload("res://features/previs/stage_panel.gd")
const Stage2D := preload("res://features/previs/stage_2d_view.gd")
const UI_CFG := "user://ui.cfg"
const MODES := ["front", "plan", "3d"]

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
	_svc.gui_input.connect(func(e: InputEvent) -> void: stage.handle_input(e))
	view2d = Stage2D.new()
	view2d.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	stack.add_child(view2d)
	add_child(_build_panel())
	stage.model_loaded.connect(_on_model_loaded)
	var framed := [false]
	stage_panel.stage_loaded.connect(func(n: int) -> void:
		if n > 0 and not framed[0]:
			framed[0] = true
			stage.frame_box.call_deferred(builder.bounds())
			view2d.fit.call_deferred())
	stage_panel.stage_changed.connect(func() -> void: view2d.set_objects(builder.objects.duplicate(true)))
	stage_panel.selection_changed.connect(func(id: String) -> void: view2d.select(id))
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
	set_mode(str(Config.args.get("previs-mode", cfg.get_value("previs", "mode", "front"))))
	visibility_changed.connect(_apply_mode)
	refresh_models()


## "front" | "plan" (2D, no 3D rendering) | "3d". Remembered per client (UI preference, not show data).
func set_mode(m: String) -> void:
	mode = m if MODES.has(m) else "front"
	for k in _mode_btns:
		(_mode_btns[k] as Button).set_pressed_no_signal(k == mode)
	_apply_mode()
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("previs", "mode", mode)
	cfg.set_value("previs", "live_pictures", _pictures.button_pressed)
	cfg.save(UI_CFG)


func _apply_mode() -> void:
	if _sv == null:
		return
	var shown := is_visible_in_tree()
	var is3d := mode == "3d"
	_svc.visible = is3d
	_sv.render_target_update_mode = SubViewport.UPDATE_WHEN_VISIBLE if is3d and shown else SubViewport.UPDATE_DISABLED
	builder.set_live(is3d and shown)
	if is3d and shown:
		VideoSurfaces.acquire(_glb_role, self)
	else:
		VideoSurfaces.release(_glb_role, self)
	view2d.visible = not is3d
	if not is3d and view2d.view != mode:
		view2d.set_view(mode)
	_pictures.disabled = is3d
	view2d.set_live_pictures(_pictures.button_pressed and not is3d and shown)


func _build_toolbar() -> Control:
	var bar := HBoxContainer.new()
	var group := ButtonGroup.new()
	for spec in [["front", "2D front"], ["plan", "2D plan"], ["3d", "3D"]]:
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
	var fit := Button.new()
	fit.text = "Fit"
	fit.pressed.connect(func() -> void:
		view2d.fit()
		stage.frame_box(builder.bounds()))
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
