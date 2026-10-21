extends VBoxContainer
## WO-612 — previs "MVR scene": Import… a .mvr from this machine (POST /api/stage/mvr; the server parses it and keeps
## it in projects/_mvr), pick which imported scene this project shows (project.previs.mvr {id, name, hidden_layers},
## ProjectSync autosave), hide layers, Remove one from the box.
## WO-612 T7: Export… saves this project's WO-614 stage as an .mvr (GET /api/stage/mvr-export, built on the server).

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const MvrScene := preload("res://features/previs/mvr_scene.gd")
const M := preload("res://features/previs/mvr_model.gd")

signal scene_loaded(info: Dictionary)

var scene: MvrScene
var _pick: OptionButton
var _layers: MenuButton
var _remove_btn: Button
var _status: Label
var _confirm: ConfirmationDialog
var _last := ""


func bind(s: MvrScene) -> void:
	scene = s
	scene.loaded.connect(_on_loaded)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _maybe_reload())
	await refresh_list()
	_maybe_reload()


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_pick = OptionButton.new()
	_pick.fit_to_longest_item = false
	_pick.item_selected.connect(_on_pick)
	add_child(_pick)
	var row := HBoxContainer.new()
	for spec in [["Import…", _import], ["Export…", _export], ["Remove", _ask_remove]]:
		var b := Button.new()
		b.text = spec[0]
		if spec[0] == "Export…":
			b.tooltip_text = "Save this project's stage (LED walls, TVs, projection) as an .mvr for Capture, consoles, Perastage"
		b.pressed.connect(spec[1])
		row.add_child(b)
		_remove_btn = b  # the loop ends on Remove
	_remove_btn.disabled = true
	_layers = MenuButton.new()
	_layers.text = "Layers ▾"
	_layers.flat = false
	_layers.about_to_popup.connect(_fill_layers)
	_layers.get_popup().hide_on_checkable_item_selection = false
	_layers.get_popup().index_pressed.connect(_toggle_layer)
	_layers.disabled = true
	row.add_child(_layers)
	add_child(row)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_status.text = M.summary({})
	add_child(_status)
	_confirm = ConfirmationDialog.new()
	_confirm.confirmed.connect(_remove)
	add_child(_confirm)


func _cfg() -> Dictionary:
	var previs: Variant = Store.project.get("previs")
	return (previs as Dictionary).get("mvr", {}) if previs is Dictionary and (previs as Dictionary).get("mvr") is Dictionary else {}


func _maybe_reload() -> void:
	var c := _cfg()
	var js := JSON.stringify(c)
	if js == _last or scene == null:
		return
	_last = js
	_select(str(c.get("id", "")))
	scene.set_hidden_layers(c.get("hidden_layers", []) if c.get("hidden_layers") is Array else [])
	scene.show_scene(str(c.get("id", "")))


func refresh_list() -> void:
	var res: Dictionary = await Api.get_json("/api/stage/mvr")
	var list: Array = res.data.get("scenes", []) if res.ok and res.data is Dictionary else []
	_pick.clear()
	_pick.add_item("— no MVR scene —")
	_pick.set_item_metadata(0, "")
	for s in list:
		_pick.add_item("%s  (%d objects)" % [s.get("name", "?"), int(s.get("objects", 0))])
		_pick.set_item_metadata(_pick.item_count - 1, str(s.get("id", "")))
	_select(str(_cfg().get("id", "")))


func _select(id: String) -> void:
	for i in _pick.item_count:
		if str(_pick.get_item_metadata(i)) == id:
			_pick.select(i)
			return
	_pick.select(0)


func _on_pick(i: int) -> void:
	var id := str(_pick.get_item_metadata(i))
	_save({} if id == "" else {"id": id, "name": _pick.get_item_text(i).get_slice("  (", 0), "hidden_layers": []})


func _save(c: Dictionary) -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	if c.is_empty():
		previs.erase("mvr")
	else:
		previs["mvr"] = c
	Store.project["previs"] = previs
	ProjectSync.mark_dirty()
	_last = ""
	_maybe_reload()


func _import() -> void:
	var path: String = await FilePick.open_path(self, "Import an MVR scene", ["*.mvr ; MVR scene"])
	if path == "":
		return
	_status.text = "Uploading %s…" % path.get_file()
	var res: Dictionary = await Upload.upload(Config.origin, "/api/stage/mvr", path, func(sent: int, total: int) -> void:
		_status.text = "Uploading %s… %d%%" % [path.get_file(), int(100.0 * sent / maxf(1.0, total))])
	if not res.ok or not (res.data is Dictionary):
		_status.text = "Import failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
		return
	await refresh_list()
	_save({"id": str(res.data.id), "name": str(res.data.name), "hidden_layers": []})


func _export() -> void:
	var name := str(Store.project.get("name", "stage")).validate_filename().replace(" ", "_")
	var path: String = await FilePick.save_path(self, "Export the stage as MVR", (name if name != "" else "stage") + ".mvr", ["*.mvr ; MVR scene"])
	if path == "":
		return
	if not path.to_lower().ends_with(".mvr"):
		path += ".mvr"
	_status.text = "Exporting…"
	ProjectSync.flush()  # the server builds it from the saved project: let the latest stage edit land first
	while ProjectSync.in_flight:
		await get_tree().process_frame
	var res: Dictionary = await Api.get_bytes("/api/stage/mvr-export")
	if not res.ok:
		var body: Variant = JSON.parse_string((res.bytes as PackedByteArray).get_string_from_utf8())
		_status.text = "Export failed: %s" % (body.get("error", res.error) if body is Dictionary else res.error)
		return
	var err := FilePick.write_bytes(path, res.bytes)
	_status.text = ("Exported the stage to %s" % path) if err == "" else "Export failed: %s" % err


func _ask_remove() -> void:
	var id := str(_pick.get_item_metadata(_pick.selected)) if _pick.selected >= 0 else ""
	if id == "":
		return
	_confirm.dialog_text = "Remove the MVR scene \"%s\" from this box? Projects that show it lose it." % _cfg().get("name", id)
	_confirm.popup_centered()


func _remove() -> void:
	var id := str(_pick.get_item_metadata(_pick.selected))
	await Api.delete_json("/api/stage/mvr/" + id)
	if str(_cfg().get("id", "")) == id:
		_save({})
	await refresh_list()


func _fill_layers() -> void:
	var p := _layers.get_popup()
	p.clear()
	var hidden: Array = _cfg().get("hidden_layers", []) if _cfg().get("hidden_layers") is Array else []
	for l in scene.layers:
		p.add_check_item(str(l))
		p.set_item_checked(p.item_count - 1, not hidden.has(l))


func _toggle_layer(i: int) -> void:
	var c := _cfg().duplicate(true)
	if c.is_empty():
		return
	var name := _layers.get_popup().get_item_text(i)
	var hidden: Array = c.get("hidden_layers", []) if c.get("hidden_layers") is Array else []
	if hidden.has(name):
		hidden.erase(name)
	else:
		hidden.append(name)
	c["hidden_layers"] = hidden
	_layers.get_popup().set_item_checked(i, not hidden.has(name))
	_save(c)


func _on_loaded(info: Dictionary) -> void:
	_layers.disabled = scene.layers.is_empty()
	_remove_btn.disabled = info.is_empty()  # {} = no scene picked
	_status.text = M.summary(info)
	scene_loaded.emit(info)
