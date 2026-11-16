extends RefCounted
## WO-1104 — the Stage panel's drape bits (stage_panel.gd): the colour row (five preset swatches + any colour), the
## info line, the list text, and the floor under a point when no MVR scene answers (the tracking grid's deck, else 0).

const S := preload("res://features/previs/stage_objects.gd")
const D := preload("res://features/previs/drape_geometry.gd")
const TM := preload("res://features/previs/tracking/tracking_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")


## Swatches for the presets and a picker; `set_color(hex, done)` gets "#rrggbb" — done = a swatch click (the row may be
## rebuilt), false while the picker is open (it must survive).
static func color_row(o: Dictionary, set_color: Callable) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	for c in S.DRAPE_COLORS:
		var b := Button.new()
		b.tooltip_text = c[0]
		b.custom_minimum_size = Vector2(22, 22)
		var on := str(o.color).to_lower() == str(c[1])
		for state in ["normal", "hover", "pressed", "focus"]:
			var sb := StyleBoxFlat.new()
			sb.bg_color = Color.html(c[1])
			sb.set_corner_radius_all(3)
			sb.set_border_width_all(2 if on or state == "hover" else 1)
			sb.border_color = ThemeBuilder.ACCENT if on else (ThemeBuilder.TEXT if state == "hover" else ThemeBuilder.BORDER)
			b.add_theme_stylebox_override(state, sb)
		var hex: String = c[1]
		b.pressed.connect(func() -> void: set_color.call(hex, true))
		row.add_child(b)
	var pick := ColorPickerButton.new()
	pick.color = Color.html(str(o.color))
	pick.edit_alpha = false
	pick.custom_minimum_size = Vector2(36, 22)
	pick.tooltip_text = "Any colour"
	pick.color_changed.connect(func(col: Color) -> void: set_color.call("#" + col.to_html(false), false))
	row.add_child(pick)
	return row


static func info(o: Dictionary) -> String:
	var s := S.size_m(o)
	var dr := D.depth_range(o)
	if D.pleats(o) == 0:
		return "%.2f × %.2f m · flat" % [s.x, s.y]
	return "%.2f × %.2f m · %d pleats, %.0f mm deep · %.1f m of cloth" % [s.x, s.y, D.pleats(o), (dr.y - dr.x) * 1000.0,
		D.cloth_m(D.profile(o, D.SAMPLES[1]))]


static func item_text(o: Dictionary) -> String:
	var s := S.size_m(o)
	return "%s  ·  DRAPE  %.1f × %.1f m" % [o.name, s.x, s.y]


## The tracking grid's floor (z_offset) when stage-frame point `p` is over the grid, else 0.
static func grid_floor(project: Dictionary, p: Vector3) -> float:
	var pv: Variant = project.get("previs")
	var t: Variant = (pv as Dictionary).get("tracking") if pv is Dictionary else null
	var g0: Variant = (t as Dictionary).get("grid") if t is Dictionary else null
	if not g0 is Dictionary:
		return 0.0
	var g := TM.normalize_grid(g0)
	var over := absf(p.x - float(g.x_offset)) <= float(g.width) / 2.0 and absf(-p.z - float(g.y_offset)) <= float(g.depth) / 2.0
	return float(g.z_offset) if over else 0.0
