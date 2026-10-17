extends HSplitContainer
## WO-607 — Previs tab: 3D stage (SubViewport) + side panel (models from /api/previs/models, live source,
## screen meshes, camera presets). Source surfaces come from VideoSurfaces (shm; runtime roles leased).

const PrevisStage := preload("res://features/previs/previs_stage.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var stage: PrevisStage
var _models: ItemList
var _meshes: VBoxContainer
var _source: OptionButton
var _status: Label
var _model_ids: Array = []


func _ready() -> void:
	split_offset = -320
	var svc := SubViewportContainer.new()
	svc.stretch = true
	svc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(svc)
	var sv := SubViewport.new()
	sv.own_world_3d = true
	sv.handle_input_locally = false
	svc.add_child(sv)
	stage = PrevisStage.new()
	sv.add_child(stage)
	svc.gui_input.connect(func(e: InputEvent) -> void: stage.handle_input(e))
	add_child(_build_panel())
	stage.model_loaded.connect(_on_model_loaded)
	_set_source(str(Config.args.get("previs-source", "opgui")))
	refresh_models()


func refresh_models() -> void:
	var res: Dictionary = await Api.get_json("/api/previs/models")
	_models.clear()
	_model_ids.clear()
	if not res.ok:
		_status.text = "previs module off on the server (%s)" % res.error
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
	stage.set_live_texture(VideoSurfaces.texture(role))


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
