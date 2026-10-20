extends RefCounted
## WO-608 — the few widgets the hand-built Settings panes share (heading / muted note / button / key-value grid).

const ThemeBuilder := preload("res://app/theme_builder.gd")


static func heading(parent: Node, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	l.add_theme_font_size_override("font_size", 18)
	parent.add_child(l)
	return l


static func note(parent: Node, text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	parent.add_child(l)
	return l


static func button(parent: Node, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


static func row(parent: Node) -> HBoxContainer:
	var r := HBoxContainer.new()
	r.add_theme_constant_override("separation", 10)
	parent.add_child(r)
	return r


## Replace `grid`'s children with [label, value] rows (muted labels).
static func fill_grid(grid: GridContainer, rows: Array) -> void:
	for c in grid.get_children():
		c.queue_free()
	for kv in rows:
		for i in 2:
			var l := Label.new()
			l.text = str(kv[i])
			if i == 0:
				l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
			else:
				l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			grid.add_child(l)


static func grid(parent: Node) -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 24)
	parent.add_child(g)
	return g


## Confirm with Cancel focused (a stray Enter must do nothing); `then` runs on OK.
static func confirm(host: Node, text: String, then: Callable) -> void:
	var d := ConfirmationDialog.new()
	d.dialog_text = text
	d.confirmed.connect(then)
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	host.add_child(d)
	d.popup_centered()
	d.get_cancel_button().grab_focus.call_deferred()


## One-line text prompt (web window.prompt). `then(text)` runs on OK / Enter; Cancel does nothing.
static func prompt(host: Node, title: String, initial: String, then: Callable) -> void:
	var d := ConfirmationDialog.new()
	d.title = title
	var e := LineEdit.new()
	e.text = initial
	e.custom_minimum_size.x = 360
	d.add_child(e)
	d.register_text_enter(e)
	d.confirmed.connect(func() -> void: then.call(e.text))
	d.visibility_changed.connect(func() -> void:
		if not d.visible:
			d.queue_free())
	host.add_child(d)
	d.popup_centered()
	e.grab_focus.call_deferred()
	e.select_all.call_deferred()
