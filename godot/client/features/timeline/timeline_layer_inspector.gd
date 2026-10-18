extends VBoxContainer
## WO-602 slice 6 — the timeline layer page for the global Inspector (web inspector-mixer.js
## renderTimelineLayerInspector): "Timeline Layer N", Layer → Name, Actions → Add layer below / Remove layer (asks
## first: the layer's clips go with it). It also owns the header's right-click menu (web createShowLayerContextMenu:
## Rename layer · Add layer below · Remove layer) — Rename focuses the Name field instead of the browser's prompt().
## Edits mutate the timeline (timeline_layers.gd); the tab saves / syncs on `changed` and re-selects on `selected`.

signal changed
signal selected(li: int)  # the layer to select after an op (-1 = none)

const L := preload("res://features/timeline/timeline_layers.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _tl: Dictionary = {}
var _li := -1
var _title: Label
var _name: LineEdit


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_title = Label.new()
	_title.add_theme_font_size_override("font_size", 15)
	add_child(_title)
	_head("Layer")
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 10)
	add_child(g)
	var l := Label.new()
	l.text = "Name"
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	_name = LineEdit.new()
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name.text_submitted.connect(func(_t: String) -> void: _commit_name())
	_name.focus_exited.connect(_commit_name)
	g.add_child(_name)
	_head("Actions")
	var row := HBoxContainer.new()
	row.add_child(_btn("Add layer below", add_below))
	row.add_child(_btn("Remove layer", confirm_remove))
	add_child(row)


func show_layer(tl: Dictionary, li: int) -> void:
	if _name != null and _name.has_focus() and (li != _li or not is_same(tl, _tl)):
		_name.release_focus()  # commits a typed name to the layer it was typed for, then the field re-reads
	_tl = tl
	_li = li
	refresh()


func refresh() -> void:
	if _title == null or _li < 0 or _li >= (_tl.get("layers", []) as Array).size():
		return
	_title.text = "Timeline Layer %d" % (_li + 1)
	if not _name.has_focus():
		_name.text = L.display_name(_tl, _li)


func _commit_name() -> void:
	if _li < 0 or _li >= (_tl.get("layers", []) as Array).size():
		return
	var before := str(_tl.layers[_li].get("name", ""))
	L.rename(_tl, _li, _name.text)
	_name.text = L.display_name(_tl, _li)
	if str(_tl.layers[_li].get("name", "")) != before:
		changed.emit()


func add_below() -> void:
	L.insert_below(_tl, _li)
	changed.emit()


func confirm_remove() -> void:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = "Remove \"%s\" and all its clips?" % L.display_name(_tl, _li)
	dlg.ok_button_text = "Remove"
	var li := _li
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		L.remove(_tl, li)
		selected.emit(-1)
		changed.emit())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## The header's right-click menu, at the mouse.
func menu() -> void:
	var pm := PopupMenu.new()
	pm.add_item("Rename layer", 0)
	pm.add_item("Add layer below", 1)
	pm.add_item("Remove layer", 2)
	pm.id_pressed.connect(_on_menu)
	pm.popup_hide.connect(pm.queue_free)
	add_child(pm)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:  # see deck_view.gd _card_menu
		at += get_window().position
	pm.popup(Rect2i(at, Vector2i.ZERO))


func _on_menu(id: int) -> void:
	match id:
		0:
			_name.grab_focus()
			_name.select_all()
		1:
			add_below()
		2:
			confirm_remove()


func _head(text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	add_child(l)


func _btn(text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(cb)
	return b
