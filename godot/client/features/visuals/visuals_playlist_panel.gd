extends VBoxContainer
## WO-895 — the Visuals work area's "Visual playlist" mode: the editor of `project.visuals.playlists` (visuals_playlist.gd).
## Separate from the Inspector's Live "Playlists" (features/live/playlists_panel.gd, Caspar media on a look layer, run by
## the node); these run the Visuals canvas through Auto. A picker with New, the name, Loop / Shuffle, Run (Auto runs this
## playlist — the same switch as Auto ▸ "Visual playlist · …" in the Inspector's Show block) and ✕; under it the entries in
## order, each with its hold (bars, seconds or until a drop; the seconds are also the fallback while no tempo is locked),
## ▲ ▼ and ✕. Looks (the Show block's buttons) and Sources ▸ Visuals rows are dragged in: onto a row = before it, anywhere
## else = at the end. A double-click on an entry shows it now. Number fields follow RULES.md through core/numeric_field.gd
## (every SpinBox in the tree).

const P := preload("res://features/visuals/visuals_playlist.gd")
const Icons := preload("res://app/ui_icons.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal changed(playlists: Array)  # an edit — the whole list
signal run(id: String)  # Auto runs this playlist ("" = Auto off)
signal jump(id: String, entry: int)  # show this entry now

var playlists := []
var edit := -1  # the playlist being edited (its index)
var active := ""  # the playlist Auto runs ("" none)
var rows := []  # by entry index: {panel, mark, name, hold, bars, secs, up, down, del}
var rng := RandomNumberGenerator.new()
var _pick: OptionButton
var _name: LineEdit
var _mode: OptionButton
var _run: Button
var _del: Button
var _box: VBoxContainer
var _empty: Label
var _shape := ""
var _quiet := false


func _init() -> void:
	add_theme_constant_override("separation", 4)
	mouse_filter = Control.MOUSE_FILTER_STOP
	set_drag_forwarding(Callable(), func(_at: Vector2, d: Variant) -> bool: return P.can_drop(d),
		func(_at: Vector2, d: Variant) -> void: drop(d, -1))
	var head := HBoxContainer.new()
	add_child(head)
	_pick = OptionButton.new()
	_pick.fit_to_longest_item = false
	_pick.custom_minimum_size.x = 160
	_pick.tooltip_text = "The visual playlist to edit"
	_pick.item_selected.connect(func(i: int) -> void:
		edit = i
		_render())
	head.add_child(_pick)
	var add := Button.new()
	add.text = "New"
	add.tooltip_text = "A new, empty visual playlist"
	add.focus_mode = Control.FOCUS_NONE
	add.pressed.connect(func() -> void:
		var next := playlists.duplicate(true)
		if next.size() < P.MAX:
			next.append(P.new_playlist(next))
			edit = next.size() - 1
			changed.emit(next))
	head.add_child(add)
	_name = LineEdit.new()
	_name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_name.placeholder_text = "Name — Enter keeps it"
	_name.text_submitted.connect(func(_t: String) -> void: _rename())
	_name.focus_exited.connect(_rename)
	head.add_child(_name)
	_mode = OptionButton.new()
	_mode.add_item("Loop")
	_mode.add_item("Shuffle")
	_mode.tooltip_text = "Loop: in order, again from the top · Shuffle: every entry once per pass in a random order, never the same twice in a row"
	_mode.item_selected.connect(func(i: int) -> void: _edit_pl(P.with_mode(playlists[edit], P.MODES[i], rng)))
	head.add_child(_mode)
	_run = Button.new()
	_run.text = "Run"
	_run.toggle_mode = true
	_run.focus_mode = Control.FOCUS_NONE
	_run.tooltip_text = "Auto runs this playlist (the same switch as Auto in the Show block). Stopped and run again, it replays the entry it was on, its hold from the start"
	_run.toggled.connect(func(on: bool) -> void:
		if not _quiet and edit >= 0:
			run.emit(playlists[edit].id if on else ""))
	head.add_child(_run)
	_del = Icons.button("close", "Delete this visual playlist")
	_del.pressed.connect(func() -> void:
		if edit < 0:
			return
		var next := playlists.duplicate(true)
		next.remove_at(edit)
		edit = mini(edit, next.size() - 1)
		changed.emit(next))
	head.add_child(_del)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(scroll)
	_box = VBoxContainer.new()
	_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_box.add_theme_constant_override("separation", 3)
	_box.mouse_filter = Control.MOUSE_FILTER_PASS
	scroll.add_child(_box)
	_empty = Label.new()
	_empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_empty.modulate = Color(1, 1, 1, 0.6)
	_empty.mouse_filter = Control.MOUSE_FILTER_PASS
	_box.add_child(_empty)


## The list, the playlist Auto runs and where it is; the edited one stays picked (the running one when none is).
func set_state(pls: Array, active_id: String) -> void:
	playlists = pls.duplicate(true)
	active = active_id
	if edit < 0 or edit >= playlists.size():
		edit = maxi(P.find(playlists, active), 0) if not playlists.is_empty() else -1
	_render()


## A drag payload landed: before entry `to` (-1 = the end) of the edited playlist — a first playlist when there is none.
func drop(data: Variant, to: int) -> void:
	var e: Variant = P.entry_of_drop(data)
	if e == null:
		return
	var next := playlists.duplicate(true)
	if edit < 0:
		next.append(P.new_playlist(next))
		edit = next.size() - 1
	next[edit] = P.add_entry(next[edit], e, to)
	changed.emit(next)


func _render() -> void:
	_quiet = true
	_pick.clear()
	for p in playlists:
		_pick.add_item(("▶ " if p.id == active else "") + str(p.name))
	var pl: Dictionary = playlists[edit] if edit >= 0 else {}
	if edit >= 0:
		_pick.select(edit)
	for c in [_pick, _mode, _run, _del]:
		c.disabled = edit < 0
	_name.editable = edit >= 0
	if not _name.has_focus():
		_name.text = str(pl.get("name", ""))
	_mode.select(P.MODES.find(pl.get("mode", "loop")))
	_run.set_pressed_no_signal(edit >= 0 and pl.id == active)
	_empty.text = ("Drag looks here (Inspector ▸ Show: the look buttons) or visuals (Sources ▸ Visuals) — each plays for its hold, then the next"
		if edit >= 0 else "No visual playlist yet — New makes one, or drag a look or a visual here")
	var shape := "%d|%d" % [edit, pl.get("entries", []).size()]
	if shape != _shape:
		_shape = shape
		_build(pl.get("entries", []).size())
	_fill(pl)
	_quiet = false


func _build(n: int) -> void:
	for r in rows:
		_box.remove_child(r.panel)
		r.panel.queue_free()
	rows.clear()
	for i in n:
		rows.append(_row(i))
		_box.add_child(rows[i].panel)
	_empty.visible = n == 0


func _row(i: int) -> Dictionary:
	var r := {}
	r.panel = PanelContainer.new()
	r.panel.mouse_filter = Control.MOUSE_FILTER_STOP
	r.panel.set_drag_forwarding(Callable(), func(_at: Vector2, d: Variant) -> bool: return P.can_drop(d),
		func(_at: Vector2, d: Variant) -> void: drop(d, i))
	r.panel.gui_input.connect(func(e: InputEvent) -> void:
		var mb := e as InputEventMouseButton
		if mb and mb.pressed and mb.double_click and mb.button_index == MOUSE_BUTTON_LEFT and edit >= 0:
			jump.emit(playlists[edit].id, i))
	var h := HBoxContainer.new()
	h.mouse_filter = Control.MOUSE_FILTER_PASS
	r.panel.add_child(h)
	r.mark = Label.new()
	r.mark.custom_minimum_size.x = 34
	r.mark.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(r.mark)
	r.name = Label.new()
	r.name.clip_text = true
	r.name.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.name.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(r.name)
	r.hold = OptionButton.new()
	for l in P.HOLD_LABELS:
		r.hold.add_item(l)
	r.hold.focus_mode = Control.FOCUS_NONE
	r.hold.tooltip_text = "How long this entry plays: bars of the beat, seconds, or until the next drop"
	r.hold.item_selected.connect(func(k: int) -> void: _hold(i, {"hold": P.HOLDS[k]}))
	h.add_child(r.hold)
	r.bars = _spin(1, P.MAX_BARS, " bars", "Bars of 4 beats on the box's beat grid", func(v: float) -> void: _hold(i, {"bars": int(v)}))
	h.add_child(r.bars)
	r.secs = _spin(1, P.MAX_SECONDS, " s", "", func(v: float) -> void: _hold(i, {"seconds": v}))
	h.add_child(r.secs)
	r.up = _small("▲", "Earlier in the playlist", func() -> void: _edit_pl(P.move_entry(playlists[edit], i, i - 1)))
	h.add_child(r.up)
	r.down = _small("▼", "Later in the playlist", func() -> void: _edit_pl(P.move_entry(playlists[edit], i, i + 1)))
	h.add_child(r.down)
	r.del = Icons.button("close", "Remove this entry")
	r.del.pressed.connect(func() -> void: _edit_pl(P.remove_entry(playlists[edit], i)))
	h.add_child(r.del)
	return r


func _spin(lo: float, hi: float, suffix: String, tip: String, cb: Callable) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 1.0
	s.suffix = suffix
	s.custom_minimum_size.x = 92
	s.tooltip_text = tip
	s.value_changed.connect(func(v: float) -> void:
		if not _quiet:
			cb.call(v))
	return s


func _small(text: String, tip: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	b.pressed.connect(cb)
	return b


## The rows' values from the playlist (no signals out): ▶ on the entry it is on, the hold controls of each entry.
func _fill(pl: Dictionary) -> void:
	var cur := P.current_index(pl) if not pl.is_empty() else -1
	for i in rows.size():
		var r: Dictionary = rows[i]
		var e: Dictionary = pl.entries[i]
		r.mark.text = ("▶ " if i == cur else "") + str(i + 1)
		r.mark.modulate = ThemeBuilder.ACCENT if i == cur and pl.id == active else Color(1, 1, 1, 0.8 if i == cur else 0.6)
		r.name.text = str(e.name)
		r.name.tooltip_text = "%s · %s — %s\nDouble-click shows it now · drop a look or visual here to put it before this one" % [
			"Look" if e.kind == "look" else "Visual", P.Looks.auto_name(e), P.hold_text(e)]
		r.hold.select(P.HOLDS.find(e.hold))
		r.bars.visible = e.hold == "bars"
		if not r.bars.get_line_edit().has_focus():
			r.bars.set_value_no_signal(e.bars)
		if not r.secs.get_line_edit().has_focus():
			r.secs.set_value_no_signal(e.seconds)
		r.secs.tooltip_text = ("Seconds this entry plays" if e.hold == "seconds"
			else "Seconds it plays while no tempo is locked (no beat to count, no music to drop)")
		r.secs.modulate = Color(1, 1, 1, 1.0 if e.hold == "seconds" else 0.7)
		r.up.disabled = i == 0
		r.down.disabled = i == rows.size() - 1
		var sb := StyleBoxFlat.new()
		sb.bg_color = ThemeBuilder.ACCENT.darkened(0.6) if i == cur and pl.id == active else ThemeBuilder.BG_PANEL.lightened(0.04)
		sb.set_corner_radius_all(3)
		sb.set_content_margin_all(3)
		r.panel.add_theme_stylebox_override("panel", sb)


func _hold(i: int, fields: Dictionary) -> void:
	if not _quiet and edit >= 0:
		_edit_pl(P.with_hold(playlists[edit], i, fields))


func _edit_pl(pl: Dictionary) -> void:
	if _quiet or edit < 0:
		return
	var next := playlists.duplicate(true)
	next[edit] = pl
	changed.emit(next)


func _rename() -> void:
	if _quiet or edit < 0 or _name.text.strip_edges() == "" or _name.text.strip_edges() == playlists[edit].name:
		return
	var pl: Dictionary = playlists[edit].duplicate(true)
	pl.name = _name.text.strip_edges().left(40)
	_edit_pl(pl)
