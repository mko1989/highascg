extends MarginContainer
## WO-605 slice 1 — the Devices tab, read-only (web device-view.js): screen-destination cards on the left, the Caspar
## host's rear panel on the right, the cables list under it, and the hanging cables drawn over all of it. Data is
## GET /api/device-view, fetched whenever the tab is shown, on Refresh, and on WS `gpu_topology_changed` (DRM
## hotplug — the web's only device-view push). The inspector arrives in later slices.
## Slice 2c: cabling — click an output dot to arm (targets tint valid/invalid, a ghost follows the pointer), click a
## target to connect; click a cable (or its row) to select it, then Delete/Backspace removes it or clicking one of its
## ends lifts that end to move it; Esc / empty space cancels; Ctrl+Z undoes. cable_gesture.gd does the writes.
## Slice 3: the left column is destinations_panel.gd — add / edit / remove destinations through the Inspector, plus
## the input & host channel cards. A selected cable and a selected destination exclude each other.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Model := preload("res://features/devices/devices_model.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const RearPanel := preload("res://features/devices/rear_panel.gd")
const CableLayer := preload("res://features/devices/cable_layer.gd")
const CableGesture := preload("res://features/devices/cable_gesture.gd")
const CableModel := preload("res://features/devices/cable_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const DestinationsPanel := preload("res://features/devices/destinations_panel.gd")
const CableRules := preload("res://features/devices/cable_rules.gd")

var _dests: DestinationsPanel
var _rear: PanelContainer
var _list: VBoxContainer
var _cables: Control
var _status: Label
var _loops_value: Label
var _loading := false
var _reload_again := false
var _sticky := false  # the status holds a result/error worth keeping over the next "Updated …"
var _gesture: Node
var _anchors := {}  # anchor key → port_icon.gd
var _rows := {}  # cable id → [row button, remove button]
var _bar: Control
var _cancel_btn: Button
var _apply_btn: Button
var _confirm: ConfirmationDialog


func _ready() -> void:
	for side in ["left", "right", "top", "bottom"]:
		add_theme_constant_override("margin_" + side, 16)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 14)
	add_child(v)
	_gesture = CableGesture.new()
	add_child(_gesture)
	_gesture.changed.connect(_sync)
	_gesture.status.connect(_set_status)
	_gesture.reload_requested.connect(refresh)
	Ws.on("log_line", _gesture.on_log_line)
	_confirm = ConfirmationDialog.new()
	_confirm.dialog_text = "Are you sure you want to remove ALL cable connections?"
	_confirm.confirmed.connect(_gesture.remove_all)
	add_child(_confirm)
	_bar = _toolbar()
	v.add_child(_bar)
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 40)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(body)
	var left := ScrollContainer.new()
	left.custom_minimum_size.x = 280
	left.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(left)
	_dests = DestinationsPanel.new()
	_dests.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(_dests)
	_dests.status.connect(_set_status)
	_dests.refresh_requested.connect(refresh)
	_dests.changed.connect(func() -> void:
		_gesture.set_dirty(true)
		refresh())
	_dests.selected.connect(func(id: String) -> void:
		if id != "" and _gesture.selected_edge != "":
			_gesture.selected_edge = ""
			_sync())
	# The web opens that connector's inspector (GPU / DeckLink pages — later slices); until then select its cable.
	_dests.focus_connector.connect(func(id: String) -> void:
		for e in CableRules.a(CableRules.d(_gesture.payload.get("graph")).get("edges")):
			if e is Dictionary and CableRules.s(e.get("sinkId")) == id:
				_gesture.select_edge(CableRules.s(e.get("id")))
				return
		_set_status("%s has no cable." % id, false))
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	right.add_theme_constant_override("separation", 12)
	body.add_child(right)
	_rear = RearPanel.new()
	right.add_child(_rear)
	right.add_child(_label("CABLES", ThemeBuilder.TEXT_MUTED, 12))
	_list = VBoxContainer.new()
	right.add_child(_list)
	_cables = CableLayer.new()
	add_child(_cables)
	visibility_changed.connect(func() -> void: if is_visible_in_tree(): refresh())
	Ws.on("gpu_topology_changed", func(_d: Variant) -> void: if is_visible_in_tree(): refresh())  # DRM hotplug
	if is_visible_in_tree():
		refresh()


func _toolbar() -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	h.add_child(_label("Devices", ThemeBuilder.TEXT, 17))
	var gap := Control.new()
	gap.custom_minimum_size.x = 24
	h.add_child(gap)
	h.add_child(_label("Cable loops", ThemeBuilder.TEXT_MUTED, 13))
	var s := HSlider.new()
	s.min_value = 0
	s.max_value = 2
	s.step = 1
	s.custom_minimum_size = Vector2(70, 0)
	s.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	s.focus_mode = Control.FOCUS_NONE
	h.add_child(s)
	_loops_value = _label("0", ThemeBuilder.TEXT, 13)
	h.add_child(_loops_value)
	s.value_changed.connect(func(x: float) -> void:
		_cables.loops = int(x)
		_loops_value.text = str(int(x)))
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(fill)
	_status = _label("", ThemeBuilder.TEXT_MUTED, 12)
	h.add_child(_status)
	_cancel_btn = _button("Cancel cable", func() -> void: _gesture.cancel())
	_cancel_btn.visible = false
	h.add_child(_cancel_btn)
	h.add_child(_button("Reset all cabling", func() -> void: _confirm.popup_centered()))
	_apply_btn = _button("Apply Caspar config (restart)", _gesture.apply_caspar)
	h.add_child(_apply_btn)
	var r := Button.new()
	r.text = "↻"
	r.tooltip_text = "Reload devices"
	r.focus_mode = Control.FOCUS_NONE
	r.pressed.connect(func() -> void:
		_sticky = false
		refresh())
	h.add_child(r)
	return h


## GET /api/device-view (+ settings once — the cable writes seed from them). A reload asked for while one is in
## flight runs again after it, so a mutation is never answered by a read that started before it.
func refresh() -> void:
	if _loading:
		_reload_again = true
		return
	_loading = true
	if not Settings.is_loaded:
		await Settings.load_from_server()
	var r: Dictionary = await Api.get_json("/api/device-view")
	_loading = false
	if _reload_again:
		_reload_again = false
		refresh()
		return
	if not r.ok or not r.data is Dictionary:
		_set_status("Could not load devices: %s" % str(r.get("error", "no data")), false)
		_sticky = false
		return
	if not _sticky:
		_set_status("Updated %s" % Time.get_time_string_from_system(), true)
	_sticky = false
	_gesture.payload = r.data
	if _gesture.selected_edge != "" and _gesture.edge(_gesture.selected_edge).is_empty():
		_gesture.selected_edge = ""
	var payload := H.merge_settings(r.data, Settings.settings if Settings.is_loaded else null)
	show_model(Model.build(payload, Store.get_value("channelMap"), Store.get_value("configComparison")), payload)


func show_model(m: Dictionary, payload: Dictionary) -> void:
	var anchors := {}
	_dests.show_model(m, payload, anchors)
	_rear.show_slots(m.slots)
	anchors.merge(_rear.anchors)
	_clear(_list)
	_rows = {}
	if m.cables.is_empty():
		_list.add_child(_label("No cables.", ThemeBuilder.TEXT_MUTED, 12))
	for c in m.cables:
		_list.add_child(_cable_row(c))
	_cables.set_cables(m.cables, anchors)
	_anchors = anchors
	_sync()


## Gesture state → port tints, the overlay (selected / held / ghost), the toolbar and the cables list.
func _sync() -> void:
	var g := _gesture
	var sel: Dictionary = g.edge(g.selected_edge)
	var ends := [] if sel.is_empty() else [Model.source_anchor(sel), str(sel.sinkId)]
	for key in _anchors:
		var p: Control = _anchors[key]
		if not is_instance_valid(p):
			continue
		var id: String = key.get_slice("#", 0)
		p.target = "" if not g.armed() else "armed" if id == g.source_id else "valid" if g.target_ok(id) else "invalid"
		p.active = ends.any(func(e: String) -> bool: return e == key or (not key.contains("#") and e.get_slice("#", 0) == key))
	_cables.selected_id = g.selected_edge
	if g.selected_edge != "":
		_dests.deselect()
	_cables.hidden_id = str(g.regrab.get("edgeId", ""))
	_cables.ghost_from = g.ghost_anchor()
	_cancel_btn.visible = g.armed()
	_apply_btn.disabled = g.busy
	_apply_btn.text = "Applying…" if g.applying else "Apply Caspar config (restart)"
	_apply_btn.add_theme_color_override("font_color", ThemeBuilder.WARN if g.restart_dirty else ThemeBuilder.TEXT)
	_apply_btn.tooltip_text = "Cabling changed — restart Caspar to apply" if g.restart_dirty else ""
	for id in _rows:
		_rows[id][1].visible = id == g.selected_edge
		_rows[id][0].add_theme_color_override("font_outline_color", ThemeBuilder.ACCENT)
		_rows[id][0].add_theme_constant_override("outline_size", 1 if id == g.selected_edge else 0)


## Gesture prompts ("Cable armed…", "Cable end grabbed…") give way to the next reload; results and errors stay.
func _set_status(text: String, ok: bool) -> void:
	_sticky = not ok or not (text.begins_with("Cable armed") or text.begins_with("Cable end grabbed") or text.begins_with("Applying"))
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if ok else ThemeBuilder.ERROR)


## Clicks are taken here, before the GUI: a connector dot (rect grown 3 px) drives the gesture, then a cable selects;
## anything else cancels an armed gesture (web: empty space restores) and lets the click through.
func _input(event: InputEvent) -> void:
	if not is_visible_in_tree() or _confirm.visible:
		return
	if event is InputEventMouseMotion:
		var lp: Vector2 = _cables.get_global_transform().affine_inverse() * event.global_position
		if _gesture.armed():
			_cables.pointer = lp
		elif _over_tab(event.global_position) and not _list.get_global_rect().has_point(event.global_position):
			var over: String = _cables.hit(lp)
			if over != _cables.active_id:
				_cables.active_id = over
		return
	if not (event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT):
		return
	var pos: Vector2 = event.global_position
	if not _over_tab(pos):
		return
	for key in _anchors:
		var p: Control = _anchors[key]
		if is_instance_valid(p) and p.is_visible_in_tree() and p.get_global_rect().grow(3).has_point(pos):
			get_viewport().set_input_as_handled()
			_gesture.click(key)
			return
	if _gesture.armed():
		_gesture.cancel()
		return
	var on_ui := _list.get_global_rect().has_point(pos) or _bar.get_global_rect().has_point(pos)
	var hit: String = _cables.hit(_cables.get_global_transform().affine_inverse() * pos)
	if hit != "":
		get_viewport().set_input_as_handled()
		_gesture.select_edge(hit)
	elif not on_ui and _gesture.selected_edge != "":
		_gesture.selected_edge = ""
		_sync()


## Only clicks that land on this tab (not on a popup or menu drawn over it).
func _over_tab(pos: Vector2) -> bool:
	var h := get_viewport().gui_get_hovered_control()
	return get_global_rect().has_point(pos) and h != null and (h == self or is_ancestor_of(h))


func _unhandled_key_input(event: InputEvent) -> void:
	if not is_visible_in_tree() or not event.is_pressed() or event.is_echo():
		return
	var f := get_viewport().gui_get_focus_owner()
	if f is LineEdit or f is TextEdit:
		return
	var k := event as InputEventKey
	if k.keycode == KEY_ESCAPE and _gesture.cancel():
		get_viewport().set_input_as_handled()
	elif k.keycode == KEY_Z and k.is_command_or_control_pressed() and not k.shift_pressed:
		get_viewport().set_input_as_handled()
		_gesture.undo()
	elif (k.keycode == KEY_DELETE or k.keycode == KEY_BACKSPACE) and _gesture.selected_edge != "":
		get_viewport().set_input_as_handled()
		_gesture.remove_edge(_gesture.selected_edge)


## A cables-list row: the cable's colour, "Source → Sink"; hovering it thickens that cable, clicking selects it
## (then a Remove button shows, like the web edge inspector's).
func _cable_row(c: Dictionary) -> Control:
	var h := HBoxContainer.new()
	var b := Button.new()
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.focus_mode = Control.FOCUS_NONE
	b.text = "●  " + str(c.label)
	b.add_theme_font_size_override("font_size", 12)
	var col: Color = CableModel.color(c.id)
	b.add_theme_color_override("font_color", col.lerp(ThemeBuilder.TEXT, 0.35))
	b.mouse_entered.connect(func() -> void: _cables.active_id = c.id)
	b.mouse_exited.connect(func() -> void: if _cables.active_id == c.id: _cables.active_id = "")
	b.pressed.connect(func() -> void: _gesture.select_edge(c.id))
	h.add_child(b)
	var rm := _button("Remove", func() -> void: _gesture.remove_edge(c.id))
	rm.visible = false
	h.add_child(rm)
	_rows[c.id] = [b, rm]
	return h


func _button(text: String, on_press: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_size_override("font_size", 12)
	b.pressed.connect(on_press)
	return b


func _clear(n: Node) -> void:
	for c in n.get_children():
		n.remove_child(c)
		c.queue_free()


func _label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
