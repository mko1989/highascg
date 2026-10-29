extends VBoxContainer
## WO-807 phase 2 — the pixel map editor's pixel list (pixel_map_window.gd): one row per pixel of the chosen fixture
## (pixel_map_model.gd rows_for) — its region (a drawn rectangle, or — for unmapped), mode (average | point), colour
## order, the live colour the server sampled for it (GET /api/fixtures/pixelmap/live) and the server's error for it
## from the last Save (POST 400 errors[]). Edits write into `rows` and emit `changed`.

const P := preload("res://features/previs/fixtures/pixel_map_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal changed

var rows: Array = []
var _ui: Array = []  # per row {region: OptionButton, order: OptionButton, swatch: ColorRect, error: Label}
var _regions: Array = []
var _channel := 0


func _init() -> void:
	add_theme_constant_override("separation", 4)


## Rebuild for a fixture's rows (regions: the window's list; ch: the channel shown).
func set_rows(list: Array, regions: Array, ch: int) -> void:
	rows = list
	for c in get_children():
		c.queue_free()
	_ui.clear()
	for i in rows.size():
		_add_row(i)
	set_regions(regions, ch)
	if rows.is_empty():
		var l := Label.new()
		l.text = "Pick a fixture with colour pixels."
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		add_child(l)


func _add_row(i: int) -> void:
	var row: Dictionary = rows[i]
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 1)
	var h := HBoxContainer.new()
	var lbl := Label.new()
	lbl.text = "%d" % int(row.pixel)
	lbl.custom_minimum_size.x = 28
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	lbl.tooltip_text = "Pixel %d · %s · %s" % [int(row.pixel), row.geometry, row.order]
	lbl.mouse_filter = Control.MOUSE_FILTER_PASS
	h.add_child(lbl)
	var region := OptionButton.new()
	region.fit_to_longest_item = false
	region.custom_minimum_size.x = 170
	region.tooltip_text = "The screen region this pixel shows (draw one on the picture)"
	region.item_selected.connect(func(k: int) -> void:
		row.region = str(region.get_item_metadata(k))
		changed.emit())
	h.add_child(region)
	var mode := OptionButton.new()
	for m in P.MODES:
		mode.add_item(m)
	mode.select(maxi(P.MODES.find(row.mode), 0))
	mode.tooltip_text = "average: the mean of every pixel in the region · point: its centre pixel"
	mode.item_selected.connect(func(k: int) -> void:
		row.mode = P.MODES[k]
		changed.emit())
	h.add_child(mode)
	var order := OptionButton.new()
	var opts := P.order_options(str(row.order), str(row.colourOrder))
	for o in opts:
		order.add_item(o if o != "auto" else "auto (%s)" % row.order)
		order.set_item_metadata(order.item_count - 1, o)
	order.select(maxi(opts.find(str(row.colourOrder)), 0))
	order.tooltip_text = "Colour order of the pixel's DMX channels; auto = from the GDTF mode"
	order.item_selected.connect(func(k: int) -> void:
		row.colourOrder = str(order.get_item_metadata(k))
		changed.emit())
	h.add_child(order)
	var swatch := ColorRect.new()
	swatch.custom_minimum_size = Vector2(26, 22)
	swatch.color = ThemeBuilder.BG_ELEVATED
	swatch.tooltip_text = "Not saved yet — no live colour"
	h.add_child(swatch)
	box.add_child(h)
	var err := Label.new()
	err.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	err.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	err.visible = false
	box.add_child(err)
	add_child(box)
	_ui.append({"region": region, "swatch": swatch, "error": err})


## Refill every row's region picker (a region was drawn, moved, deleted or the channel changed).
func set_regions(regions: Array, ch: int) -> void:
	_regions = regions
	_channel = ch
	for i in _ui.size():
		var b: OptionButton = _ui[i].region
		b.clear()
		b.add_item("—")
		b.set_item_metadata(0, "")
		var at := 0
		for g in regions:
			b.add_item(P.region_label(g, ch))
			b.set_item_metadata(b.item_count - 1, str(g.id))
			if str(g.id) == str(rows[i].region):
				at = b.item_count - 1
		b.select(at)


## Server errors of the last Save, by target "fixtureId#pixel" ({} clears them).
func set_errors(fid: String, by_target: Dictionary) -> void:
	for i in _ui.size():
		var msg := str(by_target.get(P.target(fid, int(rows[i].pixel)), ""))
		(_ui[i].error as Label).text = msg
		(_ui[i].error as Label).visible = msg != ""


## Live colours by mapping id (pixel_map_model.gd live_by_id).
func set_live(by_id: Dictionary) -> void:
	for i in _ui.size():
		var sw: ColorRect = _ui[i].swatch
		var l: Variant = by_id.get(str(rows[i].id)) if str(rows[i].id) != "" else null
		if l == null:
			sw.color = ThemeBuilder.BG_ELEVATED
			sw.tooltip_text = "Not saved yet — no live colour" if str(rows[i].region) != "" else "Not mapped"
		elif l.color is Color:
			sw.color = l.color
			sw.tooltip_text = "RGB %d, %d, %d%s" % [l.color.r8, l.color.g8, l.color.b8,
				" · on the wire" if l.on_wire else " · not sent (DMX output off, universe not under Send, or console input on)"]
		else:
			sw.color = ThemeBuilder.BG_DARK
			sw.tooltip_text = str(l.problem) if l.problem != null else "No picture from the channel"
