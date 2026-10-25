extends HBoxContainer
## WO-608 header — the web header-bar.js left group: editable project name, Save / Load / New project and the
## autosave notice line. The server does the work (owner directive D): Save = POST /api/project/save, Load =
## POST /api/project/load {applyHardware} (the server activates the show and Device View), New = POST
## /api/project/new (the server builds the starter project). Right-click Save / Load for the file variants (the web's
## Shift+click — Godot keeps shortcuts out, right-click menus instead).

signal loaded  ## a header Load / Load-from-file finished (WO-608: the missing-assets check)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const UiIcons := preload("res://app/ui_icons.gd")
const HeaderModel := preload("res://app/header_model.gd")
const LoadDialog := preload("res://app/project_load_dialog.gd")
const StickDialog := preload("res://app/stick_dialog.gd")

const NOTICE_S := 6.0

var name_edit: LineEdit
var notice_label: Label
var save_btn: Button
var load_btn: Button
var new_btn: Button
var _load: LoadDialog
var _new_confirm: ConfirmationDialog
var _menu: PopupMenu
var _fade: Timer
var _sticky := false


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	name_edit = LineEdit.new()
	name_edit.placeholder_text = "Project name"
	name_edit.tooltip_text = "Project name — Enter renames the show (the server moves its file and media folder)"
	name_edit.custom_minimum_size.x = 170
	name_edit.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	name_edit.text_submitted.connect(func(_t: String) -> void: _commit_name())
	name_edit.focus_exited.connect(_commit_name)
	add_child(name_edit)
	# WO-751: the show belongs to the server this client is on; say so when that is another machine
	var on_host := preload("res://core/cluster_follow_model.gd").host_of(Config.origin)
	var away := Label.new()
	away.text = "on " + on_host
	away.tooltip_text = "This client is connected to the server at %s: this show is that server's" % Config.origin
	away.add_theme_color_override("font_color", ThemeBuilder.WARN)
	away.mouse_filter = Control.MOUSE_FILTER_PASS
	away.visible = not preload("res://core/cluster_follow_model.gd").on_box(Config.origin)
	add_child(away)
	save_btn =UiIcons.button("save", "Save project to the server (right-click: save to a file)", 16)
	save_btn.pressed.connect(save)
	save_btn.gui_input.connect(_rmb.bind("save"))
	add_child(save_btn)
	load_btn = UiIcons.button("load", "Load project (right-click: load from a file)", 16)
	load_btn.pressed.connect(func() -> void: _load.open())
	load_btn.gui_input.connect(_rmb.bind("load"))
	add_child(load_btn)
	new_btn = Button.new()
	new_btn.text = "New project"
	new_btn.focus_mode = Control.FOCUS_NONE
	new_btn.tooltip_text = "Start a fresh project with empty looks and one PGM screen destination"
	new_btn.pressed.connect(func() -> void: _new_confirm.popup_centered())
	add_child(new_btn)
	notice_label = Label.new()
	notice_label.add_theme_font_size_override("font_size", 12)
	notice_label.clip_text = true
	notice_label.custom_minimum_size.x = 200
	add_child(notice_label)
	_fade = Timer.new()
	_fade.one_shot = true
	_fade.timeout.connect(func() -> void:
		if not _sticky:
			notice_label.text = "")
	add_child(_fade)
	_load = LoadDialog.new()
	_load.chosen.connect(load_slug)
	_load.file_requested.connect(_pick_file.bind(false))
	add_child(_load)
	var stick := StickDialog.new()  # WO-697: save to / load from a stick this box did not boot from
	stick.chosen.connect(load_slug)
	stick.said.connect(say)
	_load.stick_requested.connect(stick.open)
	add_child(stick)
	_new_confirm = ConfirmationDialog.new()
	_new_confirm.title = "New project"
	_new_confirm.dialog_text = "Start a fresh project? Unsaved changes will be lost. Screen destinations reset to one PGM."
	_new_confirm.ok_button_text = "Start fresh"
	_new_confirm.confirmed.connect(new_project)
	add_child(_new_confirm)
	_menu = PopupMenu.new()
	_menu.id_pressed.connect(func(id: int) -> void: _pick_file(id == 0))
	add_child(_menu)
	Store.project_changed.connect(func(p: Dictionary) -> void:
		if not name_edit.has_focus():
			name_edit.text = str(p.get("name", "")))
	name_edit.text = str(Store.project.get("name", ""))
	ProjectSync.saved.connect(func(_rev: int) -> void: say(HeaderModel.notice("autosaved", "", HeaderModel.hhmm(Time.get_time_dict_from_system()))))
	ProjectSync.save_failed.connect(func(reason: String) -> void:
		say(HeaderModel.notice("gone" if reason == "project_gone" else "failed", reason, "")))


func say(n: Dictionary) -> void:
	notice_label.text = str(n.text)
	notice_label.tooltip_text = str(n.get("tip", n.text))
	var tone := str(n.get("tone", "ok"))
	var tones := {"error": ThemeBuilder.ERROR, "warn": ThemeBuilder.WARN, "muted": ThemeBuilder.TEXT_MUTED}
	notice_label.add_theme_color_override("font_color", tones.get(tone, ThemeBuilder.SUCCESS))
	_sticky = n.get("sticky") == true
	if not _sticky:
		_fade.start(NOTICE_S)


func _commit_name() -> void:
	var n := HeaderModel.clean_name(name_edit.text)
	if Store.project.is_empty() or n == str(Store.project.get("name", "")):
		return
	if n == "":
		name_edit.text = str(Store.project.get("name", ""))
		return
	Store.project["name"] = n
	ProjectSync.mark_dirty(true)  # the server autosave retires the old slug (routes-data-project-handlers.js)


func save() -> void:
	_commit_name()
	save_btn.disabled = true
	var res: Dictionary = await ProjectSync.save_now()
	save_btn.disabled = false
	say(HeaderModel.notice("saved", "", HeaderModel.hhmm(Time.get_time_dict_from_system())) if res.ok else HeaderModel.notice("error", "Save failed: " + str(res.error), ""))


func load_slug(slug: String) -> void:
	say({"text": "Loading %s…" % slug, "tone": "muted"})
	var res: Dictionary = await Api.post_json("/api/project/load", {"slug": slug, "applyHardware": true})
	if not res.ok:
		say(HeaderModel.notice("error", "Load failed: " + str(res.error), ""))
		return
	await _adopt(HeaderModel.loaded_project(res.data))
	say(HeaderModel.load_notice(res.data))
	loaded.emit()


func new_project() -> void:
	new_btn.disabled = true
	var res: Dictionary = await Api.post_json("/api/project/new", {})
	new_btn.disabled = false
	var d: Dictionary = res.data if res.data is Dictionary else {}
	if not res.ok or not (d.get("project") is Dictionary):
		say(HeaderModel.notice("error", "New project failed: " + str(d.get("error", res.error)), ""))
		return
	await _adopt(d["project"])
	say({"text": "New project started", "tone": "ok"})


## The server switched shows: take its document, settings and runtime state (web startNewProject / finishImport),
## then push the deck so the live mirror matches.
func _adopt(project: Dictionary) -> void:
	ProjectSync.reset()
	Store.set_project(project)
	await Settings.load_from_server()
	var st: Dictionary = await Api.get_json("/api/state")
	if st.ok:
		Store.set_state(st.data)
	ProjectSync.send_deck_sync(true)


func _rmb(e: InputEvent, which: String) -> void:
	var mb := e as InputEventMouseButton
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_RIGHT:
		return
	_menu.clear()
	if which == "save":
		_menu.add_item("Save to file…", 0)
	else:
		_menu.add_item("Load from file…", 1)
	_menu.position = Vector2i(get_global_mouse_position())
	_menu.reset_size()
	_menu.popup()


## Save → write the server's stored file (credentials masked) to this computer; load → import a .json: the server
## stores it under its name and activates it like any other load.
func _pick_file(saving: bool) -> void:
	var dlg := FileDialog.new()
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.file_mode = FileDialog.FILE_MODE_SAVE_FILE if saving else FileDialog.FILE_MODE_OPEN_FILE
	dlg.filters = PackedStringArray(["*.json ; Project JSON"])
	dlg.title = "Save project to file" if saving else "Load project from file"
	dlg.current_dir = preload("res://core/platform.gd").home_dir()  # WO-686: Windows has no $HOME
	if saving:
		dlg.current_file = str(Store.project.get("name", "project")).replace(" ", "_") + ".json"
	dlg.size = Vector2i(760, 480)
	dlg.file_selected.connect(func(path: String) -> void:
		dlg.queue_free()
		if saving:
			_save_file(path)
		else:
			_load_file(path))
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


func _save_file(path: String) -> void:
	var res: Dictionary = await ProjectSync.save_now()
	var slug := str((res.data as Dictionary).get("slug", "")) if res.ok and res.data is Dictionary else ""
	# The server's bytes verbatim — a Godot JSON round trip would turn every integer into a float ("rev": 599.0).
	var got: Dictionary = await Api.get_bytes("/api/project/file/%s/download" % slug.uri_encode()) if slug != "" else res
	var f := FileAccess.open(path, FileAccess.WRITE) if got.ok else null
	if f == null:
		say(HeaderModel.notice("error", "Save to file failed: " + (str(got.error) if not got.ok else error_string(FileAccess.get_open_error())), ""))
		return
	f.store_buffer(got.bytes)
	f.close()
	say({"text": "Saved to " + path, "tone": "ok"})


func _load_file(path: String) -> void:
	var parsed := HeaderModel.parse_project_file(FileAccess.get_file_as_string(path))
	if parsed.has("error"):
		say(HeaderModel.notice("error", str(parsed.error), ""))
		return
	var res: Dictionary = await Api.post_json("/api/project/save", {"project": parsed.project, "allowReplace": true})
	if not res.ok:
		say(HeaderModel.notice("error", "Load from file failed: " + str(res.error), ""))
		return
	await load_slug(str((res.data as Dictionary).get("slug", "")))
