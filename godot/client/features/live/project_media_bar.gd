extends HBoxContainer
## WO-603 — the project media bar above the Media tree (web sources-panel-project-gather.js): the open project's media
## folder, a "project only" filter and "Gather (N)" — move every clip the project references into that folder. The
## server plans and moves (GET /api/media/project, POST /api/media/gather; references follow through WO-592 links,
## project_sync re-imports the project); this bar only shows the plan and asks before moving.

signal filter_toggled
signal gathered(text: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Ops := preload("res://features/live/media_ops.gd")

var folder := ""
var pending: Array = []
var _path: Label
var _only: CheckBox
var _gather: Button
var _again: Timer


func _ready() -> void:
	visible = false
	_path = Label.new()
	_path.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_path.clip_text = true
	_path.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_path)
	_only = CheckBox.new()
	_only.text = "project only"
	_only.tooltip_text = "Show only clips in this project folder"
	_only.toggled.connect(func(_on: bool) -> void: filter_toggled.emit())
	add_child(_only)
	_gather = Button.new()
	_gather.visible = false
	_gather.pressed.connect(confirm_gather)
	add_child(_gather)
	_again = Timer.new()  # project edits come in bursts — one re-plan after they settle (web: 400 ms)
	_again.one_shot = true
	_again.wait_time = 0.4
	_again.timeout.connect(refresh)
	add_child(_again)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _again.start())


## True while the filter is on and there is a project folder to filter by.
func project_only() -> bool:
	return visible and _only.button_pressed and folder != ""


func refresh() -> void:
	var res: Dictionary = await Api.get_json("/api/media/project")
	var d: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var was_only := project_only()
	folder = str(d.get("folder", ""))
	pending = d.get("pending", []) if d.get("pending") is Array else []
	visible = d.get("enabled", false) == true and str(d.get("slug", "")) != "" and folder != ""
	_path.text = folder.get_file() + "/"  # the column is narrow — the project's own folder name, full path on hover
	_path.tooltip_text = "Project media folder: %s/ — Gather moves clips here" % folder
	_gather.visible = visible and not pending.is_empty()
	_gather.text = "Gather (%d)" % pending.size()
	_gather.tooltip_text = "%d referenced clip(s) live outside the project folder — move them in" % pending.size()
	if was_only != project_only():
		filter_toggled.emit()


func confirm_gather() -> void:
	if pending.is_empty():
		return
	var dlg := ConfirmationDialog.new()
	dlg.title = "Gather project media?"
	dlg.ok_button_text = "Move"
	var names := PackedStringArray()
	for id in pending.slice(0, 8):
		names.append("  " + str(id))
	if pending.size() > 8:
		names.append("  … and %d more" % (pending.size() - 8))
	dlg.dialog_text = "Move %s into %s/?\n\n%s\n\nLooks, playlists and timelines follow the move." % [Ops.plural(pending.size()), folder, "\n".join(names)]
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		_gather.disabled = true
		gathered.emit("Gathering %s…" % Ops.plural(pending.size()))
		var res: Dictionary = await Api.post_json("/api/media/gather", {})
		_gather.disabled = false
		gathered.emit(Ops.gather_text(res))
		refresh())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()
