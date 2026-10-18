extends VBoxContainer
## WO-601 — "Mixer Effects" group of the look-layer inspector (web inspector-effects.js renderEffectsGroup):
## add (one per type), remove, per-param editors from the web's own schemas (GET /api/scene/effect-registry),
## advanced params collapsed, crop edited in px of the content resolution. Emits the whole new effects
## array; the look editor patches the layer → deck sync → preview-push, which nudges (effects are not
## content keys) with every effect line + identity resets for removed ones.

signal changed(effects: Array)

const E := preload("res://features/live/effects_model.gd")
const F := preload("res://features/live/param_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _registry: Array = []
var _effects: Array = []
var _content := Vector2i.ZERO
var _add: OptionButton
var _list: VBoxContainer
var _open_adv := {}  # type → advanced section expanded


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var title := Label.new()
	title.text = "Mixer Effects"
	add_child(title)
	_add = OptionButton.new()
	_add.item_selected.connect(_on_add)
	add_child(_add)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 6)
	add_child(_list)
	_fill_add_menu()
	_rebuild()


## GET /api/scene/effect-registry `effects` (the layer inspector fetches it once for every section).
func set_registry(effects: Array) -> void:
	_registry = effects
	_fill_add_menu()
	_rebuild()


func _fill_add_menu() -> void:
	_add.clear()
	_add.add_item("Choose effect to add…")
	for d in _registry:
		_add.add_item(str(d.get("label", d.type)))


## content = layer content resolution (crop px editing); ZERO → fractions.
## An echo of our own edit (same array) does not rebuild — the dragged slider stays alive.
func show_effects(effects: Array, content: Vector2i) -> void:
	if effects == _effects and content == _content and _list != null and _list.get_child_count() > 0:
		return
	_effects = effects.duplicate(true)
	_content = content
	if is_node_ready():
		_rebuild()


func _on_add(i: int) -> void:
	_add.select(0)
	if i <= 0 or i > _registry.size():
		return
	var next := E.add(_effects, _registry, str(_registry[i - 1].type))
	if next.size() != _effects.size():
		_commit(next)


func _commit(next: Array) -> void:
	_effects = next
	changed.emit(next.duplicate(true))
	_rebuild()


func _rebuild() -> void:
	for c in _list.get_children():
		c.queue_free()
	for i in _effects.size():
		var fx: Variant = _effects[i]
		if not (fx is Dictionary):
			continue
		var def := E.def_of(_registry, str(fx.get("type", "")))
		if not def.is_empty():
			_list.add_child(_card(i, fx, def))
	if _effects.is_empty():
		var hint := Label.new()
		hint.text = "No effects — choose one above."
		hint.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		_list.add_child(hint)


func _card(i: int, fx: Dictionary, def: Dictionary) -> Control:
	var card := VBoxContainer.new()
	var head := HBoxContainer.new()
	var lbl := Label.new()
	lbl.text = str(def.get("label", def.type))
	lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(lbl)
	var rm := Button.new()
	rm.text = "✕"
	rm.tooltip_text = "Remove %s" % lbl.text
	rm.pressed.connect(func() -> void: _commit(E.remove(_effects, i)))
	head.add_child(rm)
	card.add_child(head)
	var g := _grid()
	for s in E.primary(def):
		_param(g, i, fx, s)
	card.add_child(g)
	var adv := E.advanced(def)
	if not adv.is_empty():
		var t := str(def.type)
		var only_adv := E.primary(def).is_empty()
		var tog := Button.new()
		tog.flat = true
		tog.alignment = HORIZONTAL_ALIGNMENT_LEFT
		var ga := _grid()
		ga.visible = only_adv or _open_adv.get(t, false)
		tog.text = ("▾ " if ga.visible else "▸ ") + ("Parameters" if only_adv else "Advanced")
		tog.pressed.connect(func() -> void:
			ga.visible = not ga.visible
			_open_adv[t] = ga.visible
			tog.text = ("▾ " if ga.visible else "▸ ") + ("Parameters" if only_adv else "Advanced"))
		for s in adv:
			_param(ga, i, fx, s)
		card.add_child(tog)
		card.add_child(ga)
	card.add_child(HSeparator.new())
	return card


func _grid() -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	return g


func _param(g: GridContainer, i: int, fx: Dictionary, s: Dictionary) -> void:
	var dim := E.px_dim(s, _content)
	var l := Label.new()
	l.text = F.label_for(s, dim)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	var key := str(s.key)
	g.add_child(F.control(s, E.value_of(fx, s), func(v: Variant) -> void: _set_param(i, key, v), dim))


## A param edit emits without rebuilding the cards (keeps the slider being dragged alive).
func _set_param(i: int, key: String, v: Variant) -> void:
	_effects = E.set_param(_effects, i, key, v)
	changed.emit(_effects.duplicate(true))
