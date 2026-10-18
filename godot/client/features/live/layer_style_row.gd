extends HBoxContainer
## WO-601 — "Layer style" row of the look-layer inspector (web inspector-scene-layer.js style group + the layer-strip
## preset picker): Copy (everything but the source), Paste, Save as preset (named, `project.scenes.layerPresets`),
## Apply preset ▾. The clipboard is per client session like the web's sceneState._layerStyleClipboard.

signal patch(p: Dictionary)
signal status(text: String)

const S := preload("res://features/live/layer_style_model.gd")

static var _clipboard: Dictionary = {}

var _layer: Dictionary = {}
var _paste: Button
var _presets: OptionButton


func _ready() -> void:
	var l := Label.new()
	l.text = "Layer style"
	add_child(l)
	_btn("Copy", "Copy position, scale, opacity, keyer, effects, transition, PIP (not the source)", func() -> void:
		_clipboard = S.style_data(_layer)
		_paste.disabled = false
		status.emit("Layer settings copied (not source)."))
	_paste = _btn("Paste", "Paste copied settings", func() -> void:
		if not _clipboard.is_empty():
			patch.emit(S.style_patch(_clipboard))
			status.emit("Settings pasted."))
	_paste.disabled = _clipboard.is_empty()
	_btn("Save preset…", "Save as a named layer style preset", _ask_name)
	_presets = OptionButton.new()
	_presets.item_selected.connect(_apply_preset)
	add_child(_presets)


func show_layer(layer: Dictionary) -> void:
	_layer = layer
	_paste.disabled = _clipboard.is_empty()
	_fill_presets()


static func _root() -> Dictionary:
	if not (Store.project.get("scenes") is Dictionary):
		Store.project["scenes"] = {}
	if not (Store.project.scenes.get("layerPresets") is Array):
		Store.project.scenes["layerPresets"] = []
	return Store.project.scenes


func _fill_presets() -> void:
	_presets.clear()
	var list: Array = _root().layerPresets
	_presets.add_item("Apply preset…" if not list.is_empty() else "No layer presets")
	for p in list:
		_presets.add_item(str(p.get("name", "?")))
	_presets.disabled = list.is_empty()


func _apply_preset(i: int) -> void:
	_presets.select(0)
	var list: Array = _root().layerPresets
	if i <= 0 or i > list.size() or not (list[i - 1].get("data") is Dictionary):
		return
	patch.emit(S.style_patch(list[i - 1].data))
	status.emit("Preset \"%s\" applied." % str(list[i - 1].name))


func _ask_name() -> void:
	var dlg := ConfirmationDialog.new()
	dlg.title = "Layer style preset name?"
	var le := LineEdit.new()
	le.custom_minimum_size.x = 260
	dlg.add_child(le)
	dlg.register_text_enter(le)
	dlg.confirmed.connect(func() -> void: save_preset(le.text))
	dlg.visibility_changed.connect(func() -> void:
		if not dlg.visible:
			dlg.queue_free())
	add_child(dlg)
	dlg.popup_centered()
	le.grab_focus()


## sceneStateSaveLayerPresetFromLayer → id ("" when the name is blank).
func save_preset(name: String) -> String:
	if name.strip_edges() == "" or _layer.is_empty():
		status.emit("Could not save preset (empty name).")
		return ""
	var list: Array = _root().layerPresets
	var id := _uuid()
	list.append({"id": id, "name": S.unique_name(list, name), "data": S.style_data(_layer)})
	ProjectSync.deck_changed()
	ProjectSync.mark_dirty()
	_fill_presets()
	status.emit("Layer preset saved.")
	return id


## crypto.randomUUID shape (v4).
static func _uuid() -> String:
	var b := PackedByteArray()
	for i in 16:
		b.append(randi() % 256)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	var h := b.hex_encode()
	return "%s-%s-%s-%s-%s" % [h.substr(0, 8), h.substr(8, 4), h.substr(12, 4), h.substr(16, 4), h.substr(20, 12)]


func _btn(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	add_child(b)
	return b


## Probe/test helper: the row's button with that label.
func _btn_named(text: String) -> Button:
	for c in get_children():
		if c is Button and (c as Button).text == text:
			return c
	return null
