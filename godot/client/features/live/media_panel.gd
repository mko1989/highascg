extends VBoxContainer
## WO-600 K (first slice) — media sources: folder tree from GET /api/media (ids are "FOLDER/SUB/CLIP"),
## filter, drag into the look editor. Drag payload = the web's {type, value, label} (operator-compose-tiles.js).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const TYPES := {"MOVIE": "media", "STILL": "media", "AUDIO": "media"}

var _filter: LineEdit
var _tree: Tree
var _rows: Array = []


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
	refresh.tooltip_text = "Reload the media list"
	refresh.pressed.connect(load_media)
	head.add_child(refresh)
	add_child(head)
	_filter = LineEdit.new()
	_filter.placeholder_text = "Filter…"
	_filter.text_changed.connect(func(_t: String) -> void: _build())
	add_child(_filter)
	_tree = Tree.new()
	_tree.hide_root = true
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.set_drag_forwarding(_drag_data, Callable(), Callable())
	add_child(_tree)
	if Config.args.has("sources-filter"):  # dev: preset the filter (tests)
		_filter.text = str(Config.args["sources-filter"])
	load_media()


func load_media() -> void:
	var res: Dictionary = await Api.get_json("/api/media")
	_rows = res.data if res.ok and res.data is Array else []
	_build()


func _build() -> void:
	_tree.clear()
	var root := _tree.create_item()
	var dirs := {"": root}
	var f := _filter.text.strip_edges().to_lower()
	for r in _rows:
		if not (r is Dictionary) or r.get("isDir", false):
			continue
		var id := str(r.get("id", ""))
		if id == "" or (f != "" and not id.to_lower().contains(f)):
			continue
		var parts := id.split("/")
		var parent: TreeItem = root
		var acc := ""
		for i in parts.size() - 1:
			acc = parts[i] if acc == "" else acc + "/" + parts[i]
			if not dirs.has(acc):
				var d := _tree.create_item(parent)
				d.set_text(0, parts[i])
				d.collapsed = f == ""
				dirs[acc] = d
			parent = dirs[acc]
		var it := _tree.create_item(parent)
		it.set_text(0, parts[parts.size() - 1])
		it.set_tooltip_text(0, "%s · %s" % [id, r.get("type", "")])
		it.set_metadata(0, {"type": TYPES.get(str(r.get("type", "")), "media"), "value": id, "label": id})


func _drag_data(at: Vector2) -> Variant:
	var it := _tree.get_item_at_position(at)
	if it == null or not (it.get_metadata(0) is Dictionary):
		return null
	var l := Label.new()
	l.text = "＋ " + it.get_text(0)
	set_drag_preview(l)
	return it.get_metadata(0)
