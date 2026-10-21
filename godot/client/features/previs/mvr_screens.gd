extends VBoxContainer
## WO-634 T2 — "MVR object → LED screen" (in the MVR section). Click an MVR wall in the 3D view (previs_tab →
## mvr_section.click; shift adds — e.g. a centre wall and its two totems), then Make LED screen(s)…: pick a screen
## destination and a panel pitch → one WO-614 LED wall per selected wall on its front face, all fed by that
## destination with crops packed left → right (mvr_screen_model.gd), and the MVR objects they replace are hidden
## (project.previs.mvr.hidden_objects). Crops stay editable per wall in the Stage panel to match the sending card's map.

const W := preload("res://features/previs/mvr_screen_model.gd")
const S := preload("res://features/previs/stage_objects.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var scene: Node3D  # mvr_scene.gd
var _sel: Array = []  # [{uuids, frame}]
var _info: Label
var _make: Button
var _restore: Button
var _dlg: ConfirmationDialog
var _dest: OptionButton
var _panel: OptionButton
var _turn: CheckBox
var _sum: Label
var _dests: Array = []


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_info = Label.new()
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD
	_info.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_info)
	var row := HBoxContainer.new()
	_make = Button.new()
	_make.pressed.connect(_open)
	row.add_child(_make)
	_restore = Button.new()
	_restore.tooltip_text = "Show the MVR objects that LED screens replaced again"
	_restore.pressed.connect(func() -> void: _save_hidden([]))
	row.add_child(_restore)
	add_child(row)
	_dlg = ConfirmationDialog.new()
	_dlg.title = "Make LED screens from the MVR"
	_dlg.ok_button_text = "Make"
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(520, 0)
	_dest = OptionButton.new()
	_dest.fit_to_longest_item = false
	_dest.item_selected.connect(func(_i: int) -> void:
		_best_panel()
		_summarise())
	box.add_child(_dest)
	_panel = OptionButton.new()
	_panel.fit_to_longest_item = false
	for p in S.PANEL_PRESETS:
		_panel.add_item(str(p.name))
	_panel.item_selected.connect(func(_i: int) -> void: _summarise())
	box.add_child(_panel)
	_turn = CheckBox.new()
	_turn.text = "Turn around (the picture faces the other side)"
	_turn.tooltip_text = "The screens face the side you clicked from — tick when that was backstage"
	_turn.toggled.connect(func(_on: bool) -> void: _summarise())
	box.add_child(_turn)
	_sum = Label.new()
	_sum.autowrap_mode = TextServer.AUTOWRAP_WORD
	_sum.custom_minimum_size = Vector2(520, 0)
	box.add_child(_sum)
	_dlg.add_child(box)
	_dlg.confirmed.connect(_create)
	add_child(_dlg)
	refresh()


## A left click in the 3D view that hit no fixture and no stage object. → whether it hit an MVR object.
func click(cam: Camera3D, at: Vector2, shift: bool) -> bool:
	var uuid: String = scene.pick(cam, at) if scene != null else ""
	if uuid == "":
		if not shift:
			clear()
		return false
	for i in _sel.size():
		if (_sel[i].uuids as Array).has(uuid):
			if shift:
				_sel.remove_at(i)  # shift-click a selected wall → drop it
			else:
				_sel = [_sel[i]]
			refresh()
			return true
	var uuids := W.cluster(scene.cluster_items(), uuid)
	var wall := {"uuids": uuids, "frame": W.wall_frame(scene.wall_boxes(uuids), scene.to_stage(cam.global_position))}
	_sel = _sel + [wall] if shift else [wall]
	refresh()
	return true


func clear() -> void:
	_sel = []
	refresh()


func refresh() -> void:
	if scene != null:
		scene.mark(_sel.map(func(s: Dictionary) -> Dictionary: return s.frame))
	var parts := _sel.map(func(s: Dictionary) -> String:
		var f: Dictionary = s.frame
		var n := (s.uuids as Array).size()
		return "%.2f × %.2f m%s" % [f.size.x, f.size.y, "" if n == 1 else " (%d objects)" % n])
	_info.text = ("Click an LED wall in the 3D view to make it a screen (shift-click adds walls fed by the same output)."
		if _sel.is_empty() else "Selected: " + ", ".join(parts))
	_make.text = "Make LED screen%s…" % ("" if _sel.size() <= 1 else "s")
	_make.disabled = _sel.is_empty()
	var gone := _hidden()
	_restore.text = "Show %d replaced" % gone.size()
	_restore.visible = not gone.is_empty()


func _mvr() -> Dictionary:
	var previs: Variant = Store.project.get("previs")
	return (previs as Dictionary).get("mvr", {}) if previs is Dictionary and (previs as Dictionary).get("mvr") is Dictionary else {}


func _hidden() -> Array:
	return _mvr().get("hidden_objects", []) if _mvr().get("hidden_objects") is Array else []


func _open() -> void:
	var sd: Variant = Settings.get_setting("screenDestinations", {})
	var all: Array = (sd as Dictionary).get("destinations", []) if sd is Dictionary else []
	_dests = all.filter(func(d: Variant) -> bool: return d is Dictionary and str(d.get("mode", "")) != "operator_gui")
	_dest.clear()
	_turn.set_pressed_no_signal(false)
	for d in _dests:
		_dest.add_item("%s  %d×%d → pgm%d" % [d.get("label", "Screen"), int(d.get("width", 0)), int(d.get("height", 0)),
			int(d.get("mainScreenIndex", 0)) + 1])
	_dlg.get_ok_button().disabled = _dests.is_empty()
	_best_panel()
	_summarise()
	_dlg.popup_centered()
	(func() -> void:
		_dlg.reset_size()
		_dlg.move_to_center()).call_deferred()


func _raster() -> Vector2i:
	var d: Dictionary = _dests[_dest.selected] if _dest.selected >= 0 and _dest.selected < _dests.size() else {}
	return Vector2i(int(d.get("width", 1920)), int(d.get("height", 1080)))


func _role() -> String:
	var d: Dictionary = _dests[_dest.selected] if _dest.selected >= 0 and _dest.selected < _dests.size() else {}
	return "pgm%d" % (int(d.get("mainScreenIndex", 0)) + 1)


## The walls for preset `i` (packed). → {objects, canvas}
func _build(i: int) -> Dictionary:
	var p: Dictionary = S.PANEL_PRESETS[i]
	var existing: Array = _stage_objects()
	var walls := []
	for s in _sel:
		var f: Dictionary = W.turned(s.frame) if _turn.button_pressed else s.frame
		var o := W.wall_object(f, p.px, W.panel_mm_for(f, (s.uuids as Array).size() > 1, p.mm), _role(), existing + walls)
		walls.append(o)
	return W.pack(walls, _raster())


## The finest pitch whose canvas fits the destination (else the coarsest).
func _best_panel() -> void:
	if _sel.is_empty():
		return
	var pick := S.PANEL_PRESETS.size() - 1
	for i in S.PANEL_PRESETS.size():
		if W.fit_note(_build(i).canvas, _raster()) == "":
			pick = i
			break
	_panel.select(pick)


func _summarise() -> void:
	if _sel.is_empty() or _dests.is_empty():
		_sum.text = "No screen destination — add one under Devices." if _dests.is_empty() else ""
		return
	var r := _build(_panel.selected)
	var lines := []
	for o in r.objects:
		var px := S.pixels(o)
		var c: Dictionary = o.source.rect
		lines.append("%d × %d panels of %d × %d mm (%d × %d px) ← crop %d,%d %d × %d" % [int(o.panels[0]), int(o.panels[1]),
			roundi(o.panel_mm[0]), roundi(o.panel_mm[1]), px.x, px.y, int(c.x), int(c.y), int(c.w), int(c.h)])
	var note := W.fit_note(r.canvas, _raster())
	lines.append(note if note != "" else "Canvas %d × %d px on %s (%d × %d)." % [r.canvas.x, r.canvas.y, _role(),
		_raster().x, _raster().y])
	lines.append("Left → right as seen from the audience; edit each crop in the Stage panel to match the sending card.")
	_sum.text = "\n".join(lines)


func _stage_objects() -> Array:
	var previs: Variant = Store.project.get("previs")
	var st: Variant = (previs as Dictionary).get("stage") if previs is Dictionary else null
	return (st as Dictionary).get("objects", []).duplicate(true) if st is Dictionary and (st as Dictionary).get("objects") is Array else []


func _create() -> void:
	var made: Array = _build(_panel.selected).objects
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	previs["stage"] = {"version": 1, "objects": _stage_objects() + made}
	Store.project["previs"] = previs
	var gone := _hidden()
	for s in _sel:
		for u in s.uuids:
			if not gone.has(u):
				gone.append(u)
	_sel = []
	_save_hidden(gone)


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
