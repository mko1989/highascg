extends VBoxContainer
## WO-614 T4 — previs "Stage" panel: add LED walls / TVs / projection (also sized from a screen
## destination), object list, per-type inspector. Objects persist in project.previs.stage.objects through
## ProjectSync autosave (server keeps the key — verified 2026-10-17); remote edits reload the stage.

const S := preload("res://features/previs/stage_objects.gd")
const StageBuilder := preload("res://features/previs/stage_builder.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const ROLES := ["opgui", "pgm1", "prv1", "pgm2", "prv2", "pgm3", "prv3", "pgm4", "prv4"]

## [label, key, index (-1 = scalar), kind ("f" float, "i" int, "b" bool, "s" text), min, max, step]
const COMMON := [["Name", "name", -1, "s"], ["X m", "position", 0, "f", -500, 500, 0.01], ["Y m (height)", "position", 1, "f", -50, 200, 0.01],
	["Z m", "position", 2, "f", -500, 500, 0.01], ["Yaw °", "rotation", 1, "f", -360, 360, 1], ["Tilt °", "rotation", 0, "f", -90, 90, 1]]
const FIELDS := {
	"led_wall": [["Panel px W", "panel_px", 0, "i", 1, 4096, 1], ["Panel px H", "panel_px", 1, "i", 1, 4096, 1],
		["Panel mm W", "panel_mm", 0, "f", 10, 4000, 0.5], ["Panel mm H", "panel_mm", 1, "f", 10, 4000, 0.5],
		["Panels wide", "panels", 0, "i", 1, 200, 1], ["Panels high", "panels", 1, "i", 1, 200, 1], ["Curve °/panel", "curve_deg", -1, "f", -30, 30, 0.5]],
	"tv": [["Diagonal in", "diagonal_in", -1, "f", 5, 300, 1], ["Aspect W", "aspect", 0, "f", 1, 100, 1], ["Aspect H", "aspect", 1, "f", 1, 100, 1],
		["Res W", "resolution", 0, "i", 1, 16384, 1], ["Res H", "resolution", 1, "i", 1, 16384, 1], ["Portrait", "portrait", -1, "b"], ["Bezel mm", "bezel_mm", -1, "f", 0, 200, 1]],
	"projection": [["Screen W m", "screen_m", 0, "f", 0.1, 100, 0.05], ["Screen H m", "screen_m", 1, "f", 0.1, 100, 0.05], ["Rear", "rear", -1, "b"],
		["Throw ratio", "throw", -1, "f", 0.1, 20, 0.05], ["Lens shift V", "lens_shift_v", -1, "f", -2, 2, 0.05],
		["Res W", "resolution", 0, "i", 1, 16384, 1], ["Res H", "resolution", 1, "i", 1, 16384, 1], ["Brightness", "brightness", -1, "f", 0, 4, 0.05]],
}
signal stage_loaded(count: int)
signal stage_changed            # any edit/reload (WO-617: the 2D view redraws from builder.objects)
signal selection_changed(id: String)

const RECT := [["Crop X px", "x"], ["Crop Y px", "y"], ["Crop W px", "w"], ["Crop H px", "h"]]

var builder: StageBuilder
var _list: ItemList
var _add: MenuButton
var _inspector: GridContainer
var _info: Label
var _selected := ""
var _last_json := ""
var _dests: Array = []


func bind(b: StageBuilder) -> void:
	builder = b
	Store.project_changed.connect(func(_p: Dictionary) -> void: _maybe_reload())
	_maybe_reload()


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var row := HBoxContainer.new()
	_add = MenuButton.new()
	_add.text = "Add ▾"
	_add.flat = false
	_add.about_to_popup.connect(_fill_add_menu)
	_add.get_popup().id_pressed.connect(_on_add)
	row.add_child(_add)
	for spec in [["Duplicate", _duplicate], ["Array…", _array_dialog], ["Delete", _delete]]:
		var b := Button.new()
		b.text = spec[0]
		b.pressed.connect(spec[1])
		row.add_child(b)
	add_child(row)
	_list = ItemList.new()
	_list.custom_minimum_size.y = 110
	_list.item_selected.connect(func(i: int) -> void: _select(str(builder.objects[i].id)))
	add_child(_list)
	_info = Label.new()
	_info.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD
	add_child(_info)
	_inspector = GridContainer.new()
	_inspector.columns = 2
	add_child(_inspector)


func _fill_add_menu() -> void:
	var p := _add.get_popup()
	p.clear()
	p.add_item("LED wall", 0)
	p.add_item("TV", 1)
	p.add_item("Projection", 2)
	p.add_separator("Templates")
	var names: Array = S.TEMPLATES.keys()
	for i in names.size():
		p.add_item(S.TEMPLATES[names[i]], 200 + i)
	_load_dests()
	if not _dests.is_empty():
		p.add_separator("Sized from a screen destination")
		for i in _dests.size():
			var d: Dictionary = _dests[i]
			for k in 3:
				p.add_item("%s  %d×%d → %s" % [d.get("label", "Screen"), int(d.get("width", 0)), int(d.get("height", 0)), ["LED wall", "TV", "Projection"][k]], 100 + i * 3 + k)


## Menu ids: 0 LED wall, 1 TV, 2 projection, 100 + dest*3 + type (from destination), 200+ templates
## (ids 0-2 also used by the --probe-stage-add dev flag).
func _load_dests() -> void:
	var sd: Variant = Settings.get_setting("screenDestinations", {})
	_dests = (sd as Dictionary).get("destinations", []) if sd is Dictionary else []


func _on_add(id: int) -> void:
	if id >= 100 and id < 200:
		_load_dests()
		if (id - 100) / 3 >= _dests.size():
			return
	if id >= 200:
		var role := _default_role()
		_add_many(S.template(S.TEMPLATES.keys()[id - 200], builder.objects, role, _role_raster(role)), true)
		return
	var o: Dictionary
	if id >= 100:
		o = S.from_destination(_dests[(id - 100) / 3], S.TYPES[(id - 100) % 3], builder.objects)
	else:
		o = S.new_object(S.TYPES[id], builder.objects)
		var role := _default_role()
		var r := _role_raster(role)
		o["source"] = {"role": role, "rect": {"x": 0, "y": 0, "w": r.x, "h": r.y}}
	o["position"] = [_free_x(), 0.0, 0.0]
	_add_many([o], false)


## Upsert several new objects, persist once, select the last. `shift` moves the group right of the stage.
func _add_many(list: Array, shift: bool) -> void:
	var dx := 0.0
	if shift and not builder.objects.is_empty():
		var lo := INF
		for o in list:
			lo = minf(lo, S.front_rect(o).position.x)
		dx = _free_x() - lo
	var last := ""
	for o in list:
		var c: Dictionary = o.duplicate(true)
		c["position"] = [snappedf(float(c.position[0]) + dx, 0.01), c.position[1], c.position[2]]
		last = builder.upsert(c).id
	_persist()
	_refresh_list()
	_select(last)


## Picture size of a role: the screen destination behind pgm<N>/prv<N>, else the live texture, else 1080p.
func _role_raster(role: String) -> Vector2i:
	_load_dests()
	if role.begins_with("pgm") or role.begins_with("prv"):
		var n := int(role.substr(3)) - 1
		for d in _dests:
			if str(d.get("mode", "")) != "operator_gui" and int(d.get("mainScreenIndex", -1)) == n:
				return Vector2i(int(d.get("width", 1920)), int(d.get("height", 1080)))
	var tex := VideoSurfaces.texture(role)
	if tex != null and tex.get_width() > 0:
		return Vector2i(tex.get_width(), tex.get_height())
	return Vector2i(1920, 1080)


## Role for new objects: the first PGM surface the server maps to a channel, else the operator surface.
func _default_role() -> String:
	for role in ["pgm1", "pgm2", "pgm3", "pgm4"]:
		var d: Variant = VideoSurfaces.descriptors.get(role)
		if d is Dictionary and (d as Dictionary).get("channel") != null:
			return role
	return "opgui"


func _duplicate() -> void:
	var i := builder.index_of(_selected)
	if i >= 0:
		_add_many(S.array_copies(builder.objects[i], 1, 0.5, builder.objects), false)


func _array_dialog() -> void:
	var i := builder.index_of(_selected)
	if i < 0:
		return
	var dlg := ConfirmationDialog.new()
	dlg.title = "Array copies of %s" % builder.objects[i].name
	var g := GridContainer.new()
	g.columns = 2
	var count := _spin(1, 50, 1, 3)
	var gap := _spin(0, 20, 0.05, 0.5)
	for pair in [["Copies", count], ["Gap m", gap]]:
		var l := Label.new()
		l.text = pair[0]
		g.add_child(l)
		g.add_child(pair[1])
	dlg.add_child(g)
	dlg.confirmed.connect(func() -> void:
		_add_many(S.array_copies(builder.objects[builder.index_of(_selected)], int(count.value), gap.value, builder.objects), false)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## Public (keyboard / 2D view): move the selection by a delta in metres, or turn it.
func nudge(delta: Vector3) -> void:
	_edit(func(x: Dictionary) -> void:
		x.position = [snappedf(float(x.position[0]) + delta.x, 0.001), snappedf(float(x.position[1]) + delta.y, 0.001), snappedf(float(x.position[2]) + delta.z, 0.001)])
	_build_inspector()


func turn(yaw_deg: float, absolute := false) -> void:
	_edit(func(x: Dictionary) -> void:
		var y := yaw_deg if absolute else float(x.rotation[1]) + yaw_deg
		x.rotation = [x.rotation[0], wrapf(snappedf(y, 0.5), -180.0, 180.0), x.rotation[2]])
	_build_inspector()


func selected_id() -> String:
	return _selected


func delete_selected() -> void:
	_delete()


func duplicate_selected() -> void:
	_duplicate()


func _delete() -> void:
	if _selected == "":
		return
	builder.remove(_selected)
	_selected = ""
	_persist()
	_refresh_list()
	_build_inspector()


## Place a new object to the right of everything already on stage.
func _free_x() -> float:
	if builder.objects.is_empty():
		return 0.0
	var b := builder.bounds()
	return b.end.x + 2.5


## Public: select from outside (2D view click).
func select(id: String) -> void:
	_select(id)


## Public: 2D drag-move finished → same path as an inspector edit (rebuild + persist).
func move_object(id: String, position: Array) -> void:
	var keep := _selected
	_selected = id
	_edit(func(x: Dictionary) -> void: x.position = position)
	_selected = keep
	if keep == id:
		_build_inspector()


func _select(id: String) -> void:
	_selected = id
	selection_changed.emit(id)
	var i := builder.index_of(id)
	if i >= 0:
		_list.select(i)
	_build_inspector()


func _build_inspector() -> void:
	for c in _inspector.get_children():
		c.queue_free()
	var i := builder.index_of(_selected)
	if i < 0:
		_info.text = "%d object(s). Add ▾ creates LED walls, TVs, projection." % builder.objects.size()
		return
	var o: Dictionary = builder.objects[i]
	for f in COMMON + FIELDS.get(str(o.type), []):
		_field(o, f)
	_label("Source")
	var role := OptionButton.new()
	for r in ROLES:
		role.add_item(r)
	role.select(maxi(0, ROLES.find(str(o.source.role))))
	role.item_selected.connect(func(k: int) -> void: _edit(func(x: Dictionary) -> void: x.source.role = ROLES[k]))
	_inspector.add_child(role)
	for r in RECT:
		_label(r[0])
		var sb := _spin(0, 16384, 1, float(o.source.rect[r[1]]))
		var key: String = r[1]
		sb.value_changed.connect(func(v: float) -> void: _edit(func(x: Dictionary) -> void: x.source.rect[key] = int(v)))
		_inspector.add_child(sb)
	_update_info(o)


func _field(o: Dictionary, f: Array) -> void:
	_label(f[0])
	var key: String = f[1]
	var idx: int = f[2]
	var cur: Variant = o[key] if idx < 0 else o[key][idx]
	match str(f[3]):
		"s":
			var le := LineEdit.new()
			le.text = str(cur)
			le.text_submitted.connect(func(v: String) -> void: _edit(func(x: Dictionary) -> void: x[key] = v))
			le.focus_exited.connect(func() -> void: _edit(func(x: Dictionary) -> void: x[key] = le.text))
			_inspector.add_child(le)
		"b":
			var cb := CheckBox.new()
			cb.button_pressed = cur == true
			cb.toggled.connect(func(v: bool) -> void: _edit(func(x: Dictionary) -> void: x[key] = v))
			_inspector.add_child(cb)
		_:
			var sb := _spin(f[4], f[5], f[6], float(cur))
			var as_int: bool = f[3] == "i"
			sb.value_changed.connect(func(v: float) -> void: _edit(func(x: Dictionary) -> void:
				var val: Variant = int(v) if as_int else v
				if idx < 0:
					x[key] = val
				else:
					x[key][idx] = val))
			_inspector.add_child(sb)


func _edit(mutate: Callable) -> void:
	var i := builder.index_of(_selected)
	if i < 0:
		return
	var o: Dictionary = builder.objects[i].duplicate(true)
	mutate.call(o)
	o = builder.upsert(o)
	_list.set_item_text(i, _item_text(o))
	_update_info(o)
	_persist()


func _update_info(o: Dictionary) -> void:
	var s := S.size_m(o)
	var px := S.pixels(o)
	var t := "%.2f × %.2f m · %d×%d px" % [s.x, s.y, px.x, px.y]
	if str(o.type) == "led_wall":
		var p := S.pitch_mm(o)
		t += " · P%.2f" % p.x + ("" if S.pitch_is_square(o) else " / P%.2f (non-square pitch!)" % p.y)
	_info.text = t


func _maybe_reload() -> void:
	var stage: Variant = (Store.project.get("previs", {}) as Dictionary).get("stage", {}) if Store.project.get("previs") is Dictionary else {}
	var list: Array = (stage as Dictionary).get("objects", []) if stage is Dictionary else []
	var js := _canon(list)
	if js == _last_json:
		return  # our own save echoing back, or nothing changed
	_last_json = js
	builder.set_objects(list)
	_refresh_list()
	stage_loaded.emit(builder.objects.size())
	stage_changed.emit()
	_select(_selected if builder.index_of(_selected) >= 0 else "")


func _persist() -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	previs["stage"] = {"version": 1, "objects": builder.objects.duplicate(true)}
	Store.project["previs"] = previs
	_last_json = _canon(builder.objects)
	ProjectSync.mark_dirty()
	stage_changed.emit()


## JSON parse turns every number into a float, so compare both sides after one parse round trip.
static func _canon(v: Variant) -> String:
	return JSON.stringify(JSON.parse_string(JSON.stringify(v)))


func _refresh_list() -> void:
	_list.clear()
	for o in builder.objects:
		_list.add_item(_item_text(o))


func _item_text(o: Dictionary) -> String:
	var px := S.pixels(o)
	return "%s  ·  %s  %d×%d  → %s" % [o.name, {"led_wall": "LED", "tv": "TV", "projection": "PROJ"}.get(str(o.type), "?"), px.x, px.y, o.source.role]


func _label(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_inspector.add_child(l)


static func _spin(lo: float, hi: float, step: float, v: float) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = step
	sb.value = v
	sb.custom_minimum_size.x = 110
	sb.update_on_text_changed = true
	return sb
