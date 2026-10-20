extends VBoxContainer
## WO-605 slice 3 — the Devices tab's left column (web device-view-destinations-ui.js + -events.js): "Screen
## destinations" with the type select and "+", the destination cards, then "Input & host channels". Clicking a card
## selects it and hands destination_inspector.gd to the shared Inspector column; its edits post here. Every write
## (add / update / remove) marks Caspar restart-dirty and reloads, like the web's forced device-view load.

signal selected(id: String)  # "" = cleared; the tab drops a selected cable when a destination takes the Inspector
signal status(text: String, ok: bool)
signal changed  # a write landed → restart-dirty + reload
signal refresh_requested  # a host-channel control applied something that needs no Caspar restart → reload only
signal focus_connector(id: String)  # a mapped output clicked on the page (web: opens that connector's inspector)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const Model := preload("res://features/devices/devices_model.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const Inspector := preload("res://features/devices/destination_inspector.gd")
const HostControls := preload("res://features/devices/host_channel_controls.gd")
const PGM := Color("#e74c3c")
const PRV := Color("#2ecc71")

var selected_id := ""
var _cards: VBoxContainer
var _type: OptionButton
var _page: Inspector
var _host: HostControls
var _payload := {}
var _entries := {}  # id → devices_model destination entry
var _busy := false


func _init() -> void:
	add_theme_constant_override("separation", 8)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 6)
	add_child(head)
	var title := _label("Screen destinations", ThemeBuilder.TEXT_MUTED, 13)
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	_type = OptionButton.new()
	_type.focus_mode = Control.FOCUS_NONE
	_type.tooltip_text = "Destination type to add"
	for i in DM.TYPE_OPTIONS.size():
		_type.add_item(DM.TYPE_OPTIONS[i][1], i)
		_type.set_item_metadata(i, DM.TYPE_OPTIONS[i][0])
	head.add_child(_type)
	var add := Button.new()
	add.text = "+"
	add.tooltip_text = "Add destination"
	add.focus_mode = Control.FOCUS_NONE
	add.pressed.connect(_add)
	head.add_child(add)
	_cards = VBoxContainer.new()
	_cards.add_theme_constant_override("separation", 12)
	add_child(_cards)
	_page = Inspector.new()
	_page.patch.connect(_patch)
	_page.remove.connect(_remove)
	_page.launch_operator_gui.connect(_launch)
	_page.focus_connector.connect(func(id: String) -> void: focus_connector.emit(id))
	_host = HostControls.new()
	add_child(_host)
	_page.host_controls = _host
	_host.status.connect(func(text: String, ok: bool) -> void: status.emit(text, ok))
	_host.reload.connect(func(dirty: bool) -> void:
		if dirty:
			changed.emit()
		else:
			refresh_requested.emit())
	_host.removed.connect(func() -> void:  # web onHostInputRemoved: clear selection, restart-dirty, reload
		deselect()
		changed.emit())


## Rebuild the cards from build() (`anchors` collects the output dots for the cable layer); the open page follows
## its destination, or closes when the reload no longer has it.
func show_model(m: Dictionary, payload: Dictionary, anchors: Dictionary) -> void:
	_payload = payload
	_entries = {}
	for c in _cards.get_children():
		_cards.remove_child(c)
		c.queue_free()
	if int(m.get("screen_count", 0)) == 0:
		_cards.add_child(_note(DM.EMPTY_NOTE))
	var first_host := true
	for d in m.destinations:
		_entries[d.id] = d
		if d.host and first_host:
			first_host = false
			_cards.add_child(_label("Input & host channels" if int(m.get("screen_count", 0)) > 0 else "Host channels",
				ThemeBuilder.TEXT_MUTED, 13))
		_cards.add_child(_card(d, anchors))
	if selected_id != "" and not _entries.has(selected_id):
		deselect()
	elif selected_id != "":
		_page.show_destination(_entries[selected_id], _payload, Settings.settings)


func select(id: String) -> void:
	if not _entries.has(id):
		return
	selected_id = id
	_page.show_destination(_entries[id], _payload, Settings.settings)
	if InspectorPanel.current != null:
		InspectorPanel.current.present(_page)
	_highlight()
	selected.emit(id)


func deselect() -> void:
	if selected_id == "":
		return
	selected_id = ""
	if InspectorPanel.current != null:
		InspectorPanel.current.release(_page)
	_highlight()
	selected.emit("")


## The "+" button: POST addDestination (the server picks the video mode), then seed the new screen's consumer
## settings when it is a fresh screen N (web shouldSeedScreenConsumerDefaults), then dirty + reload.
func _add() -> void:
	if _busy:
		return
	var type := str(_type.get_selected_metadata())
	var dests: Array = DM.R.a(DM.R.d(_payload.get("screenDestinations")).get("destinations"))
	var req := DM.add_request(dests, type)
	_busy = true
	var r: Dictionary = await Api.post_json("/api/device-view", {"addDestination": req.body})
	if r.ok and req.screen >= 1 and Settings.is_loaded:
		var seed := DM.seed_patch(req.screen, Settings.settings)
		if not seed.is_empty():
			await Api.post_json("/api/settings", seed)
			await Settings.load_from_server()
	_busy = false
	_done(r, "Add destination")


func _patch(id: String, body: Dictionary) -> void:
	var b := body.duplicate()
	b.id = id
	_done(await Api.post_json("/api/device-view", {"updateDestination": b}), "Update destination")


func _remove(id: String) -> void:
	var r: Dictionary = await Api.post_json("/api/device-view", {"removeDestination": {"id": id}})
	if r.ok:
		deselect()
	_done(r, "Remove destination")


func _done(r: Dictionary, what: String) -> void:
	if r.ok:
		changed.emit()
	else:
		status.emit("%s failed: %s" % [what, _error(r)], false)


func _launch() -> void:
	var r: Dictionary = await Api.post_json("/api/operator-gui/launch", {})
	var data: Dictionary = r.data if r.data is Dictionary else {}
	if r.ok and data.get("ok"):
		_page.launch_status("Brought to front." if data.get("action") == "raised" else "Launched.", false)
	else:
		_page.launch_status("Failed: %s" % str(data.get("reason", r.get("error", "unknown error"))), false)


static func _error(r: Dictionary) -> String:
	var data: Variant = r.get("data")
	if data is Dictionary and data.get("error"):
		return str(data.error)
	return str(r.get("error", "HTTP %s" % r.get("status", "?")))


func _highlight() -> void:
	for c in _cards.get_children():
		if c.has_meta("dest_id"):
			var card: PanelContainer = c.get_child(0)
			var on: bool = c.get_meta("dest_id") == selected_id
			card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED,
				ThemeBuilder.ACCENT if on else ThemeBuilder.BORDER, 1))


## Title, "PGM/PRV · 1920x1080@50" (or "HOST · ch N"), then the output dot(s): one per half for a PGM/PRV pair
## (`id#pgm`, `id#prv`; PRV without a dot on a switcher bus), else one on the title row. Under it: its cables.
func _card(d: Dictionary, anchors: Dictionary) -> Control:
	var wrap := VBoxContainer.new()
	wrap.set_meta("dest_id", d.id)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_ELEVATED,
		ThemeBuilder.ACCENT if d.id == selected_id else ThemeBuilder.BORDER, 1))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	card.tooltip_text = "Click to edit this destination in the Inspector"
	card.gui_input.connect(func(e: InputEvent) -> void:
		if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
			select(d.id))
	wrap.add_child(card)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	v.mouse_filter = Control.MOUSE_FILTER_PASS
	card.add_child(v)
	var title := HBoxContainer.new()
	title.mouse_filter = Control.MOUSE_FILTER_PASS
	v.add_child(title)
	var t := _label(str(d.label), ThemeBuilder.TEXT, 15)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.add_child(t)
	if d.halves.is_empty():
		title.add_child(_dot(anchors, d.connector, "%s output" % d.label))
	v.add_child(_label(str(d.sub), ThemeBuilder.TEXT_MUTED, 12))
	for half in d.halves:
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_PASS
		row.custom_minimum_size.y = 26
		var tag := _label(str(half).to_upper(), PGM if half == "pgm" else PRV, 11)
		tag.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(tag)
		if half == "pgm" or d.get("prv_dot", true):
			row.add_child(_dot(anchors, Model.anchor_key(d.connector, half), "%s %s output" % [d.label, str(half).to_upper()]))
		v.add_child(row)
	for l in d.links:
		wrap.add_child(_label("  • " + str(l), ThemeBuilder.TEXT_MUTED, 11))
	return wrap


func _dot(anchors: Dictionary, key: String, tip: String) -> Control:
	var p := PortIcon.make("", Vector2(14, 14), tip)
	p.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	anchors[key] = p
	return p


func _note(text: String) -> Label:
	var l := _label(text, ThemeBuilder.TEXT_MUTED, 12)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size.x = 240
	return l


func _label(text: String, color: Color, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l
