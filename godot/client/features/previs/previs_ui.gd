extends RefCounted
## WO-948 — small layout helpers for the previs Inspector page (owner 05.11: "try to do a clean up and better
## organization of the inspector inside the previs tab").
## - fit_list / fit_scroll: a list is as tall as its rows, up to a cap — the page had five fixed 96–140 px boxes that
##   stayed that tall when empty (stage objects, models, live-texture screens, programmer heads, stage marks), most of
##   the scrolling on a fresh project.
## - caption: the small muted label above a control that had none (the host_controls_base style).

const ThemeBuilder := preload("res://app/theme_builder.gd")


static func button(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.pressed.connect(on_press)
	return b


static func caption(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


## The height of `rows` rows of `list` (its panel margins included); 0 rows = just the panel.
static func list_height(list: ItemList, rows: int) -> float:
	var pad := list.get_theme_stylebox("panel").get_minimum_size().y if list.has_theme_stylebox("panel") else 4.0
	if rows <= 0 or list.item_count == 0:
		return pad
	var row := list.get_item_rect(0).size.y + float(list.get_theme_constant("v_separation"))
	return pad + row * rows


## `list` grows with its items up to `max_rows`, then scrolls; empty it is one thin line. Refits on every redraw (an
## item added or removed redraws the list); only a changed height is set, so it does not loop.
static func fit_list(list: ItemList, max_rows := 6) -> void:
	list.custom_minimum_size.y = 0.0
	list.draw.connect(func() -> void:
		var h := list_height(list, mini(list.item_count, max_rows))
		if absf(list.custom_minimum_size.y - h) > 0.5:
			list.custom_minimum_size.y = h)


## A ScrollContainer around `box`: as tall as the box's content, at most `cap` px.
static func fit_scroll(scroll: ScrollContainer, box: Control, cap: float) -> void:
	var fit := func() -> void: scroll.custom_minimum_size.y = minf(cap, box.get_combined_minimum_size().y)
	box.minimum_size_changed.connect(fit)
	fit.call()
