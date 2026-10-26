extends RefCounted
## A deck column's header (web scene-list-column.js head): the screen's title — WO-781: a click highlights the screen as
## a look-preset destination (E2 style, destinations.gd) — then TAKE, FTB, screen timers and global border.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Icons := preload("res://app/ui_icons.gd")
const Destinations := preload("res://features/live/destinations.gd")


## `deck` = deck_view.gd (its request_take / request_ftb and Inspector signals).
static func build(deck: Node, title: String, n_looks: int, bus: Dictionary, main: int, cm: Dictionary) -> HBoxContainer:
	var head_row := HBoxContainer.new()
	head_row.mouse_filter = Control.MOUSE_FILTER_PASS  # its gaps are blank deck space (BlankClear)
	var on := Destinations.is_on(main)
	var dest := Button.new()
	dest.text = "%s  ·  %d looks" % [title, n_looks]
	dest.flat = not on
	dest.toggle_mode = true
	dest.button_pressed = on
	dest.focus_mode = Control.FOCUS_NONE
	dest.alignment = HORIZONTAL_ALIGNMENT_LEFT
	dest.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	dest.custom_minimum_size.x = 1
	dest.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dest.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	if on:
		for k in ["normal", "pressed", "hover", "hover_pressed"]:
			dest.add_theme_stylebox_override(k, ThemeBuilder.box(ThemeBuilder.BG_ELEVATED, ThemeBuilder.ACCENT, 2))
		for k in ["font_color", "font_pressed_color", "font_hover_color", "font_hover_pressed_color"]:
			dest.add_theme_color_override(k, ThemeBuilder.ACCENT)
	dest.tooltip_text = "Destination for look presets: click to highlight / unhighlight — a preset saves and recalls the highlighted screens"
	dest.toggled.connect(func(_p: bool) -> void: Destinations.toggle(main))
	head_row.add_child(dest)
	var take := Button.new()
	take.text = "TAKE"
	take.tooltip_text = "Take the look on PRV to PGM"
	take.disabled = str(bus.prv) == ""
	take.pressed.connect(func() -> void: deck.request_take(str(bus.prv), main, "program"))
	head_row.add_child(take)
	var ftb := Button.new()
	ftb.text = "FTB"
	ftb.tooltip_text = "Fade to black (PGM + PRV), then clear"
	ftb.pressed.connect(func() -> void: deck.request_ftb(main, cm))
	head_row.add_child(ftb)
	var tmr := Icons.button("timer", "Screen timers")
	tmr.pressed.connect(func() -> void: deck.timers_requested.emit(main, title))
	head_row.add_child(tmr)
	var brd := Button.new()
	brd.text = "Border"
	brd.tooltip_text = "Global border for this screen"
	brd.pressed.connect(func() -> void: deck.border_requested.emit(main, title))
	head_row.add_child(brd)
	return head_row
