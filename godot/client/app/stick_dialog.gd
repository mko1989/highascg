extends ConfirmationDialog
## WO-697 — a HighAsCG stick this box did not boot from. The box syncs with the stick it booted from on its own; any
## other stick is only written to or read from here: "Save all to stick" copies every project and the settings onto
## it, Load copies the picked project from the stick into this box and opens it (GET /api/system/stick,
## POST /api/system/stick/save | /load). Opened from the Load dialog's "USB stick…".

const HeaderModel := preload("res://app/header_model.gd")

signal chosen(slug: String)  ## copied onto the box — the header loads it
signal said(notice: Dictionary)

var list: Tree
var _status: Label
var _replace: ConfirmationDialog
var _pending := ""


func _init() -> void:
	title = "USB stick"
	ok_button_text = "Load from stick"
	size = Vector2i(560, 460)
	var v := VBoxContainer.new()
	add_child(v)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_status)
	list = Tree.new()
	list.columns = 2
	list.select_mode = Tree.SELECT_ROW
	list.hide_root = true
	list.column_titles_visible = true
	list.set_column_title(0, "Project on the stick")
	list.set_column_title(1, "Saved")
	list.set_column_expand(1, false)
	list.set_column_custom_minimum_width(1, 150)
	list.custom_minimum_size = Vector2(520, 300)
	list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	list.item_activated.connect(func() -> void: hide(); _confirm())
	v.add_child(list)
	add_button("Save all to stick", true, "save")
	custom_action.connect(func(a: StringName) -> void:
		if a == &"save":
			_save())
	confirmed.connect(_confirm)
	_replace = ConfirmationDialog.new()
	_replace.title = "Replace project"
	_replace.ok_button_text = "Replace"
	_replace.confirmed.connect(func() -> void: _load(_pending))
	add_child(_replace)


func open() -> void:
	popup_centered()
	await refresh()


func refresh() -> void:
	_status.text = "Reading the stick…"
	list.clear()
	var r: Dictionary = await Api.get_json("/api/system/stick")
	if not r.ok or not r.data is Dictionary:
		_status.text = "Could not read the stick: %s" % str(r.error)
		return
	if not r.data.get("mounted", false):
		_status.text = "No HighAsCG stick is plugged in."
		return
	_status.text = "This box did not start from this stick, so nothing is copied to or from it on its own. " \
		+ "Save all to stick copies every project and the settings onto it; Load copies one project onto this box."
	var root := list.create_item()
	var rows := HeaderModel.stick_rows(r.data)
	for row in rows:
		var it := list.create_item(root)
		it.set_text(0, str(row.name) + ("   (also on this box)" if row.on_box else ""))
		it.set_text(1, str(row.saved))
		it.set_metadata(0, row)
	if rows.is_empty():
		list.create_item(root).set_text(0, "No projects on the stick yet")


func _confirm() -> void:
	var it := list.get_selected()
	if it == null or not it.get_metadata(0) is Dictionary:
		return
	var row: Dictionary = it.get_metadata(0)
	if row.on_box:
		_pending = str(row.slug)
		_replace.dialog_text = "\"%s\" is also on this box. Replace it with the stick's copy?\nThe box's copy is kept " % row.name \
			+ "beside it (%s.json.before-stick-…)." % row.slug
		_replace.popup_centered()
	else:
		_load(str(row.slug))


func _load(slug: String) -> void:
	var r: Dictionary = await Api.post_json("/api/system/stick/load", {"slug": slug})
	if not r.ok:
		said.emit(HeaderModel.notice("error", "Load from stick failed: %s" % _err(r), ""))
		return
	chosen.emit(slug)


func _save() -> void:
	get_ok_button().disabled = true
	_status.text = "Saving to the stick…"
	await ProjectSync.save_now()  # the open show's latest edits go along
	var r: Dictionary = await Api.post_json("/api/system/stick/save", {})
	get_ok_button().disabled = false
	if not r.ok:
		_status.text = "Save to stick failed: %s" % _err(r)
		return
	said.emit(HeaderModel.notice("info", "Saved %d project(s) and %d settings file(s) to the stick" % [int(r.data.projects),
		int(r.data.settings)], ""))
	await refresh()


static func _err(r: Dictionary) -> String:
	var d: Variant = r.get("data")
	return str(d.error) if d is Dictionary and d.has("error") else str(r.get("error", "failed"))
