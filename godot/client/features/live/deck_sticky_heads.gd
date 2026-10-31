extends Control
## Live deck: every screen's header bar (deck_head.gd: destination, TAKE, FTB, timers, border) stays visible while the
## deck scrolls (owner 31.10.26). The headers live in this overlay — later in the tree than the columns, so drawn and
## clicked on top — and each column keeps an empty slot of its header's height; every frame a header sits over its
## slot, pushed down to the scroll offset. Clicks on a header's gaps reach the column (WO-342 PRV clear) and drops on
## it act as the column's (WO-623 B new look), as before.

const ThemeBuilder := preload("res://app/theme_builder.gd")

var _pairs: Array = []  # [slot in the column, header panel here]


## `deck` (the ScrollContainer) → its content: `columns` with this overlay on top, both filling it.
static func mount(deck: ScrollContainer, columns: Control) -> Control:
	var content := MarginContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	deck.add_child(content)
	content.add_child(columns)
	var heads := new()
	heads.mouse_filter = Control.MOUSE_FILTER_IGNORE
	content.add_child(heads)
	return heads


func clear() -> void:
	for p in _pairs:
		(p[1] as Node).queue_free()
	_pairs.clear()


## `head` moves here on an opaque panel; → the slot to put in the column where the header was.
func slot(head: Control, col: Control, can_drop: Callable, drop: Callable) -> Control:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = ThemeBuilder.BG_DARK  # the tab's background: cards scrolling under the header are hidden
	panel.add_theme_stylebox_override("panel", sb)
	panel.mouse_filter = Control.MOUSE_FILTER_PASS  # the wheel still scrolls the deck
	panel.gui_input.connect(func(ev: InputEvent) -> void: col.gui_input.emit(ev))
	panel.set_drag_forwarding(Callable(), can_drop, drop)
	panel.add_child(head)
	add_child(panel)
	var s := Control.new()
	s.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var fit := func() -> void: s.custom_minimum_size.y = panel.get_combined_minimum_size().y
	panel.minimum_size_changed.connect(fit)
	fit.call()
	_pairs.append([s, panel])
	return s


func follow(scroll_y: float) -> void:
	for p in _pairs:
		var s: Control = p[0]
		var panel: Control = p[1]
		if not is_instance_valid(s) or not s.is_inside_tree():
			continue
		var at := s.global_position - global_position
		panel.position = Vector2(at.x, maxf(at.y, scroll_y))
		panel.size = Vector2(s.size.x, s.custom_minimum_size.y)
