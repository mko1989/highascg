extends VBoxContainer
## WO-600 K (first slice) — media sources: folder tree from GET /api/media (ids are "FOLDER/SUB/CLIP"),
## filter, drag into the look editor. Drag payload = the web's {type, value, label} (operator-compose-tiles.js).
## WO-602 slice 9: an EFFECTS group (web sources-panel-effects.js — the registry by category, filtered by label or
## category) whose items drag {type: "effect"} onto timeline clips.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const MediaInspector := preload("res://features/live/media_inspector.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const TYPES := {"MOVIE": "media", "STILL": "media", "AUDIO": "media"}

var _filter: LineEdit
var _tree: Tree
var _rows: Array = []
var _fx: Dictionary = {}  # GET /api/scene/effect-registry {effects, categories}
var inspector: MediaInspector


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
	inspector = MediaInspector.new()  # WO-608 R2: shown in the global Inspector column when a file is selected
	inspector.library_changed.connect(load_media)
	Api.post_json("/api/media/preview", {"action": "stop"})  # a previous run killed mid-preview leaves the clip on the layer
	_tree.item_selected.connect(func() -> void:
		var it := _tree.get_selected()
		var meta: Variant = it.get_metadata(0) if it != null else null
		if meta is Dictionary and (meta as Dictionary).get("row") is Dictionary:
			InspectorPanel.current.present(inspector)
			inspector.show_media(meta.row))
	if Config.args.has("sources-filter"):  # dev: preset the filter (tests)
		_filter.text = str(Config.args["sources-filter"])
	load_media()


func load_media() -> void:
	var res: Dictionary = await Api.get_json("/api/media")
	_rows = res.data if res.ok and res.data is Array else []
	if _fx.is_empty():
		var fr: Dictionary = await Api.get_json("/api/scene/effect-registry")
		_fx = fr.data if fr.ok and fr.data is Dictionary else {}
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
	if it == null or not (it.get_metadata(0) is Dictionary):
		return null
	var l := Label.new()
	l.text = "＋ " + it.get_text(0)
	set_drag_preview(l)
	var data: Dictionary = (it.get_metadata(0) as Dictionary).duplicate()
	data.erase("row")  # the payload is the web shape {type, value, label}; the row is for the inspector only
	return data


func _exit_tree() -> void:
	if inspector != null and not inspector.is_inside_tree():  # never selected → never adopted by the Inspector
		inspector.free()
