extends VBoxContainer
## WO-952 — the right column's "Layer presets" tab, beside "Look presets" (owner 05.11: "a tab in the inspector where
## users can store configs of layers to be easily recalled to other media"). A preset is a layer's settings without its
## media (layer_style_model.gd: box, opacity, keyer, effects, transition, PIP …) in `project.scenes.layerPresets`, the
## same records the layer page's "Layer style" row saves and applies (WO-601). Here: save the selected layer, apply
## (button / double-click / drag the card onto a layer in the open look), rename, overwrite, duplicate, remove.
## The target is the look editor's selected layer; nothing is applied while no look is open.

signal said(text: String, ok: bool)

const M := preload("res://features/live/layer_preset_model.gd")
const S := preload("res://features/live/layer_style_model.gd")
const Ops := preload("res://features/live/look_layer_ops.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const LayerStyleRow := preload("res://features/live/layer_style_row.gd")

var editor: Node  # look_editor.gd: visible, scene_id, _sel, _layers(), look(), _apply_layer(patch)
var _target: Label
var _save: Button
var _list: VBoxContainer
var _status: Label
var _sig := "?"
var _dirty := true


## A preset's box on a 16:9 frame (where the layer sits, how opaque).
class _Thumb:
	extends Control
	var data: Dictionary = {}

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.05, 0.05, 0.06))
		var f: Dictionary = data.fill if data.get("fill") is Dictionary else {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}
		var r := Rect2(Vector2(float(f.get("x", 0)), float(f.get("y", 0))) * size, Vector2(float(f.get("scaleX", 1)), float(f.get("scaleY", 1))) * size)
		var c := ThemeBuilder.ACCENT
		c.a = clampf(float(data.get("opacity", 1.0)) if data.get("opacity") != null else 1.0, 0.15, 1.0)
		draw_rect(r.intersection(Rect2(Vector2.ZERO, size)), c)
		draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BORDER, false, 1.0)


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var hint := Label.new()
	hint.text = "A layer preset keeps a layer's settings — position and size, opacity, keyer, effects, transition, PIP — not its media. Select a layer in an open look, then Apply, double-click a preset, or drag it onto a layer."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(hint)
	_target = Label.new()
	_target.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_target)
	_save = Button.new()
	_save.text = "Save selected layer…"
	_save.icon = Icons.texture("save", 16)
	_save.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_save.pressed.connect(ask_name)
	add_child(_save)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	add_child(_list)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_status)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _dirty = true)
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path.begins_with("scene"):
			_dirty = true)
	visibility_changed.connect(func() -> void: _dirty = true)


## Only while the tab shows: the selection is read every frame (the editor has no selection signal), the list on change.
func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return
	var sig := _selection_sig()
	if sig != _sig:
		_sig = sig
		_show_target()
	if _dirty:
		_dirty = false
		_render()


func presets() -> Array:
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {"scenes": []}
	if not (Store.project.scenes.get("layerPresets") is Array):
		Store.project.scenes["layerPresets"] = []
	return Store.project.scenes.layerPresets


## The open look's selected layer ({} = none: no look open or nothing selected).
func selected_layer() -> Dictionary:
	if editor == null or not editor.visible or str(editor.scene_id) == "":
		return {}
	var layers: Array = editor._layers()
	var i: int = editor._sel
	return layers[i] if i >= 0 and i < layers.size() and layers[i] is Dictionary else {}


func _selection_sig() -> String:
	var l := selected_layer()
	return "" if l.is_empty() else "%s/%d/%s" % [editor.scene_id, int(l.get("layerNumber", 0)), _layer_label(l)]


func _layer_label(l: Dictionary) -> String:
	return "L%d  %s" % [int(l.get("layerNumber", 0)), _media_name(l)]


func _media_name(l: Dictionary) -> String:
	var src: Dictionary = l.source if l.get("source") is Dictionary else {}
	return Ops.layer_name(src) if str(src.get("value", "")) != "" else "(empty)"


func _show_target() -> void:
	var l := selected_layer()
	if l.is_empty():
		_target.text = "No layer selected — open a look and click a layer."
		_target.add_theme_color_override("font_color", ThemeBuilder.WARN)
	else:
		_target.text = "Target: %s  ·  look “%s”" % [_layer_label(l), str(editor.look().get("name", ""))]
		_target.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	_save.disabled = l.is_empty()
	_save.tooltip_text = "" if not l.is_empty() else "Select a layer in an open look first"
	for b in _list.find_children("apply", "Button", true, false):
		(b as Button).disabled = l.is_empty()


func _render() -> void:
	for c in _list.get_children():
		c.queue_free()
	for p in presets():
		if p is Dictionary:
			_list.add_child(_card(p))
	if presets().is_empty():
		var e := Label.new()
		e.text = "No layer presets yet."
		e.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_list.add_child(e)
	_sig = "?"  # the new cards' Apply buttons follow the selection on the next frame


func _card(p: Dictionary) -> Control:
	var id := str(p.get("id", ""))
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.BORDER, 1))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.tooltip_text = "Double-click: apply to the selected layer · drag onto a layer of the open look"
	card.gui_input.connect(func(ev: InputEvent) -> void:
		var mb := ev as InputEventMouseButton
		if mb != null and mb.button_index == MOUSE_BUTTON_LEFT and mb.pressed and mb.double_click:
			apply(id))
	card.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var pv := Label.new()
		pv.text = "  %s  " % str(p.get("name", ""))
		card.set_drag_preview(pv)
		return M.drag_payload(p), Callable(), Callable())
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)
	card.add_child(row)
	var th := _Thumb.new()
	th.data = p.get("data", {}) if p.get("data") is Dictionary else {}
	th.custom_minimum_size = Vector2(64, 36)
	th.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	th.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(th)
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	row.add_child(v)
	var name_l := Label.new()
	name_l.text = str(p.get("name", ""))
	name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_l.custom_minimum_size.x = 1
	v.add_child(name_l)
	var meta := Label.new()
	meta.text = M.summary(p.get("data"))
	meta.tooltip_text = meta.text
	meta.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	meta.add_theme_font_size_override("font_size", 12)
	meta.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	meta.custom_minimum_size.x = 1
	v.add_child(meta)
	var ap := Button.new()
	ap.name = "apply"
	ap.text = "Apply"
	ap.tooltip_text = "Apply to the selected layer (its media stays)"
	ap.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	ap.pressed.connect(func() -> void: apply(id))
	row.add_child(ap)
	row.add_child(_menu(p))
	return card


func _menu(p: Dictionary) -> MenuButton:
	var id := str(p.get("id", ""))
	var mb := MenuButton.new()
	mb.text = "⋯"
	mb.tooltip_text = "Rename / Overwrite / Duplicate / Remove"
	mb.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var pm := mb.get_popup()
	pm.add_item("Rename…", 0)
	pm.add_item("Overwrite with the selected layer", 1)
	pm.add_item("Duplicate", 2)
	pm.add_separator()
	pm.add_item("Remove", 3)
	pm.about_to_popup.connect(func() -> void: pm.set_item_disabled(pm.get_item_index(1), selected_layer().is_empty()))
	var acts: Array[Callable] = [
		func() -> void: ask_rename(p),
		func() -> void: _confirm("Overwrite \"%s\" with the settings of %s?" % [p.get("name", ""), _layer_label(selected_layer())], func() -> void: overwrite(id)),
		func() -> void: duplicate_preset(id),
		func() -> void: _confirm("Remove layer preset \"%s\"? (Layers it was applied to keep their settings.)" % p.get("name", ""), func() -> void: remove(id)),
	]
	pm.id_pressed.connect(func(item: int) -> void: acts[item].call())
	return mb


## --- actions (the probe and the tests call these directly) ---

func apply(id: String) -> bool:
	var p := M.find(presets(), id)
	var l := selected_layer()
	if p.is_empty() or not (p.get("data") is Dictionary):
		return false
	if l.is_empty():
		_say("Open a look and select a layer first.", false)
		return false
	editor._apply_layer(S.style_patch(p.data))
	_say("“%s” applied to %s." % [p.name, _layer_label(l)], true)
	return true


## Returns the new preset's id ("" = nothing saved).
func save(preset_name: String) -> String:
	var p := M.make(presets(), preset_name, selected_layer(), LayerStyleRow._uuid())
	if p.is_empty():
		_say("Give the preset a name." if not selected_layer().is_empty() else "Select a layer in an open look first.", false)
		return ""
	presets().append(p)
	_commit("Layer preset “%s” saved." % p.name)
	return str(p.id)


func overwrite(id: String) -> bool:
	if not M.overwrite(presets(), id, selected_layer()):
		_say("Select a layer in an open look first.", false)
		return false
	_commit("Layer preset overwritten.")
	return true


func duplicate_preset(id: String) -> String:
	var c := M.duplicate_preset(presets(), id, LayerStyleRow._uuid())
	if not c.is_empty():
		_commit("Duplicated as “%s”." % c.name)
	return str(c.get("id", ""))


func rename(id: String, new_name: String) -> bool:
	if not M.rename(presets(), id, new_name):
		_say("Give the preset a name.", false)
		return false
	_commit("Layer preset renamed.")
	return true


func remove(id: String) -> bool:
	if not M.remove(presets(), id):
		return false
	_commit("Layer preset removed.")
	return true


func ask_name() -> void:
	_ask("Layer preset name", _media_name(selected_layer()), func(t: String) -> void: save(t))


func ask_rename(p: Dictionary) -> void:
	var id := str(p.get("id", ""))
	_ask("Rename layer preset", str(p.get("name", "")), func(t: String) -> void: rename(id, t))


func _ask(title: String, initial: String, done: Callable) -> void:
	var dlg := AcceptDialog.new()
	dlg.title = title
	var edit := LineEdit.new()
	edit.custom_minimum_size.x = 320
	edit.text = initial
	edit.select_all_on_focus = true  # RULES.md input 1: focus selects the value
	dlg.add_child(edit)
	dlg.register_text_enter(edit)
	dlg.confirmed.connect(func() -> void:
		done.call(edit.text)
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
	edit.grab_focus()
	edit.select_all()


func _confirm(text: String, ok: Callable) -> void:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.confirmed.connect(func() -> void:
		ok.call()
		dlg.queue_free())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## Project edit: every view of the presets refreshes (the layer page's "Apply preset" list too), deck sync, autosave.
func _commit(msg: String) -> void:
	Store.project_changed.emit(Store.project)
	ProjectSync.deck_changed()
	ProjectSync.mark_dirty()
	_say(msg, true)
	_dirty = true


func _say(text: String, ok: bool) -> void:
	said.emit(text, ok)
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)
