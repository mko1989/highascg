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


## WO-1093 — a folded section: a flat "▸ title" toggle (accent, heading size) over a body that is hidden until opened.
## Panes inside the body fetch on their own `visibility_changed`, so a closed fold costs no request. Returns the body.
static func fold(parent: Node, title: String, open := false) -> VBoxContainer:
	var b := Button.new()
	b.flat = true
	b.toggle_mode = true
	b.button_pressed = open
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	b.add_theme_font_size_override("font_size", 18)
	for state in ["font_color", "font_hover_color", "font_pressed_color", "font_hover_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(state, ThemeBuilder.ACCENT)
	b.text = fold_label(title, open)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	body.visible = open
	b.toggled.connect(func(on: bool) -> void:
		body.visible = on
		b.text = fold_label(title, on))
	parent.add_child(b)
	parent.add_child(body)
	return body


static func fold_label(title: String, open: bool) -> String:
	return ("▾ " if open else "▸ ") + title


## A self-contained pane (its own first heading) in a fold titled `title`: the pane's heading of the same text is hidden
## so the title is not shown twice. Returns the pane.
static func fold_pane(parent: Node, title: String, pane: Control, open := false) -> Control:
	var hide_heading := func() -> void:
		var first := pane.get_child(0) if pane.get_child_count() > 0 else null
		if first is Label and (first as Label).text == title:
			(first as Label).visible = false
	if not pane.is_node_ready():
		pane.ready.connect(hide_heading, CONNECT_ONE_SHOT)  # most panes build their children in _ready
	fold(parent, title, open).add_child(pane)
	hide_heading.call()  # already built (in the tree, or made before)
	return pane


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
