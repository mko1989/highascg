extends RefCounted
## WO-1029 — the deck's "No screen" group: looks whose destination no longer exists (or whose old index names no screen
## of today). They are kept, never shown under whatever screen sits at their old index; a take needs a screen, so the
## cards here only offer "Attach to…" (or a drag onto a screen's column). The repair line per group calls
## POST /api/project/rescope-looks (deck_view.gd rescope_group) — box B's wall looks ("2" after two deletes) are one.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const DestScope := preload("res://core/dest_scope.gd")
const DeckModel := preload("res://features/live/deck_model.gd")
const Reorder := preload("res://features/live/deck_reorder.gd")
const CARD_W := 200


## The words of one repair group (`from` = old index | dead destination id | "unscoped").
static func group_text(from: String, n: int) -> String:
	var looks := "%d look%s" % [n, "" if n == 1 else "s"]
	if from.is_valid_int():
		return "%s of screen %d (no longer there) — attach to" % [looks, from.to_int() + 1]
	if from == DestScope.UNSCOPED:
		return "%s with no screen — attach to" % looks
	return "%s of a deleted destination — attach to" % looks


## `deck` = deck_view.gd (rescope_group / rescope_look / action_result).
static func build(deck: Node, looks: Array, id_list: Array, cm: Dictionary) -> Control:
	var col := VBoxContainer.new()
	col.custom_minimum_size.x = 240
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 8)
	var head := Label.new()
	head.text = "No screen  ·  %d looks" % looks.size()
	head.add_theme_color_override("font_color", ThemeBuilder.WARN)
	head.tooltip_text = "Looks whose screen was deleted. They are kept; attach them to a screen (or drag one onto a screen's column) to take them."
	col.add_child(head)
	var groups := DestScope.repair_groups(looks)
	for from in groups:
		col.add_child(_repair_row(deck, str(from), int(groups[from]), cm))
	var grid := HFlowContainer.new()
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	grid.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for s in looks:
		grid.add_child(_card(deck, s, cm))
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(grid)
	col.add_child(scroll)
	return col


static func _screens_menu(cm: Dictionary, on_pick: Callable) -> MenuButton:
	var mb := MenuButton.new()
	mb.text = "screen…"
	mb.flat = false
	mb.focus_mode = Control.FOCUS_NONE
	var pm := mb.get_popup()
	for i in DeckModel.screen_count(cm):
		pm.add_item(DeckModel.screen_label(cm, i), i)
	pm.id_pressed.connect(on_pick)
	return mb


static func _repair_row(deck: Node, from: String, n: int, cm: Dictionary) -> Control:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = group_text(from, n)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 1
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	l.add_theme_font_size_override("font_size", 12)
	row.add_child(l)
	row.add_child(_screens_menu(cm, func(main: int) -> void: deck.rescope_group(from, main)))
	return row


static func _card(deck: Node, scene: Dictionary, cm: Dictionary) -> Control:
	var id := str(scene.get("id", ""))
	var card := PanelContainer.new()
	card.custom_minimum_size.x = CARD_W
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.WARN, 1))
	card.tooltip_text = "No screen — drag onto a screen's column, or attach it to one"
	Reorder.wire(card, id, DestScope.NO_SCREEN, str(scene.get("name", "")), func() -> Dictionary: return deck._scenes_root(), func() -> void: pass)
	var row := HBoxContainer.new()
	var name_l := Label.new()
	name_l.text = str(scene.get("name", "(unnamed)"))
	name_l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	name_l.custom_minimum_size.x = 1
	name_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(name_l)
	row.add_child(_screens_menu(cm, func(main: int) -> void:
		deck.rescope_look(id, main)
		deck._commit_looks()))
	card.add_child(row)
	return card
