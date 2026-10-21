extends VBoxContainer
## WO-612 — previs "MVR scene": Import… a .mvr from this machine (POST /api/stage/mvr; the server parses it and keeps
## it in projects/_mvr), pick which imported scene this project shows (project.previs.mvr {id, name, hidden_layers},
## ProjectSync autosave), hide layers, Remove one from the box.
## WO-612 T7: Export… saves this project's WO-614 stage as an .mvr (GET /api/stage/mvr-export, built on the server).
## WO-615 T10: Patch fixtures — the server imports the scene's GDTFs and builds patch entries (address, mode, pose from
## the file; POST /api/stage/mvr/<id>/patch); they are merged into project.fixtures and the live rig replaces the static
## models. Unpatch removes this scene's fixtures from the patch again.
## Place (project.previs.mvr.place): where the file's frame sits on our stage — an MVR's origin is its author's (Capture
## venues can sit metres off to one side, floor below ours). Import fits a scene that is off; patched fixtures move along.

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const MvrScene := preload("res://features/previs/mvr_scene.gd")
const M := preload("res://features/previs/mvr_model.gd")

signal scene_loaded(info: Dictionary)
signal types_changed  ## a patch imported GDTF types (the Fixtures section re-lists them)

var scene: MvrScene
var _pick: OptionButton
var _layers: MenuButton
var _remove_btn: Button
var _status: Label
var _confirm: ConfirmationDialog
var _last := ""
var _patch_btn: Button
var _unpatch_btn: Button
var _proto: OptionButton
var _patch_status: Label
var _unpatch_confirm: ConfirmationDialog
var _place := {}  # "x" / "y" / "z" / "yaw" → SpinBox
var _fit_on_load := false


func bind(s: MvrScene) -> void:
	scene = s
	scene.loaded.connect(_on_loaded)
	Store.project_changed.connect(func(_p: Dictionary) -> void:
		_maybe_reload()
		_sync_patch_ui())
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
	var place := HBoxContainer.new()
	for spec in [["x", "X ", -500, 500, "Stage left (m)"], ["y", "Y ", -500, 500, "Upstage (m)"], ["z", "Z ", -50, 200, "Up (m)"],
			["yaw", "↻ ", -180, 180, "Turn (°)"]]:
		var sb := SpinBox.new()
		sb.prefix = spec[1]
		sb.min_value = spec[2]
		sb.max_value = spec[3]
		sb.step = 0.01 if spec[0] != "yaw" else 0.5
		sb.allow_greater = spec[0] == "yaw"
		sb.allow_lesser = spec[0] == "yaw"
		sb.tooltip_text = "Move the MVR scene on the stage: " + spec[4]
		sb.select_all_on_focus = true
		sb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		sb.value_changed.connect(func(_v: float) -> void: _set_place(_place_from_ui()))
		place.add_child(sb)
		_place[spec[0]] = sb
	var fit := Button.new()
	fit.text = "Fit"
	fit.tooltip_text = "Centre the visible scene on the stage and stand it on the floor"
	fit.pressed.connect(func() -> void: _set_place(M.fit_place(scene.bounds(true), float(_place.yaw.value))))
	place.add_child(fit)
	add_child(place)
	var prow := HBoxContainer.new()
	_patch_btn = Button.new()
	_patch_btn.text = "Patch fixtures"
	_patch_btn.tooltip_text = "Patch the scene's fixtures at the addresses, modes and positions in the file (GDTFs are imported)"
	_patch_btn.pressed.connect(_patch)
	prow.add_child(_patch_btn)
	_proto = OptionButton.new()
	_proto.add_item("Art-Net")
	_proto.add_item("sACN")
	_proto.tooltip_text = "MVR universe 1 = Art-Net 0 / sACN 1"
	prow.add_child(_proto)
	_unpatch_btn = Button.new()
	_unpatch_btn.text = "Unpatch"
	_unpatch_btn.pressed.connect(func() -> void:
		_unpatch_confirm.dialog_text = "Remove this scene's %d patched fixture(s) from the patch?" % _patched_here()
		_unpatch_confirm.popup_centered())
	prow.add_child(_unpatch_btn)
	add_child(prow)
	_patch_status = Label.new()
	_patch_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_patch_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_patch_status)
	_unpatch_confirm = ConfirmationDialog.new()
	_unpatch_confirm.confirmed.connect(_unpatch)
	add_child(_unpatch_confirm)
	_sync_patch_ui()


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
	var p := M.place_of(c)
	for k in _place:
		(_place[k] as SpinBox).set_value_no_signal(p[k])
	scene.set_place(p)
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
	_fit_on_load = true
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
	_patch_status.text = ""
	_sync_patch_ui()
	_layers.disabled = scene.layers.is_empty()
	_remove_btn.disabled = info.is_empty()  # {} = no scene picked
	_status.text = M.summary(info)
	if _fit_on_load and info.has("parts"):
		var b := scene.bounds(true)
		if M.needs_fit(b):
			_set_place(M.fit_place(b, 0.0))
			_status.text += "\nMoved onto the stage (its origin was off) — adjust under Place, or 0 / 0 / 0 to undo."
	_fit_on_load = false
	scene_loaded.emit(info)


func _fixtures_slice() -> Dictionary:
	return preload("res://features/previs/tracking/follow_model.gd").normalize(Store.project.get("fixtures"))


func _patched_here() -> int:
	if scene == null:
		return 0
	var ids := M.patched_uuids(_fixtures_slice().patch)
	return scene.fixture_uuids.filter(func(u: String) -> bool: return ids.has(u)).size()


## Buttons + hiding the static models of fixtures the live rig draws.
func _sync_patch_ui() -> void:
	if _patch_btn == null:
		return
	var n: int = scene.fixture_uuids.size() if scene != null else 0
	var here := _patched_here()
	_patch_btn.disabled = n == 0
	_patch_btn.text = "Re-patch fixtures" if here > 0 else "Patch fixtures"
	_unpatch_btn.disabled = here == 0
	if scene != null:
		scene.set_patched(M.patched_uuids(_fixtures_slice().patch))
	if _patch_status.text == "" and n > 0:
		_patch_status.text = "%d of %d fixtures patched." % [here, n] if here > 0 else "%d fixtures, not patched." % n


func _patch() -> void:
	var id := str(_cfg().get("id", ""))
	if id == "":
		return
	_patch_btn.disabled = true
	_patch_status.text = "Patching… (importing the scene's GDTF files)"
	var res: Dictionary = await Api.post_json("/api/stage/mvr/%s/patch" % id, {"protocol": "sacn" if _proto.selected == 1 else "artnet"})
	if not res.ok or not (res.data is Dictionary):
		_patch_status.text = "Patch failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
		_sync_patch_ui()
		return
	var p := M.place_of(_cfg())
	var incoming: Array = (res.data.get("fixtures", []) as Array).map(func(f: Variant) -> Variant:
		if f is Dictionary and f.get("pose") is Dictionary:
			f.pose = M.place_pose(f.pose, p)
		return f)
	var s := _fixtures_slice()
	s.patch = M.merge_patch(s.patch, incoming)
	_persist_fixtures(s)
	_patch_status.text = M.patch_summary(res.data)
	types_changed.emit()


func _unpatch() -> void:
	var s := _fixtures_slice()
	var before: int = s.patch.size()
	s.patch = M.unpatch(s.patch, scene.fixture_uuids)
	_persist_fixtures(s)
	_patch_status.text = "Unpatched %d fixture(s)." % (before - s.patch.size())


## Same write as the Fixtures section: the whole normalized slice, then project_changed so every fixtures view reloads.
func _persist_fixtures(slice: Dictionary) -> void:
	Store.project["fixtures"] = slice
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)


func _place_from_ui() -> Dictionary:
	var p := {}
	for k in _place:
		p[k] = (_place[k] as SpinBox).value
	return p


## New placement: saved with the scene; this scene's patched fixtures move by the same change.
func _set_place(p: Dictionary) -> void:
	var c := _cfg().duplicate(true)
	if c.is_empty():
		return
	var old := M.place_of(c)
	c["place"] = p
	_save(c)
	if _patched_here() > 0:
		var s := _fixtures_slice()
		s.patch = M.replace_patch(s.patch, scene.fixture_uuids, old, M.place_of(c))
		_persist_fixtures(s)
