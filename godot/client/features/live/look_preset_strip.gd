extends HFlowContainer
## WO-781 / WO-783 — the look preset cards of the right column's "Look presets" tab (look_preset_page.gd hosts them;
## E2 preset list). A click loads the preset to PRV, ▶ takes it with each look's own transition, ⋯ holds Auto / Cut /
## Overwrite / Remove. Green = on PRV now, red = on PGM. Recall and edits go through the page, which owns the list.

const M := preload("res://features/live/look_preset_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const Destinations := preload("res://features/live/destinations.gd")
const CARD_W := 170

var page: Node  # look_preset_page.gd
var _dirty := true


func _ready() -> void:
	add_theme_constant_override("h_separation", 8)
	add_theme_constant_override("v_separation", 8)
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
	for c in get_children():
		c.queue_free()
	var looks: Dictionary = page._looks()
	var bus: Dictionary = page.true_buses()
	for p in page.presets():
		if p is Dictionary:
			add_child(_card(p, looks, bus))
	if page.presets().is_empty():
		var e := Label.new()
		e.text = "No look presets yet."
		e.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		add_child(e)


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
	row.add_child(_menu(p))
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


## ⋯ — the rarer actions (the old Inspector page's Library buttons).
func _menu(p: Dictionary) -> MenuButton:
	var id := str(p.get("id", ""))
	var mb := MenuButton.new()
	mb.text = "⋯"
	mb.tooltip_text = "Auto / Cut / Overwrite / Remove"
	var pm := mb.get_popup()
	pm.add_item("Auto — take with the deck's default transition", 0)
	pm.add_item("Cut to PGM", 1)
	pm.add_item("Overwrite with the current %s" % M.source_label(str(p.get("sourceKind", "prv"))), 2)
	pm.add_separator()
	pm.add_item("Remove", 3)
	var acts: Array[Callable] = [
		func() -> void: page.recall(id, "program", false, true),
		func() -> void: page.recall(id, "program", true),
		func() -> void: page._confirm_overwrite(p),
		func() -> void: page.confirm_remove(p),
	]
	pm.id_pressed.connect(func(item: int) -> void: acts[item].call())
	return mb
