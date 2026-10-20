extends VBoxContainer
## WO-605 slice 10 — the Devices tab's Matrix view (web device-view-matrix.js renderMatrix): add buttons over a
## dense routing grid, sources down the left, sinks across the top (vertical labels). A crosspoint click connects or
## disconnects (matrix_model.gd builds the whole new graph); a header click opens that destination or connector.
## The grid is drawn, not built from buttons — a box with 50 sources × 20 sinks would be 1000 controls.
## "+ Live input" opens the tab's live-input dialog (WO-605 slice 11).

signal route(graph: Dictionary)
signal header(id: String)
signal add(what: String)  # "destination" | "live_input" | "stream_out" | "record_out" | "v4l2_out" | "pixel_map"

const ThemeBuilder := preload("res://app/theme_builder.gd")
const M := preload("res://features/devices/matrix_model.gd")
const ADDS := [["+ Destination", "destination"], ["+ Live input", "live_input"], ["+ Stream", "stream_out"], ["+ Record", "record_out"],
	["+ Virtual cam", "v4l2_out"], ["+ Pixel Map", "pixel_map"]]

var _grid: Grid


func _init() -> void:
	add_theme_constant_override("separation", 10)
	var bar := HBoxContainer.new()
	bar.add_theme_constant_override("separation", 8)
	add_child(bar)
	for a in ADDS:
		var b := Button.new()
		b.text = a[0]
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_size_override("font_size", 12)
		b.pressed.connect(func() -> void: add.emit(a[1]))
		bar.add_child(b)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(scroll)
	_grid = Grid.new()
	_grid.view = self
	scroll.add_child(_grid)


func show_payload(payload: Dictionary, live_cm: Variant) -> void:
	_grid.payload = payload
	_grid.ports = M.ports(payload, live_cm)
	_grid.relayout()


class Grid:
	extends Control
	const CELL := 32.0
	const PAD := 8.0
	const SRC_W := 190.0
	var view: Node
	var payload := {}
	var ports := {"sources": [], "sinks": []}
	var _head_h := 60.0
	var _hover := Vector2i(-2, -2)  # (column, row); -1 = that axis's header

	func _init() -> void:
		mouse_filter = Control.MOUSE_FILTER_STOP
		mouse_exited.connect(func() -> void:
			_hover = Vector2i(-2, -2)
			queue_redraw())

	func _font() -> Font:
		return get_theme_default_font()

	func relayout() -> void:
		var w := 0.0
		for k in ports.sinks:
			w = maxf(w, maxf(_font().get_string_size(k.label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x,
				_font().get_string_size(k.group.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, -1, 9).x))
		_head_h = clampf(w + 2 * PAD + 4, 60.0, 240.0)
		custom_minimum_size = Vector2(SRC_W + CELL * ports.sinks.size() + 1, _head_h + CELL * ports.sources.size() + 1)
		queue_redraw()

	## (column, row) under a point: -1 on the header band of that axis, -2 outside.
	func _at(p: Vector2) -> Vector2i:
		var c := -1 if p.x < SRC_W else int((p.x - SRC_W) / CELL)
		var r := -1 if p.y < _head_h else int((p.y - _head_h) / CELL)
		if c >= ports.sinks.size() or r >= ports.sources.size() or (c == -1 and r == -1):
			return Vector2i(-2, -2)
		return Vector2i(c, r)

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseMotion:
			var h := _at(event.position)
			if h != _hover:
				_hover = h
				queue_redraw()
		elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			var h := _at(event.position)
			if h.x == -2:
				return
			accept_event()
			if h.y == -1:
				view.header.emit(ports.sinks[h.x].id)
			elif h.x == -1:
				view.header.emit(ports.sources[h.y].id)
			else:
				view.route.emit(M.toggle(payload, ports.sources[h.y], ports.sinks[h.x], M.new_edge_id()))

	func _draw() -> void:
		var f := _font()
		var nk: int = ports.sinks.size()
		var ns: int = ports.sources.size()
		var gw := CELL * nk
		var gh := CELL * ns
		var head := ThemeBuilder.BG_ELEVATED
		draw_rect(Rect2(0, 0, SRC_W, _head_h), head)
		draw_string(f, Vector2(PAD, _head_h - PAD - 2), "SOURCES", HORIZONTAL_ALIGNMENT_LEFT, -1, 10, ThemeBuilder.TEXT_MUTED)
		draw_rect(Rect2(SRC_W, _head_h, gw, gh), ThemeBuilder.BG_PANEL)
		if _hover.x >= 0:  # crosshair: the hovered column and row
			draw_rect(Rect2(SRC_W + CELL * _hover.x, 0, CELL, _head_h + gh), Color(1, 1, 1, 0.05))
		for i in nk:
			var x := SRC_W + CELL * i
			var on := _hover.x == i and _hover.y == -1
			draw_rect(Rect2(x, 0, CELL, _head_h), ThemeBuilder.BORDER if on or _hover.x == i else head)
			draw_set_transform(Vector2(x + CELL / 2.0, _head_h - PAD), -PI / 2.0)
			draw_string(f, Vector2(0, -1), ports.sinks[i].label, HORIZONTAL_ALIGNMENT_LEFT, _head_h - 2 * PAD, 12,
				ThemeBuilder.TEXT if on else ThemeBuilder.TEXT_MUTED)
			draw_string(f, Vector2(0, 11), ports.sinks[i].group.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, _head_h - 2 * PAD, 9,
				Color(ThemeBuilder.TEXT_MUTED, 0.6))
			draw_set_transform(Vector2.ZERO)
		for r in ns:
			var y := _head_h + CELL * r
			var row_on := _hover.y == r
			if row_on:
				draw_rect(Rect2(0, y, SRC_W + gw, CELL), Color(1, 1, 1, 0.05))
			draw_rect(Rect2(0, y, SRC_W, CELL), ThemeBuilder.BORDER if row_on else head)
			var s: Dictionary = ports.sources[r]
			draw_string(f, Vector2(PAD, y + 14), s.label, HORIZONTAL_ALIGNMENT_LEFT, SRC_W - 2 * PAD, 12,
				ThemeBuilder.TEXT if row_on else ThemeBuilder.TEXT_MUTED)
			draw_string(f, Vector2(PAD, y + 26), s.group.to_upper(), HORIZONTAL_ALIGNMENT_LEFT, SRC_W - 2 * PAD, 9,
				Color(ThemeBuilder.TEXT_MUTED, 0.6))
			for i in nk:
				var c := Vector2(SRC_W + CELL * i + CELL / 2.0, y + CELL / 2.0)
				var hot := row_on and _hover.x == i
				if M.active(payload, s, ports.sinks[i]):  # red on hover: a click disconnects
					var col := ThemeBuilder.ERROR if hot else ThemeBuilder.SUCCESS
					draw_circle(c, 10.0, Color(col, 0.25))
					draw_circle(c, 7.0, col)
				else:
					draw_arc(c, 7.0 if not hot else 7.7, 0, TAU, 24, Color("#475569", 0.8 if hot else 0.3), 2.0, true)
		var line := ThemeBuilder.BORDER
		for i in nk + 1:
			draw_line(Vector2(SRC_W + CELL * i, 0), Vector2(SRC_W + CELL * i, _head_h + gh), line)
		for r in ns + 1:
			draw_line(Vector2(0, _head_h + CELL * r), Vector2(SRC_W + gw, _head_h + CELL * r), line)
		draw_line(Vector2(0, 0), Vector2(0, _head_h + gh), line)
		draw_line(Vector2(0, 0), Vector2(SRC_W + gw, 0), line)
