extends VBoxContainer
## WO-616 T3b — Inspector page for the previs Camera mode (WO-608 R2: the one Inspector, presented by previs_tab):
## tracking cameras (add / delete / name / source surface / raster), the solved pose + lens, the floor grid, the
## calibration point list (pick the active one, the view's click sets it), Solve (± lens fit) with RMS and per-point
## errors. Owns project.previs.tracking (ProjectSync autosave, client-owned slice WO-607); remote edits reload.
## T5b: Calibrate | Markers — Markers mode swaps the calibration fields for the markers section (markers_section).
## T11: | Follow — the follow patch (follow_section, project.fixtures); markers stay draggable and beams are drawn.
## T12: a "3D stage overlay" toggle + opacity under the modes (the view draws it; previs_tab remembers it).
## T7: | Zones — trigger zones (zones_section, data.zones); while drawing, the view's click adds a floor corner.

const T := preload("res://features/previs/tracking/tracking_model.gd")
const R := preload("res://features/previs/tracking/camera_refine.gd")
const O := preload("res://features/previs/tracking/tracking_overlay.gd")
const MarkersSection := preload("res://features/previs/tracking/markers_section.gd")
const FollowSection := preload("res://features/previs/tracking/follow_section.gd")
const ZonesSection := preload("res://features/previs/tracking/zones_section.gd")
const MI := preload("res://features/previs/tracking/marker_input.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

const ROLES := ["in1", "in2", "in3", "in4", "ch1", "ch2", "ch3", "ch4", "pgm1", "prv1", "pgm2", "prv2"]
## [label, key, min, max, step]
const POSE := [["X m (stage left +)", "pos_x", -200, 200, 0.01], ["Y m (upstage +)", "pos_y", -200, 200, 0.01],
	["Z m (height)", "pos_z", -20, 100, 0.01], ["Pitch °", "pitch", -89, 89, 0.1], ["Yaw °", "yaw", -180, 180, 0.1],
	["Roll °", "roll", -180, 180, 0.1], ["FOV h °", "fov", 10, 170, 0.1], ["Lens k1", "lens_k1", -1, 1, 0.001],
	["Lens k2", "lens_k2", -1, 1, 0.001]]
const GRID := [["Width m", "width", 0.5, 200, 0.1], ["Depth m", "depth", 0.5, 200, 0.1], ["Spacing m", "spacing", 0.1, 50, 0.1],
	["Centre X m", "x_offset", -100, 100, 0.1], ["Centre Y m", "y_offset", -100, 100, 0.1], ["Floor Z m", "z_offset", -10, 50, 0.01]]

signal changed  # data / camera / active point changed → the view redraws
signal ghost_changed(on: bool, opacity: float)  # T12 overlay toggle / opacity

var data := T.normalize({})
var mode := "calibrate"  # | "markers" | "follow" | "zones"
var markers: MarkersSection
var follow: FollowSection
var zones: ZonesSection
var ghost_on := false
var ghost_opacity := 0.6
var _ghost_cb: CheckBox
var _ghost_sl: HSlider
var driver: Node  # marker_driver.gd (previs_tab)
var cam_idx := 0
var active := ""
var objects: Array = []
var _last_json := ""
var _cams: OptionButton
var _name: LineEdit
var _role: OptionButton
var _rw: SpinBox
var _rh: SpinBox
var _pose := {}
var _grid := {}
var _list: ItemList
var _ids: Array = []
var _fit_lens: CheckBox
var _status: Label
var _body: Control
var _confirm: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	add_child(_heading("Tracking cameras (WO-616)"))
	var row := HBoxContainer.new()
	_cams = OptionButton.new()
	_cams.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_cams.item_selected.connect(func(i: int) -> void: _select_cam(i))
	row.add_child(_cams)
	row.add_child(_button("Add", _add_cam))
	row.add_child(_button("Delete", func() -> void: _confirm.popup_centered()))
	add_child(row)
	var modes := HBoxContainer.new()
	var group := ButtonGroup.new()
	for m in ["calibrate", "markers", "follow", "zones"]:
		var b := _button(m.capitalize(), func() -> void: set_mode(m))
		b.toggle_mode = true
		b.button_group = group
		b.button_pressed = m == mode
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		modes.add_child(b)
	add_child(modes)
	var gr := HBoxContainer.new()
	_ghost_cb = CheckBox.new()
	_ghost_cb.text = "3D stage overlay"
	_ghost_cb.tooltip_text = "The previs stage through this camera's solved pose and lens — LED-wall edges must sit on the real walls."
	_ghost_cb.toggled.connect(func(on: bool) -> void:
		ghost_on = on
		ghost_changed.emit(ghost_on, ghost_opacity))
	gr.add_child(_ghost_cb)
	_ghost_sl = HSlider.new()
	_ghost_sl.min_value = 0.05
	_ghost_sl.max_value = 1.0
	_ghost_sl.step = 0.05
	_ghost_sl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_ghost_sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_ghost_sl.tooltip_text = "Overlay opacity"
	_ghost_sl.value_changed.connect(func(v: float) -> void:
		ghost_opacity = v
		ghost_changed.emit(ghost_on, ghost_opacity))
	gr.add_child(_ghost_sl)
	add_child(gr)
	set_ghost(ghost_on, ghost_opacity)
	markers = MarkersSection.new()
	markers.driver = driver
	markers.visible = false
	markers.edit.connect(func(list: Array) -> void:
		data.markers = list
		_persist())
	add_child(markers)
	follow = FollowSection.new()
	follow.driver = driver
	follow.visible = false
	add_child(follow)
	zones = ZonesSection.new()
	zones.driver = driver
	zones.visible = false
	zones.edit.connect(func(z: Dictionary) -> void:
		data["zones"] = z
		_persist())
	zones.drawing_changed.connect(func() -> void: changed.emit())
	add_child(zones)
	_confirm = ConfirmationDialog.new()
	_confirm.dialog_text = "Delete this tracking camera and its calibration?"
	_confirm.confirmed.connect(_delete_cam)
	add_child(_confirm)
	_body = VBoxContainer.new()
	add_child(_body)
	var g := _grid_box()
	_name = LineEdit.new()
	_name.text_submitted.connect(func(v: String) -> void: _edit(func(c: Dictionary) -> void: c.name = v))
	_name.focus_exited.connect(func() -> void: _edit(func(c: Dictionary) -> void: c.name = _name.text))
	_pair(g, "Name", _name)
	_role = OptionButton.new()
	_role.item_selected.connect(func(i: int) -> void: _edit(func(c: Dictionary) -> void: c.role = _role.get_item_text(i)))
	_pair(g, "Source", _role)
	_rw = _spin(16, 16384, 1)
	_rw.value_changed.connect(func(v: float) -> void: _edit(func(c: Dictionary) -> void: c.raster[0] = int(v)))
	_pair(g, "Raster W px", _rw)
	_rh = _spin(16, 16384, 1)
	_rh.value_changed.connect(func(v: float) -> void: _edit(func(c: Dictionary) -> void: c.raster[1] = int(v)))
	_pair(g, "Raster H px", _rh)
	for f in POSE:
		var sb := _spin(f[2], f[3], f[4])
		var key: String = f[1]
		sb.value_changed.connect(func(v: float) -> void: _edit(func(c: Dictionary) -> void: c.cam[key] = v))
		_pose[key] = sb
		_pair(g, f[0], sb)
	_body.add_child(g)
	_body.add_child(_heading("Calibration points"))
	_list = ItemList.new()
	_list.custom_minimum_size.y = 260
	_list.item_selected.connect(func(i: int) -> void: pick(str(_ids[i])))
	_body.add_child(_list)
	var pr := HBoxContainer.new()
	pr.add_child(_button("Clear click", func() -> void: _clear(false)))
	pr.add_child(_button("Clear all", func() -> void: _clear(true)))
	_body.add_child(pr)
	var sr := HBoxContainer.new()
	_fit_lens = CheckBox.new()
	_fit_lens.text = "Fit lens"
	_fit_lens.tooltip_text = "Also solve k1 (and k2 with 8+ points). Click many grid crossings spread over the picture."
	sr.add_child(_fit_lens)
	sr.add_child(_button("Solve", solve))
	_body.add_child(sr)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_body.add_child(_status)
	_body.add_child(_heading("Floor grid"))
	var gg := _grid_box()
	for f in GRID:
		var sb := _spin(f[2], f[3], f[4])
		var key: String = f[1]
		sb.value_changed.connect(func(v: float) -> void: _edit_grid(key, v))
		_grid[key] = sb
		_pair(gg, f[0], sb)
	_body.add_child(gg)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _maybe_reload())
	_maybe_reload()
	_sync()


## Initial overlay state (previs_tab's ui.cfg) — no signal.
func set_ghost(on: bool, opacity: float) -> void:
	ghost_on = on
	ghost_opacity = opacity
	if _ghost_cb != null:
		_ghost_cb.set_pressed_no_signal(on)
		_ghost_sl.set_value_no_signal(opacity)


func set_mode(m: String) -> void:
	mode = m
	if zones != null and m != "zones":
		zones.set_drawing(false)
	_sync()
	changed.emit()


func entry() -> Dictionary:
	var cams: Array = data.cameras
	return cams[cam_idx] if cam_idx >= 0 and cam_idx < cams.size() else {}


func set_objects(objs: Array) -> void:
	objects = objs
	_sync_points()
	changed.emit()


func pick(id: String) -> void:
	active = id
	_sync_points()
	changed.emit()


## The view's click (raster px): set the active point there, then make the next unclicked point active.
func click(px: Vector2) -> void:
	var ce := entry()
	if mode == "zones":
		var hit: Variant = MI.floor_point(ce, px, float(data.grid.z_offset)) if not ce.is_empty() else null
		if hit != null:
			zones.add_point(hit)
		return
	if ce.is_empty() or active == "":
		return
	var cand := _candidate(active)
	if cand.is_empty():
		return
	data.cameras[cam_idx] = T.set_point(ce, active, cand.label, cand.world, [snappedf(px.x, 0.01), snappedf(px.y, 0.01)])
	var pts := O.points(data, entry(), objects)
	var at := pts.map(func(p: Dictionary) -> String: return p.id).find(active)
	for i in range(at + 1, pts.size()):
		if pts[i].click == null and pts[i].shown != null:
			active = pts[i].id
			break
	_persist()


## Picture size from the live surface: adopt it while nothing is clicked (clicks are in raster pixels).
func adopt_size(sz: Vector2i) -> void:
	var ce := entry()
	if ce.is_empty() or Vector2i(ce.raster[0], ce.raster[1]) == sz:
		return
	if T.clicked(ce).is_empty():
		_edit(func(c: Dictionary) -> void: c.raster = [sz.x, sz.y])
	else:
		_status.text = "The source is %d×%d but this camera was clicked at %d×%d — clear the points or set the raster." % [sz.x, sz.y, ce.raster[0], ce.raster[1]]


func solve() -> void:
	var ce := entry()
	if ce.is_empty():
		return
	var r := R.calibrate(ce.cam, T.clicked(ce), float(ce.raster[0]), float(ce.raster[1]), {"fit_lens": _fit_lens.button_pressed})
	if not r.ok:
		_status.text = "Not solved: %s" % r.error
		return
	_edit(func(c: Dictionary) -> void:
		c.cam = r.cam
		c.rms = r.rms)
	var worst := 0.0
	for e in r.errors:
		worst = maxf(worst, e)
	_status.text = "RMS %.2f px · worst %.2f px · %d points · %s%s" % [r.rms, worst, r.errors.size(), r.method,
		" · lens k1 %.4f k2 %.4f" % [r.cam.lens_k1, r.cam.lens_k2] if _fit_lens.button_pressed else ""]


func _candidate(id: String) -> Dictionary:
	for p in T.candidate_points(data, objects):
		if p.id == id:
			return p
	for p in entry().get("points", []):
		if p.id == id:
			return p
	return {}


func _clear(all: bool) -> void:
	var ce := entry()
	if ce.is_empty():
		return
	if all:
		_edit(func(c: Dictionary) -> void:
			c.points = []
			c.rms = -1.0)
	elif active != "":
		var cand := _candidate(active)
		if not cand.is_empty():
			data.cameras[cam_idx] = T.set_point(ce, active, cand.label, cand.world, null)
			_persist()


func _add_cam() -> void:
	var role := "in1"
	for r in ["in1", "in2", "ch1", "pgm1"]:
		var d: Variant = VideoSurfaces.descriptors.get(r)
		if d is Dictionary and (d as Dictionary).get("channel") != null:
			role = r
			break
	data.cameras.append(T.new_camera(data.cameras, role))
	cam_idx = data.cameras.size() - 1
	active = ""
	_persist()


func _delete_cam() -> void:
	if entry().is_empty():
		return
	data.cameras.remove_at(cam_idx)
	cam_idx = clampi(cam_idx, 0, maxi(0, data.cameras.size() - 1))
	active = ""
	_persist()


func _select_cam(i: int) -> void:
	cam_idx = i
	active = ""
	_status.text = ""
	_sync()
	changed.emit()


func _edit(mutate: Callable) -> void:
	var ce := entry()
	if ce.is_empty():
		return
	var c := ce.duplicate(true)
	mutate.call(c)
	data.cameras[cam_idx] = T.normalize_camera(c)
	_persist()


func _edit_grid(key: String, v: float) -> void:
	data.grid[key] = v
	data.grid = T.normalize_grid(data.grid)
	_persist()


func _maybe_reload() -> void:
	var pv: Variant = Store.project.get("previs")
	var src: Variant = (pv as Dictionary).get("tracking") if pv is Dictionary else null
	var js := _canon(src if src != null else {})
	if js == _last_json:
		return
	_last_json = js
	data = T.normalize(src)
	cam_idx = clampi(cam_idx, 0, maxi(0, data.cameras.size() - 1))
	_sync()
	changed.emit()


func _persist() -> void:
	var previs: Dictionary = Store.project.get("previs", {}) if Store.project.get("previs") is Dictionary else {}
	previs["tracking"] = data.duplicate(true)
	Store.project["previs"] = previs
	_last_json = _canon(previs.tracking)
	ProjectSync.mark_dirty()
	_sync()
	changed.emit()


static func _canon(v: Variant) -> String:
	return JSON.stringify(JSON.parse_string(JSON.stringify(v)))


## Fields ← data (no signals, so syncing never re-edits).
func _sync() -> void:
	if _cams == null:
		return
	_cams.clear()
	for c in data.cameras:
		_cams.add_item("%s · %s" % [c.name, c.role])
	var ce := entry()
	_body.visible = not ce.is_empty() and mode == "calibrate"
	markers.visible = mode == "markers"
	follow.visible = mode == "follow"
	zones.visible = mode == "zones"
	zones.set_zones(data.get("zones"))
	markers.set_defs(data.markers)
	for k in _grid:
		(_grid[k] as SpinBox).set_value_no_signal(float(data.grid[k]))
	if ce.is_empty():
		return
	_cams.select(cam_idx)
	if not _name.has_focus():
		_name.text = ce.name
	_role.clear()
	var roles: Array = ROLES.duplicate()
	if not roles.has(ce.role):
		roles.append(ce.role)
	for r in roles:
		_role.add_item(r)
	_role.select(roles.find(ce.role))
	_rw.set_value_no_signal(ce.raster[0])
	_rh.set_value_no_signal(ce.raster[1])
	for k in _pose:
		(_pose[k] as SpinBox).set_value_no_signal(float(ce.cam[k]))
	_sync_points()


func _sync_points() -> void:
	if _list == null:
		return
	_list.clear()
	_ids.clear()
	var ce := entry()
	if ce.is_empty():
		return
	var n := 0
	for p in O.points(data, ce, objects):
		var mark := "●" if p.click != null else "○"
		var err := "  %.1f px" % p.err if p.err >= 0.0 else ("  (off picture)" if p.shown == null else "")
		_list.add_item("%s %s%s" % [mark, p.label, err])
		_ids.append(p.id)
		if p.id == active:
			_list.select(_list.item_count - 1)
		if p.click != null:
			n += 1
	if _status.text == "" or not _status.text.begins_with("RMS"):
		_status.text = "%d point(s) clicked — Solve needs 4 (lens fit: 8+, spread out)." % n


func _heading(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	return l


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b


func _grid_box() -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	return g


func _pair(g: GridContainer, text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)


static func _spin(lo: float, hi: float, step: float) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = step
	sb.custom_minimum_size.x = 110
	sb.update_on_text_changed = true
	return sb
