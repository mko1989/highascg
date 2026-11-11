extends VBoxContainer
## WO-1035 — Sources ▸ Live, its own list under the live sources: the PixelHue switcher's program layers (owner 11.11).
## A row dragged onto a look becomes an EMPTY layer exactly where that switcher layer is — a placeholder for a PIP
## border or an effect that the key + fill outputs lay over the switcher's own picture. Dropped ON a layer it moves
## that layer there instead. Read from the server (GET /api/pixelhue/layers?scene=pgm) every 3 s while the Live tab is
## shown. Owner 11.11: the list is there only while a switcher is added (Devices ▸ PixelHue) AND answering.

const M := preload("res://features/live/pixelhue_match_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _rows: VBoxContainer
var _note: Label
var _key := ""


func _ready() -> void:
	add_theme_constant_override("separation", 2)
	visible = false
	add_child(HSeparator.new())
	var head := Label.new()
	head.text = "PixelHue layers"
	head.add_theme_font_size_override("font_size", 12)
	head.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	head.tooltip_text = "The switcher's program layers. Drag one onto a look: an empty layer lands exactly on it."
	add_child(head)
	_note = Label.new()
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_note.add_theme_font_size_override("font_size", 11)
	_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_note.visible = false
	add_child(_note)
	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", 2)
	add_child(_rows)
	var t := Timer.new()
	t.wait_time = 3.0
	t.autostart = true
	t.timeout.connect(reload)
	add_child(t)
	reload.call_deferred()


func reload() -> void:
	var parent := get_parent() as Control
	if parent == null or not parent.is_visible_in_tree():
		return
	var r: Dictionary = await Api.get_json("/api/pixelhue/layers?scene=pgm")
	visible = r.ok  # no switcher added, or it does not answer: no list
	if not r.ok:
		_key = ""
		return
	var list := M.choices(r.data)
	var key := JSON.stringify(list)
	if key == _key:
		return
	_key = key
	_note.text = "No program layers on the switcher."
	_note.visible = list.is_empty()
	for c in _rows.get_children():
		c.queue_free()
	for c in list:
		_rows.add_child(_row(c))


func _row(c: Dictionary) -> Control:
	var panel := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = ThemeBuilder.BG_PANEL
	sb.set_content_margin_all(4)
	sb.set_corner_radius_all(3)
	panel.add_theme_stylebox_override("panel", sb)
	panel.tooltip_text = "%s\n%s\nDrag onto a look: an empty layer exactly on this switcher layer.\nDrop it on a layer to move that layer there." % [str(c.name), str(c.where)]
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 0)
	col.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(col)
	for line in [[str(c.name), 13, ThemeBuilder.TEXT], [str(c.where), 11, ThemeBuilder.TEXT_MUTED]]:
		var l := Label.new()
		l.text = line[0]
		l.clip_text = true
		l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		l.add_theme_font_size_override("font_size", line[1])
		l.add_theme_color_override("font_color", line[2])
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		col.add_child(l)
	panel.set_drag_forwarding(func(_at: Vector2) -> Variant:
		var p := Label.new()
		p.text = "＋ " + str(c.name)
		set_drag_preview(p)
		return M.drag_payload(c), Callable(), Callable())
	return panel
