extends GraphEdit
## WO-863 — the Visuals tab's Flow view: the binding graph (visuals_model.gd) as GraphNodes. WO-1011: every node type of
## the library (flow_nodes.gd — Sources, Math, Animate, Triggers & logic, Output; op logic after cables.gl, MIT, see
## THIRD_PARTY_NOTICES). Each input is its own port (a link `[from, to, port]`); an input with a fallback field shows
## the field in its row (used while nothing is linked). Right-click adds a node from a category menu; Delete removes the
## selection; "Load preset" replaces the graph with a ready-made patch (flow_presets.gd), "Add preset" puts one below it.
## Every edit emits `changed` with the whole graph (the tab stores it in project.visuals).

const M := preload("res://features/visuals/visuals_model.gd")
const N := preload("res://features/visuals/flow_nodes.gd")
const P := preload("res://features/visuals/flow_presets.gd")

signal changed(graph: Dictionary)

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
	_menu = _add_menu()
	add_child(_menu)
	popup_request.connect(func(at: Vector2) -> void:
		_menu_at = (at + scroll_offset) / zoom
		_menu.position = Vector2i(get_screen_position() + at)
		_menu.popup())
	var bar := get_menu_hbox()
	bar.add_child(_preset_button("Load preset", "Replace the whole graph with a ready-made patch", false))
	bar.add_child(_preset_button("Add preset", "Add a ready-made patch below the graph", true))


## Right-click: "Add ▸" per category, each type with its title.
func _add_menu() -> PopupMenu:
	var m := PopupMenu.new()
	for cat in N.CATS:
		var sub := PopupMenu.new()
		for t in N.of_cat(cat):
			sub.add_item(N.TYPES[t].t)
			sub.set_item_metadata(sub.item_count - 1, t)
		sub.index_pressed.connect(func(i: int) -> void: _add(str(sub.get_item_metadata(i)), _menu_at))
		m.add_submenu_node_item(cat, sub)
	return m


func _preset_button(text: String, tip: String, add: bool) -> MenuButton:
	var b := MenuButton.new()
	b.text = text + " ▾"
	b.flat = false
	b.tooltip_text = tip
	var pm := b.get_popup()
	if not add:
		pm.add_item("Empty graph")
		pm.set_item_metadata(0, -1)
		pm.add_separator()
	var groups := P.groups()
	for g in groups:
		var sub := PopupMenu.new()
		for i in groups[g]:
			sub.add_item(P.LIST[i][0])
			sub.set_item_metadata(sub.item_count - 1, i)
			sub.set_item_tooltip(sub.item_count - 1, P.LIST[i][2])
		sub.index_pressed.connect(func(k: int) -> void: apply_preset(int(sub.get_item_metadata(k)), add))
		pm.add_submenu_node_item(g, sub)
	pm.index_pressed.connect(func(k: int) -> void:
		if pm.get_item_metadata(k) is int and int(pm.get_item_metadata(k)) == -1:
			apply_preset(-1, false))
	return b


## Preset `i` (P.LIST index; −1 = empty) replaces the graph, or (`add`) joins it below.
func apply_preset(i: int, add: bool) -> void:
	var g: Dictionary
	if i < 0:
		g = {"nodes": [], "links": []}
	else:
		g = P.add_to(graph if not graph.is_empty() else {"nodes": [], "links": []}, i) if add else P.graph(i)
	set_graph(M.normalize_graph(g))
	changed.emit(graph.duplicate(true))


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
		connect_node(StringName(l[0]), 0, StringName(l[1]), N.port_of(l))
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
	var spec: Dictionary = N.TYPES[n.type]
	var gn := GraphNode.new()
	gn.name = n.id
	gn.title = spec.t
	gn.tooltip_text = "%s · %s" % [spec.t, spec.cat]
	gn.position_offset = Vector2(n.x, n.y)
	gn.custom_minimum_size.x = 200
	var c := N.color(n.type)
	var inline := {}  # property keys shown in an input's row
	var ins: Array = spec.ins
	# a lone plain input shares the first field's row (compact, as WO-863's nodes): no separate "In" row
	var rows := 0 if ins.size() == 1 and not (ins[0][1] is String) and not spec.props.is_empty() else ins.size()
	for i in rows:
		var row := HBoxContainer.new()
		var fb: Variant = ins[i][1]
		var prop: Array = []
		if fb is String:
			for p in spec.props:
				if p[0] == fb:
					prop = p
		if prop.is_empty():
			var l := Label.new()
			l.text = ins[i][0]
			row.add_child(l)
		else:
			row.add_child(_field(n, prop, ins[i][0]))
			inline[prop[0]] = true
		gn.add_child(row)
	for p in spec.props:
		if not inline.has(p[0]):
			gn.add_child(_field(n, p, p[1]))
	for i in gn.get_child_count():
		gn.set_slot(i, i < ins.size(), 0, c, i == 0 and N.has_out(n.type), 0, c)
	var meter := ProgressBar.new()
	meter.max_value = 1.0
	meter.show_percentage = false
	meter.custom_minimum_size = Vector2(0, 4)
	gn.add_child(meter)
	gn.set_meta("meter", meter)
	return gn


## One property's control: a number box, or a pick list (options, buses, parameters), with its label when it has one.
func _field(n: Dictionary, p: Array, label: String) -> Control:
	var id: String = n.id
	var key: String = p[0]
	var ctl: Control
	match str(p[2]):
		"f":
			var s := SpinBox.new()
			s.min_value = p[4]
			s.max_value = p[5]
			s.step = 0.0  # no snapping (Range snaps from min_value: 0.3 in a 0.01…, step 0.05 box read 0.31); arrows step
			s.value = n[key]
			s.custom_arrow_step = p[6]
			s.value_changed.connect(func(v: float) -> void: _set_prop(id, key, v))
			ctl = s
		_:
			var items: Array = M.BUSES if p[2] == "bus" else (M.PARAMS if p[2] == "param" else p[4])
			ctl = _pick(items, str(n[key]), func(v: String) -> void: _set_prop(id, key, v))
	if label == "":
		ctl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		return ctl
	var h := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	h.add_child(ctl)
	return h


func _pick(items: Array, current: String, cb: Callable) -> OptionButton:
	var o := OptionButton.new()
	o.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for i in items.size():
		o.add_item(items[i])
		if items[i] == current:
			o.select(i)
	o.item_selected.connect(func(i: int) -> void: cb.call(items[i]))
	return o


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
	var n := N.make(type, "n%d" % i, at.x, at.y)
	graph.nodes.append(n)
	add_child(_build(n))
	_emit()


func _on_connect(from: StringName, _fp: int, to: StringName, tp: int) -> void:
	var link := [str(from), str(to)] if tp == 0 else [str(from), str(to), tp]
	var g := M.normalize_graph({"nodes": graph.nodes, "links": graph.links + [link]})
	if g.links.size() == graph.links.size():
		return  # refused (from an output-less node, a missing port, a duplicate)
	graph = g
	connect_node(from, 0, to, tp)
	_emit()


func _on_disconnect(from: StringName, _fp: int, to: StringName, tp: int) -> void:
	disconnect_node(from, 0, to, tp)
	graph.links = graph.links.filter(func(l: Array) -> bool:
		return not (l[0] == str(from) and l[1] == str(to) and N.port_of(l) == tp))
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
