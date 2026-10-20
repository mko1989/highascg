extends VBoxContainer
## WO-600 K (first slice) — media sources: folder tree from GET /api/media (ids are "FOLDER/SUB/CLIP"),
## filter, drag into the look editor. Drag payload = the web's {type, value, label} (operator-compose-tiles.js).
## WO-602 slice 9: an EFFECTS group (web sources-panel-effects.js — the registry by category, filtered by label or
## category) whose items drag {type: "effect"} onto timeline clips.
## WO-605 slice 12: a DeckLink port dragged off the Devices rear panel drops on the list and becomes a live input
## (web sources-panel-decklink-drop.js, decklink_drop_flow.gd).
## WO-622: two tabs like the web Sources panel — Media (this tree) and Live (live_sources_panel.gd: PGM/PRV routes,
## DeckLink / audio / USB inputs, saved live sources, all draggable onto the look editor). A DeckLink dropped on the
## Media tree switches to Live, which maps it and highlights the new source; the signals are Live's, re-emitted for
## the shell (Live workspace tab, Devices restart-dirty, device view re-read).
## WO-623 C: the owner's four tabs — Media, Templates (Caspar TLS; shaders show their library name), Live, Timelines (this
## project's) — source_list_panel.gd rows drag the web payload ({type: "template" | "timeline", value, label}).
## WO-603 slice 1: files / folders dropped from the desktop onto this panel are copied by the server from their local
## paths into the folder under the cursor (media_ingest.gd; POST /api/media/ingest-local) with a progress line.
## WO-603 slice 2: multi-select + the web selection bar (media_selection_bar.gd: Copy to… / Move to… / Delete / New
## folder…); the tree is media_ops.tree_entries — empty on-disk folders show (a new folder is visible before anything
## is in it) and CLS upper-case folders merge into the on-disk one, as on the web.
## WO-603: project media bar (project_media_bar.gd) — project folder, "project only" filter, Gather.

signal tab_requested(name: String)
signal caspar_changed
signal connector_dropped

const UsbImport := preload("res://features/live/usb_import_dialog.gd")
const ShaderFx := preload("res://features/live/shader_fx_dialog.gd")
const ShaderLivePanel := preload("res://features/live/shader_live_panel.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const MediaInspector := preload("res://features/live/media_inspector.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const Drop := preload("res://features/devices/decklink_drop_flow.gd")
const LivePanel := preload("res://features/live/live_sources_panel.gd")
const ListPanel := preload("res://features/live/source_list_panel.gd")
const Lists := preload("res://features/live/source_lists_model.gd")
const Upload := preload("res://core/stream_upload.gd")
const Ingest := preload("res://features/live/media_ingest.gd")
const SelectionBar := preload("res://features/live/media_selection_bar.gd")
const Ops := preload("res://features/live/media_ops.gd")
const ProjectBar := preload("res://features/live/project_media_bar.gd")
const Download := preload("res://features/live/media_download.gd")
const TYPES := {"MOVIE": "media", "STILL": "media", "AUDIO": "media"}

var _filter: LineEdit
var _tree: Tree
var _rows: Array = []
var _fx: Dictionary = {}  # GET /api/scene/effect-registry {effects, categories}
var inspector: MediaInspector
var _tabs: TabContainer
var live: LivePanel
var templates: ListPanel
var timelines: ListPanel
var _tls: Array = []  # GET /api/templates
var _shader_names := {}
var _ingest_row: HBoxContainer
var _ingest_label: Label
var _bar: SelectionBar
var _select_queued := false
var project_bar: ProjectBar
var _dl: Download


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := HBoxContainer.new()
	var l := Label.new()
	l.text = "Sources"
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(l)
	var refresh := Button.new()
	refresh.text = "↻"
	refresh.tooltip_text = "Reload the list"
	refresh.pressed.connect(_reload_current)
	head.add_child(refresh)
	add_child(head)
	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(_tabs)
	var media := VBoxContainer.new()
	media.name = "Media"
	media.add_theme_constant_override("separation", 4)
	_tabs.add_child(media)
	templates = ListPanel.new()
	templates.name = "Templates"
	templates.empty_text = "No templates (↻ re-reads Caspar TLS)"
	templates.provider = func(f: String) -> Array: return Lists.template_rows(_tls, _shader_names, f)
	templates.row_clicked.connect(func(p: Dictionary, kind: String) -> void:  # WO-606: audition while Shader Live is open
		var shl: Node = ShaderLivePanel.current
		if kind == "shader" and is_instance_valid(shl) and shl.is_visible_in_tree():
			shl.audition(str(p.get("value", "")), str(p.get("label", p.get("value", "")))))
	templates.row_context.connect(_template_menu)
	_tabs.add_child(templates)
	live = LivePanel.new()
	live.name = "Live"
	_tabs.add_child(live)
	timelines = ListPanel.new()
	timelines.name = "Timelines"
	timelines.empty_text = "No timelines in this project (Timeline tab → New)"
	timelines.provider = func(f: String) -> Array:
		var tl: Variant = Store.project.get("timelines")
		return Lists.timeline_rows((tl as Dictionary).get("timelines", []) if tl is Dictionary else [], f)
	_tabs.add_child(timelines)
	Store.project_changed.connect(func(_p: Dictionary) -> void: timelines.rebuild())
	_tabs.tab_changed.connect(func(_i: int) -> void:
		if _tabs.get_current_tab_control() == timelines:
			timelines.rebuild()
		elif _tabs.get_current_tab_control() == templates and _tls.is_empty():
			load_templates())
	live.tab_requested.connect(tab_requested.emit)
	live.caspar_changed.connect(caspar_changed.emit)
	live.connector_dropped.connect(connector_dropped.emit)
	project_bar = ProjectBar.new()
	project_bar.filter_toggled.connect(_build)
	project_bar.gathered.connect(func(text: String) -> void:
		_line(text)
		if not text.ends_with("…"):
			load_media())
	media.add_child(project_bar)
	_filter = LineEdit.new()
	_filter.placeholder_text = "Filter…"
	_filter.text_changed.connect(func(_t: String) -> void: _build())
	media.add_child(_filter)
	_tree = Tree.new()
	_tree.hide_root = true
	_tree.select_mode = Tree.SELECT_MULTI
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.set_drag_forwarding(_drag_data, _can_drop, _drop)
	_tree.gui_input.connect(_tree_input)
	media.add_child(_tree)
	_bar = SelectionBar.new()
	_bar.changed.connect(load_media)
	_bar.clear_requested.connect(func() -> void:
		_tree.deselect_all()
		_bar.set_selection([], ""))
	_bar.before_delete = func(sel: Array) -> void:
		if inspector.is_inside_tree() and Ops.covers(sel, str(inspector.id)):
			await inspector.preview.stop_preview()
			inspector.visible = false
	media.add_child(_bar)
	_bar.add_menu.files_chosen.connect(func(paths: PackedStringArray) -> void: _ingest(paths, _bar.folder))
	_bar.add_menu.url_chosen.connect(_download)
	_bar.add_menu.usb_requested.connect(func() -> void: UsbImport.show_import(self, load_media))
	_ingest_row = HBoxContainer.new()
	_ingest_row.visible = false
	_ingest_label = Label.new()
	_ingest_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_ingest_label.clip_text = true
	_ingest_label.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_ingest_row.add_child(_ingest_label)
	var stop := Button.new()
	stop.text = "✕"
	stop.tooltip_text = "Cancel the copy / hide"
	stop.pressed.connect(func() -> void:
		if _dl.active():
			_dl.cancel()
		elif _ingest_label.text.begins_with("Copying"):
			Api.post_json("/api/media/ingest-local/cancel", {})
		else:
			_ingest_row.visible = false)
	_ingest_row.add_child(stop)
	media.add_child(_ingest_row)
	_dl = Download.new()
	_dl.line.connect(_line)
	add_child(_dl)
	get_window().files_dropped.connect(_on_files_dropped)
	Ws.message.connect(func(type: String, data: Variant) -> void:
		if type == Ingest.EVENT and data is Dictionary:
			_show_ingest(data))
	inspector = MediaInspector.new()  # WO-608 R2: shown in the global Inspector column when a file is selected
	inspector.library_changed.connect(load_media)
	Api.post_json("/api/media/preview", {"action": "stop"})  # a previous run killed mid-preview leaves the clip on the layer
	_tree.multi_selected.connect(func(_it: TreeItem, _col: int, _on: bool) -> void:
		if not _select_queued:  # one update per click (a range select emits per row)
			_select_queued = true
			_on_selection.call_deferred())
	if Config.args.has("sources-filter"):  # dev: preset the filter (tests)
		_filter.text = str(Config.args["sources-filter"])
	if Config.args.has("sources-tab"):  # dev: open on Media (0), Templates (1), Live (2) or Timelines (3)
		_tabs.current_tab = int(Config.args["sources-tab"])
	load_media()


## The bar gets every selected file; the focused row picks the folder (New folder…, picker start) and — when it is
## the only file — the Inspector (web: a single selection announces the file).
func _on_selection() -> void:
	_select_queued = false
	var sel: Array = []
	var it := _tree.get_next_selected(null)
	while it != null:
		var m: Variant = it.get_metadata(0)
		if m is Dictionary and (m as Dictionary).get("row") is Dictionary:
			sel.append(str(m.value))
		it = _tree.get_next_selected(it)
	var focus := _tree.get_selected()
	var meta: Variant = focus.get_metadata(0) if focus != null else null
	_bar.set_selection(sel, Ingest.folder_for(meta))
	if sel.size() == 1 and meta is Dictionary and (meta as Dictionary).get("row") is Dictionary:
		InspectorPanel.current.present(inspector)
		inspector.show_media(meta.row)
	elif sel.size() > 1 and InspectorPanel.current.showing(inspector):
		InspectorPanel.current.release(inspector)  # several files have no one inspector; the covered page returns


## WO-603 slice 9: Delete / Backspace deletes the selected files (web sources-panel.js:336, same confirm); a
## right-click on a folder offers "Delete folder…" (the web ✕ on the folder row).
## Slice 11: a right-click on a file offers Download to this computer… and Delete… (owner 20.10: the right-click menu
## replaces the web's Alt / Ctrl+Alt+click shortcuts — openbox also grabs Alt+click for window moves).
func _tree_input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k != null and k.pressed and not k.echo and k.keycode in [KEY_DELETE, KEY_BACKSPACE] and not _bar.ids.is_empty():
		_tree.accept_event()
		_bar.confirm_delete()
		return
	var mb := event as InputEventMouseButton
	if mb == null or not mb.pressed:
		return
	if mb.button_index != MOUSE_BUTTON_RIGHT:
		return
	var file := _file_at(mb.position)
	var f: Variant = _folder_at(mb.position)
	if (f == null or str(f) == "") and file == "":
		return
	_tree.accept_event()
	var menu := PopupMenu.new()
	if file != "":
		menu.add_item("Download to this computer…", 0)
		menu.add_item("Delete…", 1)
		menu.id_pressed.connect(func(i: int) -> void:
			if i == 0:
				_dl.ask(file, Config.origin)
			else:
				_delete_one(file))
	else:
		menu.add_item("Delete folder…")
		menu.id_pressed.connect(func(_id: int) -> void: _bar.confirm_delete_folder(str(f)))
	menu.popup_hide.connect(menu.queue_free, CONNECT_DEFERRED)
	add_child(menu)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:  # embedded popups take window coordinates (deck_view._card_menu)
		at += get_window().position
	menu.popup(Rect2i(at, Vector2i.ZERO))


## A media file row under the pointer → its id, or "".
func _file_at(at: Vector2) -> String:
	var it := _tree.get_item_at_position(at)
	var m: Variant = it.get_metadata(0) if it != null else null
	return str(m.value) if m is Dictionary and (m as Dictionary).has("row") else ""


func _delete_one(id: String) -> void:
	_bar.set_selection([id], id.get_base_dir())
	_bar.confirm_delete()


## A folder row under the pointer (web: folders are the move targets), or null.
func _folder_at(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	var m: Variant = it.get_metadata(0) if it != null else null
	return m.folder if m is Dictionary and (m as Dictionary).has("folder") else null


## Desktop DeckLink connectors (live sources) or media files onto a folder (move; Alt = copy, like the web).
func _can_drop(at: Vector2, data: Variant) -> bool:
	var f: Variant = _folder_at(at)
	var files := f != null and not Ops.folder_drop_ids(data, str(f)).is_empty()
	_tree.drop_mode_flags = Tree.DROP_MODE_ON_ITEM if files else Tree.DROP_MODE_DISABLED
	return files or live.can_drop_connector(at, data)


func _drop(at: Vector2, data: Variant) -> void:
	_tree.drop_mode_flags = Tree.DROP_MODE_DISABLED
	var f: Variant = _folder_at(at)
	var ids: Array = Ops.folder_drop_ids(data, str(f)) if f != null else []
	if not ids.is_empty():
		_bar.transfer("copy" if Input.is_key_pressed(KEY_ALT) else "move", ids, str(f))
		return
	_tabs.current_tab = live.get_index()
	live.drop_connector(Drop.parse(data))


func _reload_current() -> void:
	match _tabs.get_current_tab_control():
		live: live.reload()
		templates: load_templates()
		timelines: timelines.rebuild()
		_: load_media()


## Web fetchTemplates (Refresh): GET /api/templates (the server's TLS catalogue) + shader library names.
func load_templates() -> void:
	var res: Dictionary = await Api.get_json("/api/templates")
	_tls = res.data if res.ok and res.data is Array else []
	var sh: Dictionary = await Api.get_json("/api/shaders")
	_shader_names = Lists.shader_names(sh.data if sh.ok else null)
	templates.rebuild()


func load_media() -> void:
	var res: Dictionary = await Api.get_json("/api/media")
	_rows = res.data if res.ok and res.data is Array else []
	_bar.rows = _rows
	project_bar.refresh()
	if _fx.is_empty():
		var fr: Dictionary = await Api.get_json("/api/scene/effect-registry")
		_fx = fr.data if fr.ok and fr.data is Dictionary else {}
	_build()


func _build() -> void:
	_tree.clear()
	var root := _tree.create_item()
	var dirs := {"": root}
	var f := _filter.text.strip_edges().to_lower()
	_bar.set_selection([], "")
	for e in Ops.tree_entries(Ops.in_folder(_rows, project_bar.folder) if project_bar.project_only() else _rows, f):
		var it := _tree.create_item(dirs[e.parent])
		it.set_text(0, e.label)
		if e.kind == "dir":
			it.collapsed = f == "" and not project_bar.project_only()
			it.set_metadata(0, {"folder": e.folder})
			dirs[e.key] = it
			continue
		var r: Dictionary = e.row
		var id := str(r.get("id", ""))
		it.set_tooltip_text(0, "%s · %s" % [id, r.get("type", "")])
		it.set_metadata(0, {"type": TYPES.get(str(r.get("type", "")), "media"), "value": id, "label": id, "row": r})

	_build_effects(root, f)


func _build_effects(root: TreeItem, f: String) -> void:
	var fx: Array = _fx.get("effects", []) if _fx.get("effects") is Array else []
	var cats: Array = _fx.get("categories", []) if _fx.get("categories") is Array else []
	var group: TreeItem = null
	for cat in cats:
		var head: TreeItem = null
		for e in fx:
			if not (e is Dictionary) or str(e.get("category", "")) != str(cat.get("id", "")):
				continue
			var label := str(e.get("label", e.get("type", "")))
			if f != "" and not label.to_lower().contains(f) and not str(e.get("category", "")).to_lower().contains(f):
				continue
			if group == null:
				group = _tree.create_item(root)
				group.set_text(0, "EFFECTS")
				group.collapsed = f == ""
			if head == null:
				head = _tree.create_item(group)
				head.set_text(0, str(cat.get("label", cat.get("id", ""))))
			var it := _tree.create_item(head)
			it.set_text(0, label)
			it.set_tooltip_text(0, "Mixer effect — drop on a timeline clip")
			it.set_metadata(0, {"type": "effect", "value": str(e.type), "label": label})

func _drag_data(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	if it == null or not (it.get_metadata(0) is Dictionary) or not (it.get_metadata(0) as Dictionary).has("value"):
		return null
	var sel: Array = []  # WO-603: a row inside a multi-selection drags the whole selection (web multi payload)
	var s := _tree.get_next_selected(null)
	while s != null:
		if s.get_metadata(0) is Dictionary and (s.get_metadata(0) as Dictionary).get("row") is Dictionary:
			sel.append(s.get_metadata(0))
		s = _tree.get_next_selected(s)
	var data := Ops.drag_payload(it.get_metadata(0), sel)  # the web shape; the row is for the inspector only
	var l := Label.new()
	l.text = "＋ %d files" % (data.items as Array).size() if data.get("type") == "multi" else "＋ " + it.get_text(0)
	set_drag_preview(l)
	return data


## Desktop drop (WO-603): only drops over this panel ingest; the folder under the cursor is the target.
func _on_files_dropped(files: PackedStringArray) -> void:
	if not is_visible_in_tree() or not get_global_rect().has_point(get_global_mouse_position()):
		return
	var folder := ""
	if _tabs.get_current_tab_control() == _tree.get_parent() and _tree.get_global_rect().has_point(get_global_mouse_position()):
		var it := _tree.get_item_at_position(_tree.get_local_mouse_position())
		folder = Ingest.folder_for(it.get_metadata(0) if it != null else null)
	_tabs.current_tab = _tree.get_parent().get_index()
	_ingest(files, folder)


## Local paths → the library: the server copies them (on the box); a client elsewhere is refused (403, loopback
## only) and streams them over HTTP instead (POST /api/ingest/upload, one file per request, `path` = its folder).
func _ingest(files: PackedStringArray, folder: String) -> void:
	_show_ingest({"phase": "copying", "fileTotal": files.size()})
	var res: Dictionary = await Api.post_json("/api/media/ingest-local", Ingest.request(files, folder))
	if res.ok:
		return
	if int(res.get("status", 0)) != 403:
		_show_ingest({"phase": "error", "message": "Ingest refused", "error": res.error})
		return
	var plan := Ingest.upload_plan(files, folder)
	var done := 0
	for i in plan.size():
		var file: String = plan[i].file
		var up: Dictionary = await Upload.upload(Config.origin, "/api/ingest/upload", file, func(sent: int, total: int) -> void:
			_line(Ingest.upload_text(i, plan.size(), sent, total, file)), {"path": plan[i].path})
		if not up.ok:
			_line("✗ Upload of %s failed: %s" % [file.get_file(), up.error])
			load_media()
			return
		done += 1
	_line("✓ Uploaded %d file%s" % [done, "" if done == 1 else "s"])
	load_media()


## Web URL ingest: the server downloads (POST /api/ingest/download) into the selected folder; poll its status.
func _download(url: String) -> void:
	_tabs.current_tab = _tree.get_parent().get_index()
	_line("Starting…")
	var body := {"url": url}
	if _bar.folder != "":
		body["path"] = _bar.folder
	var res: Dictionary = await Api.post_json("/api/ingest/download", body)
	if not res.ok:
		_line("✗ " + str(res.error))
		return
	while is_inside_tree():
		await get_tree().create_timer(0.45).timeout
		var st: Dictionary = await Api.get_json("/api/ingest/download-status")
		if not (st.ok and st.data is Dictionary):
			_line("✗ " + str(st.error))
			return
		_line(Ingest.download_text(st.data))
		if not st.data.get("active", false):
			load_media()
			return


func _line(text: String) -> void:
	_ingest_row.visible = text != ""
	_ingest_label.text = text
	_ingest_label.tooltip_text = text


func _show_ingest(st: Dictionary) -> void:
	_line(Ingest.status_text(st))
	if str(st.get("phase", "")) in ["complete", "cancelled", "error"] and st.has("updatedAt"):
		load_media()


func _exit_tree() -> void:
	if inspector != null and not inspector.is_inside_tree():  # never selected → never adopted by the Inspector
		inspector.free()


## WO-606: right-click a shader template → open it in the Shader FX editor (the web row's edit button).
func _template_menu(p: Dictionary, kind: String) -> void:
	if kind != "shader":
		return
	var menu := PopupMenu.new()
	menu.add_item("Edit shader…")
	menu.id_pressed.connect(func(_i: int) -> void: ShaderFx.show_editor(self, str(p.get("value", "")).to_lower().replace("\\", "/").get_file()))  # TLS ids are upper-case
	menu.popup_hide.connect(menu.queue_free, CONNECT_DEFERRED)
	add_child(menu)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:
		at += get_window().position
	menu.popup(Rect2i(at, Vector2i.ZERO))
