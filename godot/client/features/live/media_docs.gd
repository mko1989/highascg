extends Node
## WO-1009 — the Sources Media tree with "media only" off (owner 09.11: "add to the media browser a toggle media only and
## let me browse the other project files there"): the MVR / GLB / PDF / Excel files under the media folders
## (GET /api/media-docs) join the tree in their folders. A document row is not media: it never drags onto a layer and
## opens no media page. Double-click (or Enter) opens it with this machine's viewer; right-click → Open · Download to
## this computer… · Delete…. Out of media_panel.gd for the 500-line limit.

const PF := preload("res://core/project_files.gd")
const FilePick := preload("res://features/devices/file_pick.gd")
const PaneKit := preload("res://features/settings/pane_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var shown := false  # "media only" off
var rows: Array = []  # [{id, kind, size, mtime, doc: true}]
var _tree: Tree
var _panel: Node


## `panel` = media_panel.gd: its status line, its project bar's "media only" check box, its tree rebuild.
func bind(tree: Tree, panel: Node) -> void:
	_tree = tree
	_panel = panel
	tree.add_child(self)
	shown = not panel.project_bar.media_only()
	panel.project_bar.media_toggled.connect(func(only: bool) -> void:
		shown = not only
		panel.load_media())
	tree.item_activated.connect(func() -> void:
		var it := tree.get_selected()
		var m: Variant = it.get_metadata(0) if it != null else null
		if m is Dictionary and (m as Dictionary).has("doc"):
			open(str(m.doc.id)))
	tree.gui_input.connect(_input)


## Fetch the documents when they are shown (an empty list otherwise).
func fetch_rows() -> void:
	rows = []
	if not shown:
		return
	var res: Dictionary = await Api.get_json("/api/media-docs")
	for d in (res.data if res.ok and res.data is Array else []):
		var r: Dictionary = (d as Dictionary).duplicate()
		r["doc"] = true
		rows.append(r)


## Media rows plus the documents (a document's id is its path, as a media id).
func merged(media: Array) -> Array:
	return media + rows if shown else media


## A tree row for `row` when it is a document (→ true: the caller skips its media setup).
func decorate(it: TreeItem, row: Dictionary) -> bool:
	if row.get("doc") != true:
		return false
	var id := str(row.id)
	it.set_metadata(0, {"doc": row})  # no "value" / "row": not dragged, not a media selection
	it.set_tooltip_text(0, "%s · double-click opens it" % id)
	it.set_text(1, "%s · %s" % [PF.KIND_TEXT.get(str(row.kind), str(row.kind)), PF.size_text(int(row.size))])
	it.set_custom_color(1, ThemeBuilder.TEXT_MUTED)
	it.set_custom_color(0, ThemeBuilder.TEXT_MUTED)
	return true


func open(id: String) -> void:
	_panel._line("Opening %s…" % id.get_file())
	var err: String = await PF.open_from(PF.doc_url(id), id.get_file())
	_panel._line(err if err != "" else "Opened %s" % id.get_file())


func _input(e: InputEvent) -> void:
	var mb := e as InputEventMouseButton
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_RIGHT:
		return
	var it := _tree.get_item_at_position(mb.position)
	var m: Variant = it.get_metadata(0) if it != null else null
	if not (m is Dictionary and (m as Dictionary).has("doc")):
		return
	_tree.accept_event()
	var id := str(m.doc.id)
	var menu := PopupMenu.new()
	menu.add_item("Open", 0)
	menu.add_item("Download to this computer…", 1)
	menu.add_item("Delete…", 2)
	var gone := func() -> void: _delete(id)
	menu.id_pressed.connect(func(i: int) -> void:
		if i == 0:
			open(id)
		elif i == 1:
			_download(id)
		else:
			PaneKit.confirm(self, "Delete %s from the server?" % id, gone))
	menu.popup_hide.connect(menu.queue_free, CONNECT_DEFERRED)
	add_child(menu)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:
		at += get_window().position
	menu.popup(Rect2i(at, Vector2i.ZERO))


func _download(id: String) -> void:
	var path: String = await FilePick.save_path(self, "Download to this computer", id.get_file(), ["*.%s" % id.get_extension()])
	if path == "":
		return
	var res: Dictionary = await Api.get_bytes(PF.doc_url(id))
	var err: String = FilePick.write_bytes(path, res.bytes) if res.ok else str(res.error)
	_panel._line("✓ Saved %s" % path if err == "" else "✗ %s" % err)


func _delete(id: String) -> void:
	var res: Dictionary = await Api.delete_json(PF.doc_url(id))
	_panel._line("Deleted %s" % id.get_file() if res.ok else "✗ Could not delete %s: %s" % [id.get_file(), res.error])
	_panel.load_media()
