extends VBoxContainer
## WO-804 — Lighting → Calibrate heads → Calibrate the rig (owner 29.10: "the app should count which of the heads are
## most crucial for calibration and guess/calculate the rest … position this head at mark 1…x then position the other
## head"). Every step is a server action (POST /api/tracking/follow/calibrate/rig, src/fixtures/rig-calibrate.js); this
## renders the reply: one prompt at a time — the head (selected in the 3D view, so the Programmer above aims it, or the
## console does) and the mark its beam goes on — then every head measured or inferred with its residual. Apply writes
## each head's calibrated_pose (export-only, follow_model.gd apply_rig); the patch pose and the beam offset stay
## (WO-700 R6). A wrong inferred head: select it in the list and Measure, or trim its beam offset in the fold above.

const F := preload("res://features/previs/tracking/follow_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const PATH := "/api/tracking/follow/calibrate/rig"

var sel: RefCounted = Sel.shared()
var _view := {}
var _err := ""
var _start: Button
var _box: VBoxContainer
var _prompt: Label
var _on_mark: Button
var _summary: Label
var _list: ItemList
var _measure: Button
var _apply: Button
var _note: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_start = _button(self, "Calibrate the rig…", func() -> void: _act({"action": "start"}))
	_start.tooltip_text = "The app picks a few heads (one or two per truss); aim each at its marks, the rest is inferred"
	_box = VBoxContainer.new()
	add_child(_box)
	_prompt = Label.new()
	_prompt.autowrap_mode = TextServer.AUTOWRAP_WORD
	_box.add_child(_prompt)
	var row := HBoxContainer.new()
	_on_mark = _button(row, "Beam is on …", func() -> void: _act({"action": "point"}))
	_button(row, "Skip mark", func() -> void: _act({"action": "skip"})).tooltip_text = "This head can't reach the mark: another one replaces it"
	_button(row, "Undo", func() -> void: _act({"action": "undo"}))
	_box.add_child(row)
	row = HBoxContainer.new()
	_button(row, "Skip head", func() -> void: _act({"action": "skip_head"})).tooltip_text = "Leave this head to the inference"
	_button(row, "Infer the rest now", func() -> void: _act({"action": "infer"}))
	_button(row, "Done", func() -> void: _act({"action": "end"}))
	_box.add_child(row)
	_summary = _muted(_box)
	_list = ItemList.new()
	_list.custom_minimum_size.y = 140
	_list.item_selected.connect(func(i: int) -> void: sel.set_ids([str(_list.get_item_metadata(i))]))
	_box.add_child(_list)
	row = HBoxContainer.new()
	_measure = _button(row, "Measure this head", _measure_selected)
	_measure.tooltip_text = "Aim the selected head at its marks too: it becomes measured"
	_apply = _button(row, "Apply to patch", _apply_result)
	_apply.tooltip_text = "Store every head's pose for the desk export (the 3D view keeps the patch pose)"
	_box.add_child(row)
	_note = _muted(self)
	var res: Dictionary = await Api.get_json(PATH)  # re-enter a session the server still holds
	if res.ok and res.data is Dictionary:
		_view = res.data
	_render()


func _act(body: Dictionary) -> void:
	var res: Dictionary = await Api.post_json(PATH, body)
	_err = "" if res.ok else str(res.error)
	if res.ok and res.data is Dictionary:
		_view = res.data
	_render()


func _measure_selected() -> void:
	var picked := _list.get_selected_items()
	if not picked.is_empty():
		_act({"action": "measure", "id": str(_list.get_item_metadata(picked[0]))})


func _apply_result() -> void:
	var r: Variant = _view.get("result")
	if not (r is Dictionary and r.get("heads") is Array):
		return
	var s := F.normalize(Store.project.get("fixtures"))
	s.patch = F.apply_rig(s.patch, r.heads)
	Store.project["fixtures"] = s
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)
	_err = "Applied: %d heads have a desk pose." % (r.heads as Array).size()
	_render()


func _render() -> void:
	var on: bool = _view.get("active") == true
	_start.visible = not on
	_box.visible = on
	_note.text = _err
	_note.visible = _err != ""
	if not on:
		return
	var p: Variant = _view.get("prompt")
	_on_mark.visible = p is Dictionary
	if p is Dictionary:
		var mk: Dictionary = p.get("mark") if p.get("mark") is Dictionary else {}
		_prompt.text = "Head %d of %d · %s\nAim its beam at %s (mark %d of %d)" % [int(p.anchor), int(p.anchors), str(p.name),
			str(mk.get("name", "?")), int(p.n), int(p.of)]
		_on_mark.text = "Beam is on %s" % str(mk.get("name", "…"))
		if sel.ids != [str(p.id)]:
			sel.set_ids([str(p.id)])  # the Programmer above aims the selection
	else:
		_prompt.text = "Every anchor is done — check the inferred heads below."
	_fill_result()


## The heads, worst residual first: "inferred · Robin 21 · ±0.05 m" / "measured · P10 401 · fit 0.3°".
func _fill_result() -> void:
	var r: Variant = _view.get("result")
	var anchors: Array = _view.get("anchors", []) if _view.get("anchors") is Array else []
	var solved := anchors.filter(func(a: Dictionary) -> bool: return a.status == "solved").size()
	var keep := ""
	var picked := _list.get_selected_items()
	if not picked.is_empty():
		keep = str(_list.get_item_metadata(picked[0]))
	_list.clear()
	_apply.disabled = not (r is Dictionary)
	_measure.disabled = not (r is Dictionary)
	if not r is Dictionary:
		_summary.text = "%d heads to measure, %d marks each; the rest is inferred." % [anchors.size(), 3]
		return
	_summary.text = "%d of %d anchors measured · %d heads inferred%s · rig turned %.2f°" % [solved, anchors.size(),
		int(r.inferred), (" · worst ±%.2f m" % float(r.worst_m)) if r.get("worst_m") != null else "", float(r.fit.turn_deg)]
	var heads: Array = (r.heads as Array).duplicate()
	heads.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return _rank(a) > _rank(b))
	for h in heads:
		var line := "%s · %s · %s" % [h.source, h.name, _residual(h)]
		_list.add_item(line)
		var i := _list.item_count - 1
		_list.set_item_metadata(i, str(h.id))
		if h.source == "inferred" and h.get("residual_m") != null and float(h.residual_m) > 0.1:
			_list.set_item_custom_fg_color(i, ThemeBuilder.WARN)
		if str(h.id) == keep:
			_list.select(i)


static func _rank(h: Dictionary) -> float:
	return 1e6 if h.get("residual_m") == null else float(h.residual_m)


static func _residual(h: Dictionary) -> String:
	if h.source == "measured":
		var fit := "fit %.2f°" % float(h.rms_deg) if h.get("rms_deg") != null else "fit ?"
		return fit + (" · %s" % str(h.warning) if h.get("warning") != null else "")
	return "±%.2f m (%s)" % [float(h.residual_m), h.get("basis", "rig")] if h.get("residual_m") != null else "± unknown (measure 2+ heads)"


func _button(parent: Control, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


func _muted(parent: Control) -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	parent.add_child(l)
	return l
