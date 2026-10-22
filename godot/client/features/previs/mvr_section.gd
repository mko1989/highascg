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
## WO-634: click a wall in the 3D view (ctrl adds walls) → Map onto a destination (mvr_screens.gd; project.previs.mvr.hidden_objects).

const Upload := preload("res://core/stream_upload.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const MvrScene := preload("res://features/previs/mvr_scene.gd")
const M := preload("res://features/previs/mvr_model.gd")
const MvrScreens := preload("res://features/previs/mvr_screens.gd")
const RM := preload("res://features/previs/fixtures/replace_type_model.gd")
const Tint := preload("res://features/previs/model_tint.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const ColorRows := preload("res://features/previs/color_rows.gd")
const Fold := preload("res://features/previs/fold_section.gd")
const PaneKit := preload("res://features/settings/pane_kit.gd")

signal scene_loaded(info: Dictionary)
signal types_changed  ## GDTF types were imported (scene shown, or a patch) — the Fixtures section re-lists them
signal objects_picked  ## WO-682: a 3D click selected MVR objects (selected_uuids) — the Position card follows

var scene: MvrScene
var _pick: OptionButton
var _remove_btn: Button
var _status: Label
var _confirm: ConfirmationDialog
var _after := Callable()  # what _confirm's OK does: Remove, or leave the scene (WO-681)
var _last := ""
var _patch_btn: Button
var _typed := {}  # scene ids whose GDTF types were loaded this session (WO-636)
var _info := {}  # the shown scene's info (summary line)
var _unpatch_btn: Button
var _proto: OptionButton
var _patch_status: Label
var _unpatch_confirm: ConfirmationDialog
var _place := {}  # "x" / "y" / "z" / "yaw" → SpinBox
var _fit_on_load := false
var _screens: MvrScreens
var _colors := ColorRows.new()  # WO-641: a colour per layer
var _screen_uuids: Array = []  # WO-647: what the screens tool has selected


func bind(s: MvrScene) -> void:
	scene = s
	scene.loaded.connect(_on_loaded)
	if _screens != null:
		_screens.scene = s
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
	add_child(row)
	_colors.eyes = true  # WO-647: colour + eye per layer (was the Layers ▾ checklist)
	_colors.previewed.connect(func(l: String, c: Color) -> void:
		scene.set_layer_colors(Tint.with_color(Tint.colors(_cfg(), "layer_colors"), l, c)))
	_colors.changed.connect(_set_layer_color)
	_colors.visibility_toggled.connect(_set_layer_shown)
	add_child(Fold.new("Layers", [_colors]))
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_status.text = M.summary({})
	add_child(_status)
	_confirm = ConfirmationDialog.new()
	_confirm.confirmed.connect(func() -> void: _after.call())
	_confirm.canceled.connect(func() -> void: _select(str(_cfg().get("id", ""))))
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
	_screens = MvrScreens.new()
	_screens.selection_changed.connect(func(uuids: Array) -> void:
		_screen_uuids = uuids
		_light_layers())
	Sel.shared().changed.connect(_light_layers)
	_screens.scene = scene
	add_child(_screens)
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
	scene.configure(c)
	_colors.fill(scene.layers, Tint.colors(c, "layer_colors"), {}, _hidden_layers())
	_screens.refresh()


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
	var c := {} if id == "" else {"id": id, "name": _pick.get_item_text(i).get_slice("  (", 0), "hidden_layers": []}
	var n := _content()
	if id == str(_cfg().get("id", "")) or n[0] + n[1] == 0:
		_save(c)
		return
	_after = func() -> void:
		_drop()
		_save(c)
	_confirm.dialog_text = "Stop showing \"%s\"? This project loses %s (showing it again re-patches them)." % [
		_cfg().get("name", ""), M.content_text(n)]
	_confirm.popup_centered()


## WO-681: what the shown scene brought ([fixtures, walls]); _drop takes it out of the project.
func _content() -> Array:
	return M.drop_scene(Store.project.duplicate(true), str(_cfg().get("id", "")), scene.fixture_uuids if scene else [])


func _drop() -> void:
	var id := str(_cfg().get("id", ""))
	_typed.erase(id)  # shown again → its GDTFs load and it patches afresh
	var n := M.drop_scene(Store.project, id, scene.fixture_uuids if scene else [])
	if n[0] + n[1] > 0:
		ProjectSync.mark_dirty(true)
		Store.project_changed.emit(Store.project)


func _save(c: Dictionary) -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	if str(c.get("id", "")) != str(_cfg().get("id", "")):
		_screens.clear(true)
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
	# WO-643: the same file again is said, not re-imported; a new version of the shown scene is asked first.
	var check := M.import_check(_cfg(), M.file_id(FileAccess.get_file_as_bytes(path)), M.file_name(path))
	if check[0] == "same":
		var d := AcceptDialog.new()
		d.title = "Already imported"
		d.dialog_text = check[1]
		d.visibility_changed.connect(func() -> void:
			if not d.visible:
				d.queue_free())
		add_child(d)
		d.popup_centered()
	elif check[0] == "version":
		PaneKit.confirm(self, check[1], _upload.bind(path))
	else:
		_upload(path)


func _upload(path: String) -> void:
	_status.text = "Uploading %s…" % path.get_file()
	var res: Dictionary = await Upload.upload(Config.origin, "/api/stage/mvr", path, func(sent: int, total: int) -> void:
		_status.text = "Uploading %s… %d%%" % [path.get_file(), int(100.0 * sent / maxf(1.0, total))])
	if not res.ok or not (res.data is Dictionary):
		_status.text = "Import failed: %s" % (res.data.get("error", res.error) if res.data is Dictionary else res.error)
		return
	await refresh_list()
	var c := M.import_cfg(_cfg(), str(res.data.id), str(res.data.name))
	_fit_on_load = not c.has("place")  # WO-643: a re-import keeps the scene where it was
	_save(c)


func _export() -> void:
	await preload("res://features/previs/mvr_export.gd").run(self, _status)


func _ask_remove() -> void:
	var id := str(_pick.get_item_metadata(_pick.selected)) if _pick.selected >= 0 else ""
	if id == "":
		return
	var what := M.content_text(_content()) if str(_cfg().get("id", "")) == id else ""
	_after = _remove
	_confirm.dialog_text = "Remove the MVR scene \"%s\" from this box? Projects that show it lose it.%s" % [
		_cfg().get("name", id), "" if what == "" else "\nThis project also loses %s." % what]
	_confirm.popup_centered()


func _remove() -> void:
	var id := str(_pick.get_item_metadata(_pick.selected))
	await Api.delete_json("/api/stage/mvr/" + id)
	if str(_cfg().get("id", "")) == id:
		_drop()
		_save({})
	await refresh_list()


func _hidden_layers() -> Array:
	return _cfg().get("hidden_layers", []) if _cfg().get("hidden_layers") is Array else []


func _set_layer_color(layer: String, c: Variant) -> void:
	var cfg := _cfg().duplicate(true)
	if not cfg.is_empty():
		cfg["layer_colors"] = Tint.with_color(Tint.colors(cfg, "layer_colors"), layer, c)
		_save(cfg)


## WO-647: a layer row's eye.
func _set_layer_shown(name: String, shown: bool) -> void:
	var c := _cfg().duplicate(true)
	if c.is_empty():
		return
	var hidden: Array = c.get("hidden_layers", []) if c.get("hidden_layers") is Array else []
	hidden.erase(name)
	if not shown:
		hidden.append(name)
	c["hidden_layers"] = hidden
	_save(c)


## WO-634: a 3D click that hit no fixture / stage object → maybe an MVR wall. → whether it hit one.
func click(cam: Camera3D, at: Vector2, add: bool) -> bool:
	var hit := _screens.click(cam, at, add)
	if hit:
		objects_picked.emit()
	return hit


func selected_uuids() -> Array: return _screen_uuids


func _on_loaded(info: Dictionary) -> void:
	_screens.clear()
	_patch_status.text = ""
	_sync_patch_ui()
	_colors.fill(scene.layers, Tint.colors(_cfg(), "layer_colors"), {}, _hidden_layers())
	_remove_btn.disabled = info.is_empty()  # {} = no scene picked
	_info = info
	_status.text = M.summary(info)
	if _fit_on_load and info.has("parts"):
		var b := scene.bounds(true)
		if M.needs_fit(b):
			_set_place(M.fit_place(b, 0.0))
			_status.text += "\nMoved onto the stage (its origin was off) — adjust under Place, or 0 / 0 / 0 to undo."
	_fit_on_load = false
	scene_loaded.emit(info)
	_load_types()


## WO-636: a shown scene's GDTFs go into the box's type store (POST …/types; content-addressed, a known type is not
## re-read) and its fixtures carry over — none patched yet and no Unpatch (mvr.unpatched) → the file's own patch.
## WO-637: placeholders among them are first swapped for the real files from GDTF Share (when an account is set), so
## the patch lands on the real types; fixtures patched before move over (RM.repoint).
func _load_types() -> void:
	var c := _cfg()
	var id := str(c.get("id", ""))
	if id == "" or _typed.has(id) or scene == null or scene.fixture_uuids.is_empty():
		return
	_typed[id] = true
	var res: Dictionary = await Api.post_json("/api/stage/mvr/%s/types" % id, {})
	var types: Array = res.data.get("types", []) if res.ok and res.data is Dictionary else []
	var real := await _from_share(types)
	if _patched_here() == 0 and not c.get("unpatched", false):
		_patch()
		return
	if not real.is_empty():
		var s := _fixtures_slice()
		for r in real:
			s.patch = RM.repoint(s.patch, str(r.id), str(r.to), r.modes).patch
		_persist_fixtures(s)
	if not types.is_empty():
		types_changed.emit()


## WO-637: POST /api/fixtures/share/resolve for the placeholders in `types` → the ones replaced ({id, to, modes}).
## The outcome goes under the scene summary; no account / nothing to do → silent.
func _from_share(types: Array) -> Array:
	var ids := types.filter(func(t: Dictionary) -> bool: return t.get("placeholder", false) and not t.has("replacedBy")).map(
		func(t: Dictionary) -> String: return str(t.id))
	var done := types.filter(func(t: Dictionary) -> bool: return t.has("replacedBy")).map(func(t: Dictionary) -> String: return str(t.spec))
	if ids.is_empty():
		_status.text = _status.text.replace(M.summary(_info), M.summary(M.without_specs(_info, done)))
		return []
	_status.text += "\nGDTF Share: looking up %d placeholder fixture type%s…" % [ids.size(), "" if ids.size() == 1 else "s"]
	var res: Dictionary = await Api.post_json("/api/fixtures/share/resolve", {"ids": ids})
	_status.text = _status.text.get_slice("\nGDTF Share:", 0)
	var out: Array = res.data.get("results", []) if res.ok and res.data is Dictionary else []
	var gone := out.filter(func(r: Dictionary) -> bool: return r.get("status", "") == "replaced").map(func(r: Dictionary) -> String: return str(r.id))
	var specs := types.filter(func(t: Dictionary) -> bool: return gone.has(str(t.id))).map(func(t: Dictionary) -> String: return str(t.get("spec", "")))
	_status.text = _status.text.replace(M.summary(_info), M.summary(M.without_specs(_info, done + specs)))
	var note := M.share_note(out, res.data.get("offline", "") if res.data is Dictionary else str(res.error))
	if note != "":
		_status.text += "\n" + note
	return out.filter(func(r: Dictionary) -> bool: return r.get("status", "") == "replaced")


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
	_mark_unpatched(false)
	_persist_fixtures(s)
	_patch_status.text = M.patch_summary(res.data)
	types_changed.emit()


func _unpatch() -> void:
	var s := _fixtures_slice()
	var before: int = s.patch.size()
	s.patch = M.unpatch(s.patch, scene.fixture_uuids)
	_mark_unpatched(true)
	_persist_fixtures(s)
	_patch_status.text = "Unpatched %d fixture(s)." % (before - s.patch.size())


## Unpatch is remembered (project.previs.mvr.unpatched) so showing the scene again does not re-patch it. _last follows
## the write: the scene is not reloaded for it.
func _mark_unpatched(on: bool) -> void:
	var c := _cfg()
	if c.is_empty() or bool(c.get("unpatched", false)) == on:
		return
	if on:
		c["unpatched"] = true
	else:
		c.erase("unpatched")
	(Store.project["previs"] as Dictionary)["mvr"] = c
	_last = JSON.stringify(c)


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


## WO-647 / WO-678: light the layer rows of the selected objects and of the selected heads patched from this scene.
func _light_layers() -> void:
	if scene == null:
		_colors.highlight([])
		return
	_colors.highlight(M.layers_of(_screen_uuids + M.fixture_uuids(Sel.shared().ids), scene.layer_of))
