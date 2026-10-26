extends VBoxContainer
## WO-781 — look presets as cards in the card section (E2 preset list), above the screen columns. A click loads the
## preset to PRV, ▶ takes it with each look's own transition, ⚙ opens the Inspector page (Auto / Cut / Overwrite /
## Remove). "+" saves the highlighted destinations' PRV. Green = on PRV now, red = on PGM. Shown / hidden by the deck
## toolbar's "Presets". Recall and save go through the page (look_preset_page.gd), which owns the preset list.

signal manage_requested

const M := preload("res://features/live/look_preset_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const Destinations := preload("res://features/live/destinations.gd")
const CARD_W := 170

var page: Node  # look_preset_page.gd
var _flow: HFlowContainer
var _dirty := true


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := HBoxContainer.new()
	var l := Label.new()
	l.text = "Presets"
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	head.add_child(l)
	var cog := Icons.button("cog", "Look presets: save from PGM / open look, Auto, Cut, overwrite, remove", 12)
	cog.pressed.connect(func() -> void: manage_requested.emit())
	head.add_child(cog)
	add_child(head)
	_flow = HFlowContainer.new()
	_flow.add_theme_constant_override("h_separation", 8)
	_flow.add_theme_constant_override("v_separation", 8)
	add_child(_flow)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _dirty = true)
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "scene.live" or path == "channelMap" or path == Destinations.PATH:
			_dirty = true)
	visibility_changed.connect(func() -> void: _dirty = true)


func _process(_delta: float) -> void:
	if _dirty and is_visible_in_tree() and page != null:
		_dirty = false
		rebuild()


func rebuild() -> void:
	for c in _flow.get_children():
		c.queue_free()
	var looks: Dictionary = page._looks()
	var bus: Dictionary = page.true_buses()
	for p in page.presets():
		if p is Dictionary:
			_flow.add_child(_card(p, looks, bus))
	_flow.add_child(_add_tile())


func _card(p: Dictionary, looks: Dictionary, bus: Dictionary) -> Control:
	var id := str(p.get("id", ""))
	var on_pgm := M.loaded_on_bus(p, bus, "pgm")
	var on_prv := not on_pgm and M.loaded_on_bus(p, bus, "prv")
	var border := ThemeBuilder.ACCENT_RED if on_pgm else (ThemeBuilder.ACCENT_GREEN if on_prv else ThemeBuilder.BORDER)
	var card := PanelContainer.new()
	card.custom_minimum_size.x = CARD_W
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, border, 3 if (on_pgm or on_prv) else 1))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.tooltip_text = "Click: load to PRV (its destinations) · ▶: take to PGM"
	card.gui_input.connect(func(ev: InputEvent) -> void:
		var mb := ev as InputEventMouseButton
		if mb != null and mb.button_index == MOUSE_BUTTON_LEFT and not mb.pressed:
			page.recall(id, "preview"))
	var v := VBoxContainer.new()
	card.add_child(v)
	var row := HBoxContainer.new()
	var name_l := Label.new()
	name_l.text = str(p.get("name", ""))
	name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_l.custom_minimum_size.x = 1
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_l)
	var play := Icons.button("play", "Take to PGM — every destination with its look's own transition", 12)
	play.pressed.connect(func() -> void: page.recall(id, "program"))
	row.add_child(play)
	v.add_child(row)
	var meta := Label.new()
	meta.text = M.dest_line(p, looks)
	meta.tooltip_text = meta.text
	meta.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	meta.add_theme_font_size_override("font_size", 12)
	meta.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	meta.custom_minimum_size.x = 1
	v.add_child(meta)
	return card


func _add_tile() -> Control:
	var b := Button.new()
	b.text = "+"
	b.custom_minimum_size = Vector2(56, 48)
	b.focus_mode = Control.FOCUS_NONE
	var none := Destinations.selected().is_empty()
	b.disabled = none
	b.tooltip_text = "Highlight destinations first: click a screen's title below" if none else "Save the highlighted destinations' PRV as a look preset"
	b.pressed.connect(func() -> void: page.ask_name("prv"))
	return b
