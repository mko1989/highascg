extends VBoxContainer
## WO-616 T9c — ROI masks of the camera on screen (inside the Detect section): polygons in the picture (0–1 of the
## frame); with "Use masks" on, the sidecar keeps a detection only when its feet point (box bottom-centre) lies inside
## an enabled mask with 3+ corners (tools/tracking-detect/detector.py filter_masks — OpenFollow's ROI masks; no
## usable mask = the whole picture). Draw, then click corners in the camera view (tracking_page.click → add_point).
## Owns no data: detect_section hands over masks_of(...) and writes `edit` back through with_masks.

const D := preload("res://features/previs/tracking/detect_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal edit(masks_enabled: bool, masks: Array)
signal view_changed  # selection / drawing → the camera view redraws

var mk := {"masks_enabled": false, "masks": []}
var sel := 0
var drawing := false
var _use: CheckBox
var _list: ItemList
var _enabled: CheckBox
var _draw_btn: Button
var _state: Label
var _confirm_del: ConfirmationDialog


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	add_child(HSeparator.new())
	_use = CheckBox.new()
	_use.text = "Use masks — only persons standing inside one count"
	_use.toggled.connect(func(on: bool) -> void: edit.emit(on, mk.masks))
	add_child(_use)
	_list = ItemList.new()
	_list.custom_minimum_size.y = 80
	_list.item_selected.connect(func(i: int) -> void:
		sel = i
		set_drawing(false)
		refresh()
		view_changed.emit())
	add_child(_list)
	var row := HBoxContainer.new()
	row.add_child(_button("Add mask", _add))
	row.add_child(_button("Delete", func() -> void: _confirm_del.popup_centered()))
	_enabled = CheckBox.new()
	_enabled.text = "Enabled"
	_enabled.toggled.connect(func(on: bool) -> void:
		if not current().is_empty():
			current().enabled = on
			_emit())
	row.add_child(_enabled)
	add_child(row)
	_confirm_del = ConfirmationDialog.new()
	_confirm_del.dialog_text = "Delete this mask?"
	_confirm_del.confirmed.connect(_delete)
	add_child(_confirm_del)
	var shape := HBoxContainer.new()
	_draw_btn = _button("Draw shape", func() -> void: set_drawing(not drawing))
	_draw_btn.toggle_mode = true
	shape.add_child(_draw_btn)
	shape.add_child(_button("Undo point", func() -> void: _shape(-1)))
	shape.add_child(_button("Clear shape", func() -> void: _shape(0)))
	add_child(shape)
	_state = Label.new()
	_state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_state.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_state)
	refresh()


## detect_section → this camera's masks (D.masks_of). Keeps the selection.
func set_masks(src: Dictionary) -> void:
	mk = src
	sel = clampi(sel, 0, maxi(0, (mk.masks as Array).size() - 1))
	if (mk.masks as Array).is_empty():
		set_drawing(false)
	refresh()


func current() -> Dictionary:
	return mk.masks[sel] if sel < (mk.masks as Array).size() else {}


func set_drawing(on: bool) -> void:
	on = on and not current().is_empty()
	if on == drawing:
		return
	drawing = on
	if _draw_btn != null:
		_draw_btn.set_pressed_no_signal(on)
	refresh()
	view_changed.emit()


## A picture point [x, y] (0–1 of the frame) clicked in the camera view while drawing.
func add_point(at: Array) -> void:
	var m := current()
	if not drawing or m.is_empty():
		return
	(m.vertices as Array).append([snappedf(clampf(float(at[0]), 0.0, 1.0), 0.001), snappedf(clampf(float(at[1]), 0.0, 1.0), 0.001)])
	_emit()


## For the camera view: [{vertices, enabled, selected}] + whether the set filters at all.
func shapes() -> Array:
	var out := []
	for i in (mk.masks as Array).size():
		var m: Dictionary = mk.masks[i]
		out.append({"vertices": m.vertices, "enabled": m.enabled, "selected": i == sel})
	return out


func _shape(op: int) -> void:
	var m := current()
	if m.is_empty() or (m.vertices as Array).is_empty():
		return
	if op < 0:
		(m.vertices as Array).pop_back()
	else:
		(m.vertices as Array).clear()
	_emit()


func _add() -> void:
	(mk.masks as Array).append({"enabled": true, "vertices": []})
	sel = (mk.masks as Array).size() - 1
	if not mk.masks_enabled and (mk.masks as Array).size() == 1:
		mk.masks_enabled = true  # the first mask is drawn to be used
	_emit()
	set_drawing(true)


func _delete() -> void:
	if sel < (mk.masks as Array).size():
		(mk.masks as Array).remove_at(sel)
		sel = clampi(sel, 0, maxi(0, (mk.masks as Array).size() - 1))
		set_drawing(false)
		_emit()


func _emit() -> void:
	refresh()
	edit.emit(mk.masks_enabled, (mk.masks as Array).duplicate(true))


func refresh() -> void:
	if _list == null:
		return
	_use.set_pressed_no_signal(mk.masks_enabled)
	_list.clear()
	for m in mk.masks:
		var n: int = (m.vertices as Array).size()
		_list.add_item("Mask %d · %d pts%s%s" % [_list.item_count + 1, n, "" if n >= 3 else " · no shape", "" if m.enabled else " · off"])
	var empty: bool = (mk.masks as Array).is_empty()
	_list.visible = not empty
	_enabled.disabled = empty
	_draw_btn.disabled = empty
	if not empty:
		_list.select(sel)
		_enabled.set_pressed_no_signal(current().enabled)
	var lines := []
	if drawing:
		lines.append("Drawing — click the mask's corners in the camera view (%d so far, 3+ needed)." % (current().vertices as Array).size())
	if empty:
		lines.append("No masks — the whole picture is watched. Add mask, then click its corners in the camera view.")
	elif not D.masks_active(mk):
		lines.append("Masks not filtering — " + ("Use masks is off." if not mk.masks_enabled else "no enabled mask with 3+ corners."))
	else:
		lines.append("Filtering — a person counts only with their feet (box bottom-centre) inside an enabled mask.")
	_state.text = "\n".join(lines)


func _button(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
