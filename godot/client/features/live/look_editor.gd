extends VBoxContainer
## WO-600 F — look editor: compose frame over the live PRV picture + layer list. Edits mutate the look in
## Store.project and are pushed by PreviewPusher (deck sync → /api/scene/preview-push → autosave). Math = compose_math.gd.

signal closed
signal take_requested(scene_id: String, main: int)

const C := preload("res://features/live/compose_math.gd")
const Pusher := preload("res://features/live/preview_pusher.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const E := preload("res://features/live/look_edits.gd")
const LayerInspector := preload("res://features/live/layer_inspector.gd")
const Geometry := preload("res://features/live/layer_geometry_section.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const Fit := preload("res://features/live/look_editor_fit.gd")  # WO-653: boxes = what Caspar shows
const View := preload("res://features/live/look_editor_view.gd")  # WO-654: wheel zoom / middle-drag pan
const Ops := preload("res://features/live/look_layer_ops.gd")  # WO-657: mirror copy, layer names
const Drop := preload("res://features/live/look_layer_drop.gd")  # WO-816: Sources drops (exchange on a layer / add)
const Audio := preload("res://features/live/look_layer_audio.gd")  # WO-817: audio-only layers: not drawn / picked in the frame
const HANDLE := 8.0

var scene_id := ""
var main := 0
var pusher: Pusher
var _title: Label
var _frame: Control
var _video: TextureRect
var _overlay: Control  # boxes/handles — a child AFTER the video, so it paints on top of it
var _list: ItemList
var _fields := {}
var _sel := -1            # selected layer index
var _drag := {}
var _role := ""
var _status: Label
var _inspector: LayerInspector
var _geo: Geometry
var _page: VBoxContainer  # WO-608 R2: geometry + layer inspector, shown in the global Inspector while a layer is selected
var _crop_mode := false
var _crop_btn: Button
var _fit := Fit.new()
var _view := View.new()
const CROP_COLOR := Color("#e3b341")


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	pusher = Pusher.new()
	add_child(pusher)
	pusher.pushed.connect(func(r: Dictionary) -> void:
		_status.text = "PRV: %s" % (pusher.last_mode if r.ok else "push failed (%s)" % r.error))
	var head := HBoxContainer.new()
	_title = Label.new()
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	var take := Button.new()  # WO-651: the deck (and its TAKE) is hidden while the editor is open
	take.text = "TAKE"
	take.tooltip_text = "Take this look to PGM"
	take.pressed.connect(_take)
	head.add_child(take)
	var close := Button.new()
	close.text = "Close"
	close.pressed.connect(close_editor)
	head.add_child(close)
	add_child(head)
	_frame = Control.new()
	_frame.custom_minimum_size = Vector2(480, 270)
	_frame.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_frame.clip_contents = true
	_frame.gui_input.connect(_frame_input)
	_video = TextureRect.new()
	_video.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_video.stretch_mode = TextureRect.STRETCH_SCALE
	_video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_frame.add_child(_video)
	_overlay = Control.new()
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_overlay.draw.connect(_draw_frame)
	_frame.add_child(_overlay)
	_frame.set_drag_forwarding(Callable(), _can_drop, _drop)
	add_child(_frame)
	var ops := HBoxContainer.new()
	for spec in [["Remove layer", _remove_layer], ["▲ Up", func() -> void: _move_layer(1)], ["▼ Down", func() -> void: _move_layer(-1)],
			["Fit", func() -> void: _view.reset()], ["Mirror copy", _mirror_copy]]:  # WO-657
		var bt := Button.new()
		bt.text = spec[0]
		bt.pressed.connect(spec[1])
		ops.add_child(bt)
	_crop_btn = Button.new()
	_crop_btn.text = "Crop"
	_crop_btn.toggle_mode = true
	_crop_btn.tooltip_text = "Crop the selected layer: handles move onto the cropped outline (adds a crop effect)"
	_crop_btn.toggled.connect(_set_crop_mode)
	ops.add_child(_crop_btn)
	var rc := Button.new()
	rc.text = "Reset crop"
	rc.pressed.connect(_reset_crop)
	ops.add_child(rc)
	add_child(ops)
	_list = ItemList.new()
	_list.custom_minimum_size.y = 90
	_list.item_selected.connect(func(i: int) -> void: _select(i))
	_list.set_drag_forwarding(Callable(), _can_drop, _drop.bind(true))  # WO-766 add / WO-816 exchange on a row
	add_child(_list)
	_geo = Geometry.new()  # WO-621 N2: canvas px + aspect lock (was raw 0–1 fill fields)
	_geo.patch.connect(func(p: Dictionary) -> void: _apply_layer(p))
	var g := GridContainer.new()
	g.columns = 4
	var ol := Label.new()
	ol.text = "Opacity"
	g.add_child(ol)
	var sb := SpinBox.new()
	sb.step = 0.001
	sb.max_value = 1
	sb.value_changed.connect(func(v: float) -> void: _set_field("opacity", v))
	g.add_child(sb)
	_fields["opacity"] = sb
	_page = VBoxContainer.new()
	_page.visible = false
	_page.add_child(_geo)
	_page.add_child(g)
	_inspector = LayerInspector.new()
	_geo.content = func() -> Vector2: return _inspector.content_known
	_inspector.visible = false
	_inspector.patch.connect(func(p: Dictionary) -> void: _apply_layer(p))
	_inspector.status.connect(func(t: String) -> void: _status.text = t)
	_page.add_child(_inspector)
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	visibility_changed.connect(func() -> void: _hold(is_visible_in_tree()))
	Store.project_changed.connect(func(_p: Dictionary) -> void:
		if visible:
			_refresh_list())


func open(look_id: String, main_idx: int) -> void:
	scene_id = look_id
	main = main_idx
	_view.reset()
	_role = "prv%d" % (main + 1)
	_video.texture = VideoSurfaces.texture(_role)
	visible = true
	_hold(true)
	_sel = -1
	_refresh_list()
	_select(-1)  # a previous look's layer must not stay in the Inspector
	if _layers().any(func(l: Variant) -> bool: return l is Dictionary and (l as Dictionary).get("source") is Dictionary):
		pusher.schedule(scene_id, main)  # stage it on PRV (re-take or nudge, server decides)
	else:  # WO-623 B: a new empty look (deck "+") — the web stages nothing; the take route refuses a look with no sources
		_status.text = "Empty look — drop a source on the frame to stage it on PRV"


## The look is already staged on PRV by the pushes; the live tab takes it like the deck's TAKE.
func _take() -> void:
	ProjectSync.send_deck_sync(true)  # an edit still inside the push debounce reaches the server first
	take_requested.emit(scene_id, main)


func show_status(text: String) -> void: _status.text = text


func close_editor() -> void:
	_hold(false)
	visible = false
	_release_page()
	closed.emit()


func look() -> Dictionary:
	for s in (Store.project.get("scenes", {}) as Dictionary).get("scenes", []):
		if s is Dictionary and str(s.get("id", "")) == scene_id:
			return s
	return {}


func _layers() -> Array:
	return look().get("layers", []) if look().get("layers") is Array else []


func _canvas() -> Vector2:
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var rl: Variant = cm.get("programResolutions", [])
	if rl is Array and main < (rl as Array).size() and rl[main] is Dictionary:
		return Vector2(float(rl[main].get("w", 1920)), float(rl[main].get("h", 1080)))
	return Vector2(1920, 1080)


func _shown(l: Dictionary) -> Dictionary: return _fit.shown_fill(scene_id, main, l, _canvas())


func _box() -> Rect2: return _view.box(_frame.size, _canvas())  # the canvas in the frame: letterboxed, zoomed, panned


func _fill_rect(f: Dictionary) -> Rect2:
	var b := _box()
	return Rect2(b.position + Vector2(float(f.get("x", 0)), float(f.get("y", 0))) * b.size, Vector2(float(f.get("scaleX", 1)), float(f.get("scaleY", 1))) * b.size)


## WO-635: a layer's chrome is drawn under C.layer_xform (its rotation about the fill centre, as Caspar turns it) and
## the pointer is mapped back through it.
static func _deg(l: Dictionary) -> float:
	return float(l.get("rotation", 0.0)) if l.get("rotation") != null else 0.0


func _process(_d: float) -> void:
	if visible:
		var b := _box()
		_video.position = b.position
		_video.size = b.size
		_overlay.queue_redraw()


func _draw_frame() -> void:
	var b := _box()
	_overlay.draw_rect(b, Color(1, 1, 1, 0.25), false, 1.0)
	var layers := _layers()
	var lk := look()
	for i in layers.size():
		var l: Dictionary = layers[i]
		if not (l.get("source") is Dictionary) or str(l.source.get("value", "")) == "" or Audio.is_audio_only(l, lk):
			continue
		var r := _fill_rect(_shown(l))
		var sel := i == _sel
		_overlay.draw_set_transform_matrix(C.layer_xform(r, _deg(l)))
		_overlay.draw_rect(r, ThemeBuilder.ACCENT if sel else Color(1, 1, 1, 0.6), false, 2.0 if sel else 1.0)
		_overlay.draw_string(get_theme_default_font(), r.position + Vector2(4, 14), "L%d %s" % [int(l.get("layerNumber", 0)), Ops.layer_name(l.source)], HORIZONTAL_ALIGNMENT_LEFT, r.size.x - 8, 12, Color.WHITE)
		var crop: Variant = _crop_of(l)
		if crop != null:
			_overlay.draw_rect(_crop_rect(r, crop), CROP_COLOR, false, 1.5)
		if sel:
			var hr := _crop_rect(r, crop if crop != null else C.normalize_crop({})) if _crop_mode else r
			var hc := CROP_COLOR if _crop_mode else ThemeBuilder.ACCENT
			for p in _handles(hr).values():
				_overlay.draw_rect(Rect2(p - Vector2(HANDLE, HANDLE) / 2.0, Vector2(HANDLE, HANDLE)), hc)
		_overlay.draw_set_transform_matrix(Transform2D.IDENTITY)


func _handles(r: Rect2) -> Dictionary:
	var c := r.get_center()
	return {"nw": r.position, "n": Vector2(c.x, r.position.y), "ne": Vector2(r.end.x, r.position.y), "e": Vector2(r.end.x, c.y),
		"se": r.end, "s": Vector2(c.x, r.end.y), "sw": Vector2(r.position.x, r.end.y), "w": Vector2(r.position.x, c.y)}


func _frame_input(event: InputEvent) -> void:
	if _view.input(event, _frame.size, _canvas()):
		return _frame.accept_event()
	var mb := event as InputEventMouseButton
	if mb != null and mb.button_index == MOUSE_BUTTON_LEFT:
		if mb.pressed:
			_begin_drag(mb.position)
		else:
			_drag = {}
	var mm := event as InputEventMouseMotion
	if mm != null and not _drag.is_empty():
		var b := _box()
		var from: Vector2 = _drag.start
		var d: Vector2 = (mm.position - from) / b.size
		var local: Vector2 = (mm.position - from).rotated(-deg_to_rad(float(_drag.get("deg", 0.0))))  # a turned layer's own axes
		if _drag.get("is_crop", false):
			var lp: Vector2 = _drag.layer_px
			var cd: Vector2 = local / Vector2(maxf(1.0, lp.x), maxf(1.0, lp.y))
			_set_crop(C.crop_delta(_drag.edge, _drag.crop, cd.x, cd.y))
			return
		var start: Dictionary = _drag.fill
		var f: Dictionary
		if _drag.edge == "":
			f = C.move_fill(start, d.x, d.y, _others_fills(_sel), 10.0 / b.size.x, 10.0 / b.size.y)
		else:
			d = local / b.size
			var xs := _snap_candidates(true)
			var ys := _snap_candidates(false)
			var tx := 10.0 / b.size.x
			var ty := 10.0 / b.size.y
			var locked: bool = _layers()[_sel].get("aspectLocked") != false and not mm.shift_pressed  # web: layer lock && !Shift
			f = C.edge_resize(_drag.edge, start, d.x, d.y, locked, 0.02,
				func(v: float) -> float: return C.snap_value(v, xs, tx), func(v: float) -> float: return C.snap_value(v, ys, ty))
		_apply_layer({"fill": f})


func _begin_drag(at: Vector2) -> void:
	var layers := _layers()
	if _sel >= 0 and _sel < layers.size() and not Audio.is_audio_only(layers[_sel], look()):  # no handles drawn → none to grab
		var r := _fill_rect(_shown(layers[_sel]))
		var deg := _deg(layers[_sel])
		var lat := C.layer_xform(r, deg).affine_inverse() * at  # the pointer in the layer's unrotated frame
		if _crop_mode:
			var cr: Variant = _crop_of(layers[_sel])
			var hs_c := _handles(_crop_rect(r, cr if cr != null else C.normalize_crop({})))
			for k in hs_c:
				if (hs_c[k] as Vector2).distance_to(lat) <= HANDLE:
					_drag = {"start": at, "crop": cr if cr != null else C.normalize_crop({}), "layer_px": r.size, "edge": k, "is_crop": true, "deg": deg}
					return
		var hs := _handles(r)
		for k in hs:
			if (hs[k] as Vector2).distance_to(lat) <= HANDLE:
				_drag = {"start": at, "fill": _shown(layers[_sel]).duplicate(), "edge": k, "deg": deg}
				return
	var hit := Audio.pick(layers, look(), func(l: Dictionary) -> Rect2: return _fill_rect(_shown(l)), at)  # only the list selects audio
	if hit >= 0:
		_select(hit)
		_drag = {"start": at, "fill": _shown(layers[hit]).duplicate(), "edge": ""}
		return
	_select(-1)


func _layer_at(at: Vector2) -> int: return Audio.pick(_layers(), look(), func(l: Dictionary) -> Rect2: return _fill_rect(_shown(l)), at)  # WO-817: a viewer drop never targets an audio-only layer


func _others_fills(skip: int) -> Array:
	var out := []
	var layers := _layers()
	for i in layers.size():
		if i != skip and layers[i].get("fill") is Dictionary and not Audio.is_audio_only(layers[i], look()):  # no snap to unseen boxes
			out.append(_shown(layers[i]))
	return out


func _snap_candidates(x_axis: bool) -> Array:
	var out: Array = [0.0, 1.0]
	for f in _others_fills(_sel):
		var a := float(f.get("x" if x_axis else "y", 0))
		out.append_array([a, a + float(f.get("scaleX" if x_axis else "scaleY", 0))])
	return out


func _set_field(key: String, v: float) -> void:
	if _sel < 0 or _drag.size() > 0:
		return
	var l: Dictionary = _layers()[_sel]
	if key == "opacity" and absf(float(l.get("opacity", 1.0)) - v) > 1e-9:
		_apply_layer({"opacity": v})


## Patch the selected layer in the show document and schedule the PRV push.
func _apply_layer(patch: Dictionary) -> void:
	var layers := _layers()
	if _sel < 0 or _sel >= layers.size():
		return
	(layers[_sel] as Dictionary).merge(patch, true)
	_sync_fields()
	pusher.schedule(scene_id, main)


func _select(i: int, show := true) -> void:
	_sel = i
	if i >= 0 and i < _list.item_count:
		_list.select(i)
		if show and InspectorPanel.current != null:
			InspectorPanel.current.present(_page)
	else:
		_release_page()
	_sync_fields()


func _release_page() -> void:
	if InspectorPanel.current != null:
		InspectorPanel.current.release(_page)


func _exit_tree() -> void:
	if _page != null and not _page.is_inside_tree():  # never adopted by the Inspector
		_page.free()


func _sync_fields() -> void:
	var layers := _layers()
	var has := _sel >= 0 and _sel < layers.size()
	if _inspector != null and _drag.is_empty():
		_inspector.show_layer(scene_id, main, layers[_sel] if has else {}, _sel)
	for k in _fields:
		(_fields[k] as SpinBox).editable = has
	_geo.show_layer(layers[_sel].merged({"fill": _shown(layers[_sel])}, true) if has else {}, _canvas(), Settings.get_setting("editorDefaults.coordinateOrigin", "") == "center")
	if not has:
		return
	var l: Dictionary = layers[_sel]
	(_fields.opacity as SpinBox).set_value_no_signal(float(l.get("opacity", 1.0)))


func _refresh_list() -> void:
	_title.text = "Edit look: %s  (main %d → PRV)" % [look().get("name", "?"), main + 1]
	_list.clear()
	for l in _layers():
		var src: Dictionary = l.source if l.get("source") is Dictionary else {}
		_list.add_item("L%d  %s" % [int(l.get("layerNumber", 0)), Ops.layer_name(src) if str(src.get("value", "")) != "" else "(empty)"])
	if _sel >= 0:
		_select(_sel, false)  # a background project update keeps the selection but never takes the Inspector back


func _hold(on: bool) -> void:
	if _role == "":
		return
	if on:
		VideoSurfaces.acquire(_role, self)
	else:
		VideoSurfaces.release(_role, self)


## --- WO-600 K / WO-816: media from the Sources panel (look_layer_drop.gd). On a layer (its frame box, its list row) the
## first source exchanges that layer's media; the rest (or a drop on blank frame / below the rows) add layers.
func _can_drop(_at: Vector2, data: Variant) -> bool: return scene_id != "" and not Ops.drop_sources(data).is_empty()


func _drop(at: Vector2, data: Variant, on_list := false) -> void:
	await Drop.drop(self, Api, _list.get_item_at_position(at, true) if on_list else _layer_at(at), Ops.drop_sources(data))


func add_layer_from_source(src: Dictionary) -> bool: return await Drop.add(self, Api, src)


func _remove_layer() -> void:
	var layers := _layers()
	if _sel < 0 or _sel >= layers.size():
		return
	layers.remove_at(_sel)
	_sel = -1
	_refresh_list()
	_select(-1)  # releases the Inspector page and clears the fields — else the removed layer's values stayed up
	pusher.schedule(scene_id, main)


func _mirror_copy() -> void:  # WO-657: onto the next free number, mirrored left↔right (empty when the look is full)
	var layers := _layers()
	var d := Ops.mirror_copy(layers, layers[_sel], _shown(layers[_sel])) if _sel >= 0 and _sel < layers.size() else {}
	if d.is_empty():
		return
	layers.append(d)
	_refresh_list()
	_select(layers.size() - 1)
	pusher.schedule(scene_id, main)


## +1 = up the stack (higher layer number), like dragging a row in the web layer strip.
func _move_layer(dir: int) -> void:
	var layers := _layers()
	if _sel < 0 or _sel >= layers.size():
		return
	var picked: Dictionary = layers[_sel]
	var sorted := layers.duplicate()
	sorted.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.get("layerNumber", 0)) < float(b.get("layerNumber", 0)))
	var vi := sorted.find(picked)
	var next: Variant = E.reorder_layers(layers, vi, vi + dir)
	if next == null:
		return
	look()["layers"] = next
	_refresh_list()
	_select((next as Array).find(picked))
	pusher.schedule(scene_id, main)


## --- WO-600 F crop: effects[{type:'crop', params}] (web startCropResize / inspector "crop" effect).
func _crop_of(l: Dictionary) -> Variant:
	for fx in (l.get("effects", []) if l.get("effects") is Array else []):
		if fx is Dictionary and str(fx.get("type", "")) == "crop":
			return C.normalize_crop(fx.get("params"))
	return null


func _crop_rect(r: Rect2, c: Dictionary) -> Rect2:
	return Rect2(r.position + Vector2(float(c.left), float(c.top)) * r.size, Vector2(float(c.right) - float(c.left), float(c.bottom) - float(c.top)) * r.size)


func _set_crop(c: Dictionary) -> void:
	var layers := _layers()
	if _sel < 0 or _sel >= layers.size():
		return
	var fx: Array = (layers[_sel].get("effects", []) as Array).duplicate() if layers[_sel].get("effects") is Array else []
	var entry := {"type": "crop", "params": c}
	var i := -1
	for k in fx.size():
		if fx[k] is Dictionary and str(fx[k].get("type", "")) == "crop":
			i = k
	if i >= 0:
		fx[i] = entry
	else:
		fx.append(entry)
	_apply_layer({"effects": fx})


func _set_crop_mode(on: bool) -> void:
	_crop_mode = on
	var layers := _layers()
	if on and _sel >= 0 and _sel < layers.size() and _crop_of(layers[_sel]) == null:
		_set_crop(C.normalize_crop({}))  # web: crop handles exist once the layer has a crop effect


func _reset_crop() -> void:
	var layers := _layers()
	if _sel < 0 or _sel >= layers.size() or not (layers[_sel].get("effects") is Array):
		return
	var fx: Array = (layers[_sel].effects as Array).filter(func(e: Variant) -> bool: return not (e is Dictionary and str(e.get("type", "")) == "crop"))
	_crop_btn.set_pressed_no_signal(false)
	_crop_mode = false
	_apply_layer({"effects": fx})
