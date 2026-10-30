extends GraphEdit
## WO-863 — the Visuals tab's Flow view: the binding graph (visuals_model.gd) as GraphNodes. Audio bus (one output) →
## Shape (gain, attack, release; in + out) → Parameter (one input). Right-click adds a node; Delete removes the selection.
## Every edit emits `changed` with the whole graph (the tab stores it in project.visuals).

const M := preload("res://features/visuals/visuals_model.gd")

signal changed(graph: Dictionary)

const TITLES := {"bus": "Audio bus", "shape": "Shape", "param": "Parameter"}
const COLORS := {"bus": Color("#4fc3f7"), "shape": Color("#ffd54f"), "param": Color("#ef5350")}

var graph := {}
var levels := {}  # node id → live value 0..1, drawn as each node's meter
var _quiet := false
var _scrolled := false
var _menu: PopupMenu
var _menu_at := Vector2.ZERO


func _ready() -> void:
	right_disconnects = true
	show_zoom_label = false
	minimap_enabled = false
	connection_request.connect(_on_connect)
	disconnection_request.connect(_on_disconnect)
	delete_nodes_request.connect(_on_delete)
	end_node_move.connect(_store_positions)
	_menu = PopupMenu.new()
	for t in ["bus", "shape", "param"]:
		_menu.add_item("Add " + TITLES[t].to_lower())
		_menu.set_item_metadata(_menu.item_count - 1, t)
	_menu.id_pressed.connect(func(id: int) -> void: _add(str(_menu.get_item_metadata(_menu.get_item_index(id))), _menu_at))
	add_child(_menu)
	popup_request.connect(func(at: Vector2) -> void:
		_menu_at = (at + scroll_offset) / zoom
		_menu.position = Vector2i(get_screen_position() + at)
		_menu.popup())


func set_graph(g: Dictionary) -> void:
	graph = g.duplicate(true)
	_quiet = true
	clear_connections()
	for c in get_children():
		if c is GraphNode:
			remove_child(c)
			c.queue_free()
	for n in graph.nodes:
		add_child(_build(n))
	for l in graph.links:
		connect_node(StringName(l[0]), 0, StringName(l[1]), 0)
	_quiet = false
	if not _scrolled:  # first fill: the top row starts under GraphEdit's own toolbar, not behind it
		_scrolled = true
		scroll_offset = Vector2(-10, -56)


## Live values beside each node's title (the tab calls this every frame while the view shows).
func show_levels(values: Dictionary) -> void:
	levels = values
	for c in get_children():
		var gn := c as GraphNode
		if gn and gn.has_meta("meter"):
			(gn.get_meta("meter") as ProgressBar).value = float(values.get(str(gn.name), 0.0))


func _build(n: Dictionary) -> GraphNode:
	var gn := GraphNode.new()
	gn.name = n.id
	gn.title = TITLES[n.type]
	gn.position_offset = Vector2(n.x, n.y)
	gn.custom_minimum_size.x = 180
	var row := HBoxContainer.new()
	gn.add_child(row)
	match n.type:
		"bus":
			row.add_child(_pick(M.BUSES, n.bus, func(v: String) -> void: _set_prop(n.id, "bus", v)))
		"param":
			row.add_child(_pick(M.PARAMS, n.param, func(v: String) -> void: _set_prop(n.id, "param", v)))
		"shape":
			var box := VBoxContainer.new()
			box.add_child(_spin("Gain", n.gain, -4, 4, 0.05, func(v: float) -> void: _set_prop(n.id, "gain", v)))
			box.add_child(_spin("Attack ms", n.attack, 0, 5000, 5, func(v: float) -> void: _set_prop(n.id, "attack", v)))
			box.add_child(_spin("Release ms", n.release, 0, 10000, 10, func(v: float) -> void: _set_prop(n.id, "release", v)))
			row.add_child(box)
	var meter := ProgressBar.new()
	meter.max_value = 1.0
	meter.show_percentage = false
	meter.custom_minimum_size = Vector2(0, 4)
	gn.add_child(meter)
	gn.set_meta("meter", meter)
	var c: Color = COLORS[n.type]
	gn.set_slot(0, n.type != "bus", 0, c, n.type != "param", 0, c)
	return gn


func _pick(items: Array, current: String, cb: Callable) -> OptionButton:
	var o := OptionButton.new()
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for i in items.size():
		o.add_item(items[i])
		if items[i] == current:
			o.select(i)
	o.item_selected.connect(func(i: int) -> void: cb.call(items[i]))
	return o


func _spin(label: String, v: float, lo: float, hi: float, step: float, cb: Callable) -> HBoxContainer:
	var h := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = step
	s.value = v
	s.value_changed.connect(cb)
	h.add_child(s)
	return h


func _node(id: String) -> Dictionary:
	for n in graph.nodes:
		if n.id == id:
			return n
	return {}


func _set_prop(id: String, key: String, v: Variant) -> void:
	var n := _node(id)
	if n.is_empty():
		return
	n[key] = v
	_emit()


func _add(type: String, at: Vector2) -> void:
	var i: int = graph.nodes.size() + 1
	while not _node("n%d" % i).is_empty():
		i += 1
	var n := {"id": "n%d" % i, "type": type, "x": at.x, "y": at.y}
	match type:
		"bus":
			n.bus = "loudness"
		"shape":
			n.merge({"gain": 1.0, "attack": 10.0, "release": 200.0})
		"param":
			n.param = "pulse"
	graph.nodes.append(n)
	add_child(_build(n))
	_emit()


func _on_connect(from: StringName, _fp: int, to: StringName, _tp: int) -> void:
	var g := M.normalize_graph({"nodes": graph.nodes, "links": graph.links + [[str(from), str(to)]]})
	if g.links.size() == graph.links.size():
		return  # refused (param → x, x → bus, duplicate)
	graph = g
	connect_node(from, 0, to, 0)
	_emit()


func _on_disconnect(from: StringName, _fp: int, to: StringName, _tp: int) -> void:
	disconnect_node(from, 0, to, 0)
	graph.links = graph.links.filter(func(l: Array) -> bool: return not (l[0] == str(from) and l[1] == str(to)))
	_emit()


func _on_delete(names: Array) -> void:
	var gone := names.map(func(n: Variant) -> String: return str(n))
	graph.nodes = graph.nodes.filter(func(n: Dictionary) -> bool: return not n.id in gone)
	graph.links = graph.links.filter(func(l: Array) -> bool: return not (l[0] in gone or l[1] in gone))
	set_graph(graph)
	_emit()


func _store_positions() -> void:
	for n in graph.nodes:
		var gn := get_node_or_null(NodePath(n.id)) as GraphNode
		if gn:
			n.x = gn.position_offset.x
			n.y = gn.position_offset.y
	_emit()


func _emit() -> void:
	if not _quiet:
		changed.emit(graph.duplicate(true))
