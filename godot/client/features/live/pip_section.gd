extends VBoxContainer
## WO-601 — "PIP Overlays" group of the look-layer inspector (web inspector-pip-overlay.js
## renderPipOverlayGroup): stacked HTML-template overlays (border, shadow, edge strip, glow, router), at most
## `pipMaxStack`; add / remove / reorder (index 0 behind) / change type / params with `visibleWhen` rows
## toggled in place (no rebuild — a dragged slider stays alive). Emits the whole new list; the look editor
## patches `pipOverlays` → deck sync → preview-push; the server take builds the CG lines.

signal changed(list: Array)

const P := preload("res://features/live/pip_model.gd")
const F := preload("res://features/live/param_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _registry: Array = []
var _max := 4
var _list_data: Array = []
var _add: OptionButton
var _cards: VBoxContainer


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var title := Label.new()
	title.text = "PIP Overlays"
	add_child(title)
	_cards = VBoxContainer.new()
	_cards.add_theme_constant_override("separation", 6)
	add_child(_cards)
	_add = OptionButton.new()
	_add.item_selected.connect(_on_add)
	add_child(_add)
	_rebuild()


## GET /api/scene/effect-registry `pipOverlays` + `pipMaxStack`.
func set_registry(overlays: Array, max_stack: int) -> void:
	_registry = overlays
	_max = maxi(1, max_stack)
	_rebuild()


func show_overlays(list: Array) -> void:
	if list == _list_data and _cards != null and _cards.get_child_count() > 0:
		return  # echo of our own edit
	_list_data = list.duplicate(true)
	if is_node_ready():
		_rebuild()


func _on_add(i: int) -> void:
	_add.select(0)
	if i > 0 and i <= _registry.size():
		_commit(P.add(_list_data, _registry, str(_registry[i - 1].type), _max))


func _commit(next: Array, rebuild := true) -> void:
	if next == _list_data and rebuild:
		return
	_list_data = next
	changed.emit(next.duplicate(true))
	if rebuild:
		_rebuild()


func _rebuild() -> void:
	for c in _cards.get_children():
		c.queue_free()
	for i in _list_data.size():
		var def := P.def_of(_registry, str(_list_data[i].get("type", "")))
		if not def.is_empty():
			_cards.add_child(_card(i, def))
	_add.clear()
	_add.add_item("Add overlay…" if _list_data.size() < _max else "At most %d overlays per layer" % _max)
	for d in _registry:
		_add.add_item(str(d.get("label", d.type)))
	_add.disabled = _list_data.size() >= _max
	if _list_data.is_empty():
		var hint := Label.new()
		hint.text = "First in the list is drawn behind; last on top (e.g. shadow, then border)."
		hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_cards.add_child(hint)


func _card(i: int, def: Dictionary) -> Control:
	var card := VBoxContainer.new()
	var head := HBoxContainer.new()
	var lbl := Label.new()
	lbl.text = str(def.get("label", def.type))
	lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(lbl)
	for spec in [["↑", -1, "Move earlier (drawn behind overlays below)"], ["↓", 1, "Move later (drawn on top)"]]:
		var b := Button.new()
		b.text = spec[0]
		b.tooltip_text = spec[2]
		var dir: int = spec[1]
		b.disabled = (dir < 0 and i == 0) or (dir > 0 and i >= _list_data.size() - 1)
		b.pressed.connect(func() -> void: _commit(P.move(_list_data, i, dir)))
		head.add_child(b)
	var rm := Button.new()
	rm.text = "✕"
	rm.tooltip_text = "Remove %s" % lbl.text
	rm.pressed.connect(func() -> void: _commit(P.remove(_list_data, i)))
	head.add_child(rm)
	card.add_child(head)
	var g := GridContainer.new()
	g.columns = 2
	_label(g, "Type")
	var ts := OptionButton.new()
	for d in _registry:
		ts.add_item(str(d.get("label", d.type)))
	ts.select(maxi(0, _registry.map(func(d: Dictionary) -> String: return str(d.type)).find(str(def.type))))
	ts.item_selected.connect(func(k: int) -> void: _commit(P.set_type(_list_data, i, _registry, str(_registry[k].type))))
	g.add_child(ts)
	var schema: Array = def.get("schema", [])
	var gated: Array = []  # [label, control, field]
	for s in schema:
		var key := str(s.key)
		var params: Dictionary = _list_data[i].get("params", {})
		var v: Variant = params.get(key) if params.get(key) != null else s.get("default")
		var l := _label(g, F.label_for(s))
		var c := F.control(s, v, func(nv: Variant) -> void:
			_commit(P.set_param(_list_data, i, key, nv), false)
			_sync_gated(gated, i, schema))
		g.add_child(c)
		if s.has("visibleWhen"):
			gated.append([l, c, s])
	_sync_gated(gated, i, schema)
	card.add_child(g)
	card.add_child(HSeparator.new())
	return card


func _sync_gated(gated: Array, i: int, schema: Array) -> void:
	if i >= _list_data.size():
		return
	var params: Dictionary = _list_data[i].get("params", {})
	for row in gated:
		var on := P.field_visible(row[2], params, schema)
		row[0].visible = on
		row[1].visible = on


func _label(g: GridContainer, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	return l
