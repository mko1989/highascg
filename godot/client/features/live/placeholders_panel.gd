extends VBoxContainer
## WO-603 parity row 26 — Sources "Placeholders" tab (offline / preshow mode): the project's placeholder list
## (placeholders_model.gd), "+ Add placeholder…" (web placeholder-modal.js: label / template / resolution / fill
## colour) and right-click → Remove. Edits go to Store.project.placeholders + ProjectSync like the stage builder.

const M := preload("res://features/live/placeholders_model.gd")
const ListPanel := preload("res://features/live/source_list_panel.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

var list: ListPanel


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	list = ListPanel.new()
	list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	list.empty_text = "No placeholders. Click + to add one."
	list.provider = func(f: String) -> Array: return M.rows(M.list_of(Store.project), f)
	list.row_context.connect(_row_menu)
	add_child(list)
	var add := Button.new()
	add.text = "+ Add placeholder…"
	add.pressed.connect(show_add)
	add_child(add)
	Store.project_changed.connect(func(_p: Dictionary) -> void: list.rebuild())
	list.rebuild.call_deferred()


func _store(items: Array) -> void:
	Store.project["placeholders"] = items
	ProjectSync.mark_dirty()
	list.rebuild()


func _row_menu(p: Dictionary, _kind: String) -> void:
	var item: Dictionary = {}
	for x in M.list_of(Store.project):
		if M.payload(x) == p:
			item = x
	if item.is_empty():
		return
	var menu := PopupMenu.new()
	menu.add_item("Remove placeholder…")
	menu.id_pressed.connect(func(_i: int) -> void:
		Kit.confirm(self, "Remove placeholder \"%s\"?" % str(item.get("label", item.id)), func() -> void:
			_store(M.without(M.list_of(Store.project), str(item.id)))))
	menu.popup_hide.connect(menu.queue_free, CONNECT_DEFERRED)
	add_child(menu)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:
		at += get_window().position
	menu.popup(Rect2i(at, Vector2i.ZERO))


func show_add() -> void:
	var d := ConfirmationDialog.new()
	d.title = "Add placeholder"
	d.ok_button_text = "Save placeholder"
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 12)
	d.add_child(g)
	var label := LineEdit.new()
	label.placeholder_text = "e.g. PLC_PGM1_GRID"
	label.custom_minimum_size.x = 280
	var tpl := OptionButton.new()
	for t in M.TEMPLATES:
		tpl.add_item(str(t.label))
	var desc := Label.new()
	desc.add_theme_color_override("font_color", Color(1, 1, 1, 0.6))
	var res := OptionButton.new()
	for r in M.RESOLUTIONS:
		res.add_item(str(r[1]))
	var color := ColorPickerButton.new()
	color.color = Color(M.DEFAULT_COLOR)
	color.custom_minimum_size = Vector2(80, 28)
	color.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	var color_l := Label.new()
	color_l.text = "Fill colour"
	for pair in [["Label", label], ["Template", tpl], ["", desc], ["Resolution", res], [color_l, color]]:
		var l: Control = pair[0] if pair[0] is Control else Label.new()
		if not (pair[0] is Control):
			(l as Label).text = str(pair[0])
		g.add_child(l)
		g.add_child(pair[1])
	var sync := func(i: int) -> void:
		desc.text = str(M.TEMPLATES[i].description)
		color.visible = M.TEMPLATES[i].id == "solid"
		color_l.visible = color.visible
		d.reset_size.call_deferred()
	tpl.item_selected.connect(sync)
	sync.call(0)
	d.register_text_enter(label)
	d.confirmed.connect(func() -> void:
		var item := M.make({"label": label.text, "template": M.TEMPLATES[tpl.selected].id,
			"resolution": M.RESOLUTIONS[res.selected][0], "value": "#" + color.color.to_html(false)},
			int(Time.get_unix_time_from_system() * 1000.0))
		var items := M.list_of(Store.project)
		items.append(item)
		_store(items))
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	add_child(d)
	d.popup_centered()
	label.grab_focus.call_deferred()
