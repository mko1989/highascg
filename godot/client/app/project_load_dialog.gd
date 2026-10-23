extends ConfirmationDialog
## WO-608 header — web load-project-modal.js: the server's project files (GET /api/project/list), the active one
## preselected; Load activates the pick on the server, "From file…" imports a .json from this computer, "USB stick…"
## (WO-697, only for a HighAsCG stick this box did not boot from) saves to / loads from it (app/stick_dialog.gd).

const HeaderModel := preload("res://app/header_model.gd")

signal chosen(slug: String)
signal file_requested
signal stick_requested

var list: Tree
var _stick_btn: Button


func _init() -> void:
	title = "Load project"
	ok_button_text = "Load"
	size = Vector2i(560, 420)
	list = Tree.new()
	list.columns = 2
	list.select_mode = Tree.SELECT_ROW
	list.hide_root = true
	list.column_titles_visible = true
	list.set_column_title(0, "Project")
	list.set_column_title(1, "Saved")
	list.set_column_expand(1, false)
	list.set_column_custom_minimum_width(1, 150)
	list.custom_minimum_size = Vector2(520, 320)
	list.item_activated.connect(_confirm)
	add_child(list)
	add_button("From file…", true, "file")
	_stick_btn = add_button("USB stick…", true, "stick")
	_stick_btn.visible = false
	custom_action.connect(func(a: StringName) -> void:
		hide()
		if a == &"file":
			file_requested.emit()
		elif a == &"stick":
			stick_requested.emit())
	confirmed.connect(_confirm)


func open() -> void:
	_line("Loading…")
	popup_centered()
	var res: Dictionary = await Api.get_json("/api/project/list")
	if not res.ok:
		_line("Could not load the project list: " + str(res.error))
		return
	_stick_btn.visible = HeaderModel.offers_stick(res.data)
	show_rows(HeaderModel.project_rows(res.data))


func show_rows(rows: Array) -> void:
	list.clear()
	list.hide_root = true
	var root := list.create_item()
	for r in rows:
		var it := list.create_item(root)
		it.set_text(0, ("● " if r.active else "") + str(r.name))
		it.set_text(1, str(r.saved))
		it.set_tooltip_text(0, "%s.json%s" % [r.slug, " (open now)" if r.active else ""])
		it.set_metadata(0, str(r.slug))
		if r.active:
			it.select(0)
	if rows.is_empty():
		_line("No projects on the server yet")


func _line(text: String) -> void:
	list.clear()
	list.create_item().set_text(0, text)
	list.hide_root = false


func _confirm() -> void:
	var it := list.get_selected()
	if it == null or it.get_metadata(0) == null:
		return
	hide()
	chosen.emit(str(it.get_metadata(0)))
