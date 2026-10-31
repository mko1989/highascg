extends VBoxContainer
## WO-885 — the Sources "Visuals" tab (owner 31.10): every visual the Visuals canvas can run — the built-in scenes, the box's
## shader library, the operator's ROMs — in folders (visuals_catalog.gd), each row with a thumbnail rendered on this client
## (visuals_thumbs.gd, only for open folders). WO-890: drag a row onto the Visuals canvas or the Inspector's layer list = a new
## layer on top, onto a layer row (or the canvas with Shift) = that layer replaced; double-click replaces the selected layer.
## Every visual running on any layer is highlighted.

const Catalog := preload("res://features/visuals/visuals_catalog.gd")
const Layers := preload("res://features/visuals/visuals_layers.gd")
const Thumbs := preload("res://features/visuals/visuals_thumbs.gd")
const Launcher := preload("res://features/visuals/game_launcher.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const UI_CFG := "user://ui.cfg"
const ICON_W := 96
const GROUP := "visuals_list"  # visuals_tab.gd tells it what is on the canvas

var thumbs: Thumbs
var _filter: LineEdit
var _note: Label
var _tree: Tree
var _shaders := []  # GET /api/shaders rows
var _items := {}  # thumb key → [TreeItem]
var _all := []  # every row item (for the live highlight)
var _live := []  # the canvas's layers (WO-890)
var _loaded := false
var _blank: Texture2D


func _ready() -> void:
	add_to_group(GROUP)
	add_theme_constant_override("separation", 4)
	_filter = LineEdit.new()
	_filter.placeholder_text = "Filter…"
	_filter.clear_button_enabled = true
	_filter.text_changed.connect(func(_t: String) -> void: rebuild())
	add_child(_filter)
	var cfg := get_node_or_null("/root/Config")
	if cfg and cfg.args.has("visuals-filter"):  # dev: --visuals-filter=<text> (a probe client opens filtered = every folder open)
		_filter.text = str(cfg.args["visuals-filter"])
	_note = Label.new()
	_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_note.add_theme_font_size_override("font_size", 11)
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(_note)
	_tree = Tree.new()
	_tree.hide_root = true
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.set_drag_forwarding(_drag, Callable(), Callable())
	_tree.item_collapsed.connect(_on_collapsed)
	_tree.item_activated.connect(func() -> void:
		var it := _tree.get_selected()
		if it != null and it.get_metadata(0) is Dictionary:
			get_tree().call_group("visuals_canvas", "run_visual", it.get_metadata(0)))
	add_child(_tree)
	thumbs = Thumbs.new()
	thumbs.fetch = _shader_config
	thumbs.thumb_ready.connect(_on_thumb)
	add_child(thumbs)
	var img := Image.create(ICON_W, ICON_W * 9 / 16, false, Image.FORMAT_RGB8)
	img.fill(ThemeBuilder.BG_PANEL.lightened(0.06))
	_blank = ImageTexture.create_from_image(img)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree() and not _loaded:
			reload()
		elif not is_visible_in_tree():
			thumbs.clear_queue())


func _api() -> Variant:
	var dt := get_node_or_null("/root/DevicesTarget")
	return dt.box_api if dt != null and dt.box_api != null else get_node_or_null("/root/Api")


## Re-reads the shader library and the ROM folders.
func reload() -> void:
	_loaded = true
	var api: Variant = _api()
	_shaders = []
	if api != null:
		var r: Dictionary = await api.get_json("/api/shaders")
		if r.get("ok") and r.get("data") is Dictionary and r.data.get("shaders") is Array:
			_shaders = r.data.shaders
	rebuild()


func _shader_config(id: String) -> Variant:
	var api: Variant = _api()
	if api == null:
		return null
	var r: Dictionary = await api.get_json("/api/shaders/" + id.uri_encode())
	return r.data if r.get("ok") and r.get("data") is Dictionary else null


func rebuild() -> void:
	if _tree == null:
		return
	thumbs.clear_queue()
	var filtering := _filter.text.strip_edges() != ""
	var rows := Catalog.rows(_shaders, Launcher.games(), _filter.text)
	var open := _open()
	_tree.clear()
	_items.clear()
	_all.clear()
	var root := _tree.create_item()
	var folders := {}  # path → TreeItem
	var counts := {}
	for r in rows:
		var parts: PackedStringArray = r.folder.split("/")
		for i in parts.size():
			var path := "/".join(parts.slice(0, i + 1))
			counts[path] = int(counts.get(path, 0)) + 1
			if not folders.has(path):
				var f := _tree.create_item(folders.get("/".join(parts.slice(0, i)), root) if i > 0 else root)
				f.set_meta("folder", path)
				f.set_selectable(0, false)
				f.collapsed = not filtering and not open.has(path)
				folders[path] = f
		_row(folders[r.folder], r)
	for path in folders:
		folders[path].set_text(0, "%s  %d" % [path.get_file(), counts[path]])
	_note.text = ("No visuals match" if filtering else "No visuals: the shader library is on the box") if rows.is_empty() else \
		"Drag onto the Visuals canvas: a new layer (Shift: replaces the selected one) · double-click replaces the selected layer"
	_request_open()


func _row(parent: TreeItem, r: Dictionary) -> void:
	var it := _tree.create_item(parent)
	it.set_text(0, r.name)
	it.set_metadata(0, r.payload)
	it.set_tooltip_text(0, r.tip + "\n\nDrag onto the Visuals canvas or a layer · double-click replaces the selected layer")
	var tex: Texture2D = thumbs.texture(r.thumb)
	it.set_icon(0, tex if tex != null else (Icons.texture("play", 24) if r.thumb == "" else _blank))
	it.set_icon_max_width(0, ICON_W)
	_all.append(it)
	if r.thumb != "":
		it.set_meta("thumb", r.thumb)
		if not _items.has(r.thumb):
			_items[r.thumb] = []
		_items[r.thumb].append(it)
		if thumbs.failed.has(r.thumb):
			it.set_tooltip_text(0, "%s\n\nNo thumbnail: %s" % [it.get_tooltip_text(0), thumbs.failed[r.thumb]])
	_mark(it)


## Thumbnails for the rows of every open folder, top to bottom.
func _request_open() -> void:
	var stack: Array = [_tree.get_root()]
	while not stack.is_empty():
		var parent: TreeItem = stack.pop_front()
		if parent == null:
			continue
		for it in parent.get_children():
			if it.has_meta("folder"):
				if not it.collapsed:
					stack.append(it)
			elif it.has_meta("thumb") and is_visible_in_tree():
				thumbs.request(str(it.get_meta("thumb")), it.get_metadata(0))


func _on_thumb(key: String, tex: Texture2D) -> void:
	for it in _items.get(key, []):
		if not is_instance_valid(it):
			continue
		if tex != null:
			it.set_icon(0, tex)
		elif thumbs.failed.has(key):
			it.set_icon(0, Icons.texture("warning", 24))
			it.set_tooltip_text(0, "%s\n\nNo thumbnail: %s" % [it.get_tooltip_text(0), thumbs.failed[key]])


## Open folders, remembered in ui.cfg [sources] visuals_open (Scenes open the first time).
func _open() -> Array:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	var v: Variant = cfg.get_value("sources", "visuals_open", ["Scenes"])
	return v if v is Array else []


func _on_collapsed(it: TreeItem) -> void:
	if not it.has_meta("folder"):
		return
	if not it.collapsed:
		_request_open()
	if _filter.text.strip_edges() != "":
		return
	var open := _open()
	var path := str(it.get_meta("folder"))
	open.erase(path)
	if not it.collapsed:
		open.append(path)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("sources", "visuals_open", open)
	cfg.save(UI_CFG)


## visuals_tab.gd (group call): what the canvas runs now — the rows of every layer's visual are highlighted.
func mark_live(slice: Dictionary) -> void:
	_live = (slice.get("layers") as Array).duplicate(true) if slice.get("layers") is Array else []
	for it in _all:
		if is_instance_valid(it):
			_mark(it)


func _mark(it: TreeItem) -> void:
	var p: Dictionary = it.get_metadata(0)
	var on := Layers.runs(_live, p)
	it.set_custom_color(0, ThemeBuilder.ACCENT if on else ThemeBuilder.TEXT)


func _drag(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	if it == null or not (it.get_metadata(0) is Dictionary):
		return null
	var h := HBoxContainer.new()
	var t := TextureRect.new()
	t.texture = it.get_icon(0)
	t.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	t.custom_minimum_size = Vector2(ICON_W, ICON_W * 9 / 16)
	h.add_child(t)
	var l := Label.new()
	l.text = it.get_text(0)
	h.add_child(l)
	set_drag_preview(h)
	return it.get_metadata(0).duplicate()
