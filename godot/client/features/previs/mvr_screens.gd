extends VBoxContainer
## WO-634 T2 — "MVR object → LED screen" (in the MVR section). Click an MVR wall in the 3D view (previs_tab →
## mvr_section.click; ctrl- or shift-click adds/removes walls — e.g. a centre wall and its two totems fed by one
## media-server output), pick the screen destination in the row under the selection and Map: one WO-614 LED wall per
## selected wall on its front face, all fed by that destination with crops packed left → right as the audience sees
## them (mvr_screen_model.gd), and the MVR objects they replace are hidden (project.previs.mvr.hidden_objects). Panels
## = the MVR's own, pitch = the finest whose canvas fits the destination unscaled (else the coarsest); crops stay
## editable per wall in the Stage panel to match the sending card's map. (Owner 21.10: no dialog — select and map.)

const W := preload("res://features/previs/mvr_screen_model.gd")
const S := preload("res://features/previs/stage_objects.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/previs/mvr_model.gd")

const HINT := "Click an LED wall in the 3D view to map a screen onto it (ctrl / shift-click adds walls fed by the same output)."

var scene: Node3D  # mvr_scene.gd
var _sel: Array = []  # [{uuids, frame}]
var _info: Label
signal selection_changed(uuids: Array)  # WO-647: every selected object (the Layers list highlights their layers)
var _row: HBoxContainer
var _dest: OptionButton
var _turn: CheckBox
var _restore: Button
var _dests: Array = []
var _dest_key := ""  # the destination last picked, kept across refills
var _note := ""  # what the last Map did


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_info = Label.new()
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD
	_info.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_info)
	_row = HBoxContainer.new()
	_dest = OptionButton.new()
	_dest.fit_to_longest_item = false
	_dest.clip_text = true
	_dest.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_dest.tooltip_text = "The screen destination whose canvas covers the selected walls"
	_dest.item_selected.connect(func(i: int) -> void: _dest_key = _key(_dests[i]))
	_row.add_child(_dest)
	var map := Button.new()
	map.text = "Map"
	map.tooltip_text = "Make the selected walls LED screens fed by this destination (crops left → right)"
	map.pressed.connect(_map)
	_row.add_child(map)
	_turn = CheckBox.new()
	_turn.text = "Turn around"
	_turn.tooltip_text = "The screens face the side you clicked from — tick when that was backstage"
	_row.add_child(_turn)
	add_child(_row)
	_restore = Button.new()
	_restore.tooltip_text = "Show the MVR objects that LED screens replaced again"
	_restore.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_restore.pressed.connect(func() -> void: _save_hidden([]))
	add_child(_restore)
	refresh()


## A left click in the 3D view that hit no fixture and no stage object. → whether it hit an MVR object.
## `add` (ctrl or shift held) toggles that wall in the selection; a plain click selects it alone.
func click(cam: Camera3D, at: Vector2, add: bool) -> bool:
	var uuid: String = scene.pick(cam, at) if scene != null else ""
	if uuid == "":
		if not add:
			clear()
		return false
	_note = ""
	for i in _sel.size():
		if (_sel[i].uuids as Array).has(uuid):
			if add:
				_sel.remove_at(i)
			else:
				_sel = [_sel[i]]
			refresh()
			return true
	var uuids := W.cluster(scene.cluster_items(), uuid)
	var wall := {"uuids": uuids, "frame": W.wall_frame(scene.wall_boxes(uuids), scene.to_stage(cam.global_position))}
	_sel = _sel + [wall] if add else [wall]
	refresh()
	return true


## forget: the scene changed — the last Map's note goes too (WO-681).
func clear(forget := false) -> void:
	_sel = []
	if forget:
		_note = ""
	refresh()


func refresh() -> void:
	if scene != null:
		scene.mark(_sel.map(func(s: Dictionary) -> Dictionary: return s.frame))
	var parts := _sel.map(func(s: Dictionary) -> String:
		var f: Dictionary = s.frame
		var n := (s.uuids as Array).size()
		return "%.2f × %.2f m%s" % [f.size.x, f.size.y, "" if n == 1 else " (%d objects)" % n])
	var uuids := []
	for s in _sel:
		uuids.append_array(s.uuids)
	selection_changed.emit(uuids)
	if not _sel.is_empty():
		_info.text = "Selected: " + ", ".join(parts)
		var names := [] if scene == null else M.layers_of(uuids, scene.layer_of).filter(func(l: String) -> bool: return l != "")
		if not names.is_empty():
			_info.text += " — layer " + ", ".join(names)
	else:
		_info.text = _note if _note != "" else HINT
	_row.visible = not _sel.is_empty()
	if _row.visible:
		_fill_dests()
	var gone := _hidden()
	_restore.text = "Show %d replaced" % gone.size()
	_restore.visible = not gone.is_empty()


func _key(d: Dictionary) -> String:
	return "%s|%d" % [d.get("label", ""), int(d.get("mainScreenIndex", 0))]


func _fill_dests() -> void:
	var sd: Variant = Settings.get_setting("screenDestinations", {})
	var all: Array = (sd as Dictionary).get("destinations", []) if sd is Dictionary else []
	_dests = all.filter(func(d: Variant) -> bool: return d is Dictionary and str(d.get("mode", "")) != "operator_gui")
	_dest.clear()
	if _dests.is_empty():
		_dest.add_item("No screen destination — add one under Devices")
		_dest.disabled = true
		return
	_dest.disabled = false
	for d in _dests:
		_dest.add_item("%s  %d×%d → pgm%d" % [d.get("label", "Screen"), int(d.get("width", 0)), int(d.get("height", 0)),
			int(d.get("mainScreenIndex", 0)) + 1])
		if _key(d) == _dest_key:
			_dest.select(_dest.item_count - 1)


func _mvr() -> Dictionary:
	var previs: Variant = Store.project.get("previs")
	return (previs as Dictionary).get("mvr", {}) if previs is Dictionary and (previs as Dictionary).get("mvr") is Dictionary else {}


func _hidden() -> Array:
	return _mvr().get("hidden_objects", []) if _mvr().get("hidden_objects") is Array else []


func _picked() -> Dictionary:
	return _dests[_dest.selected] if _dest.selected >= 0 and _dest.selected < _dests.size() else {}


## The walls at preset `i`'s pitch (packed into `raster`). → {objects, canvas, scale}
func _build(i: int, role: String, raster: Vector2i) -> Dictionary:
	var p: Dictionary = S.PANEL_PRESETS[i]
	var existing: Array = _stage_objects()
	var walls := []
	for s in _sel:
		var f: Dictionary = W.turned(s.frame) if _turn.button_pressed else s.frame
		var mm := W.panel_mm_for(f, (s.uuids as Array).size() > 1, p.mm)
		walls.append(W.wall_object(f, W.panel_px_for(mm, float(p.mm[0]) / float(p.px[0])), mm, role, existing + walls))
	return W.pack(walls, raster)


func _map() -> void:
	var d := _picked()
	if d.is_empty() or _sel.is_empty():
		return
	var role := "pgm%d" % (int(d.get("mainScreenIndex", 0)) + 1)
	var raster := Vector2i(int(d.get("width", 1920)), int(d.get("height", 1080)))
	var r := _build(S.PANEL_PRESETS.size() - 1, role, raster)  # the finest pitch that fits unscaled, else the coarsest
	for i in S.PANEL_PRESETS.size():
		var t := _build(i, role, raster)
		if W.fit_note(t.canvas, raster) == "":
			r = t
			break
	for o in r.objects:
		o["mvr"] = str(_mvr().get("id", ""))  # WO-681: the walls go when the scene does
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	previs["stage"] = {"version": 1, "objects": _stage_objects() + r.objects}
	Store.project["previs"] = previs
	var gone := _hidden()
	for s in _sel:
		for u in s.uuids:
			if not gone.has(u):
				gone.append(u)
	var fit := W.fit_note(r.canvas, raster)
	_note = "Mapped %d wall%s onto %s: canvas %d × %d px%s. Crops left → right as the audience sees them — edit them in the Stage panel to match the sending card." % [
		r.objects.size(), "" if r.objects.size() == 1 else "s", role, r.canvas.x, r.canvas.y,
		"" if fit == "" else ", scaled ×%.2f into %d × %d" % [r.scale, raster.x, raster.y]]
	_sel = []
	_save_hidden(gone)


func _stage_objects() -> Array:
	var previs: Variant = Store.project.get("previs")
	var st: Variant = (previs as Dictionary).get("stage") if previs is Dictionary else null
	return (st as Dictionary).get("objects", []).duplicate(true) if st is Dictionary and (st as Dictionary).get("objects") is Array else []


func _save_hidden(uuids: Array) -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	var c := _mvr()
	if c.is_empty():
		return
	if uuids.is_empty():
		c.erase("hidden_objects")
	else:
		c["hidden_objects"] = uuids
	previs["mvr"] = c
	Store.project["previs"] = previs
	ProjectSync.mark_dirty()
	Store.project_changed.emit(Store.project)  # the Stage panel and the MVR section reload from the project
	refresh()
