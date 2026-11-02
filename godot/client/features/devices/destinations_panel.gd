extends VBoxContainer
## WO-605 slice 3 — the Devices tab's left column (web device-view-destinations-ui.js + -events.js): "Screen
## destinations" with the type select and "+", the destination cards, then "Input & host channels". Clicking a card
## selects it and hands destination_inspector.gd to the shared Inspector column; its edits post here. Every write
## (add / update / remove) marks Caspar restart-dirty and reloads, like the web's forced device-view load.
## Under the cards: the "Add live input" band (web device-view-live-sources-render.js) — "+" opens the live-input
## dialog (the tab owns it), then live sources that have no host-channel card yet (a DeckLink / USB row opens its
## connector page).
## Slice 12: a DeckLink port dragged off the rear panel drops on a card (not a stream destination) and becomes that
## destination's output (decklink_drop_flow.gd; the web takes it on the output dots, but ignores which half).

signal selected(id: String)  # "" = cleared; the tab drops a selected cable when a destination takes the Inspector
signal status(text: String, ok: bool)
signal changed  # a write landed → restart-dirty + reload
signal refresh_requested  # a host-channel control applied something that needs no Caspar restart → reload only
signal focus_connector(id: String)  # a mapped output clicked on the page (web: opens that connector's inspector)
signal add_live_input  # the band's "+"
signal _decided(ok: bool)  # the remove confirmation

const ThemeBuilder := preload("res://app/theme_builder.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const Model := preload("res://features/devices/devices_model.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const Inspector := preload("res://features/devices/destination_inspector.gd")
const HostControls := preload("res://features/devices/host_channel_controls.gd")
const LI := preload("res://features/devices/live_input_model.gd")
const Drop := preload("res://features/devices/decklink_drop_flow.gd")
const DropIo := preload("res://features/devices/decklink_drop_io.gd")
const PGM := Color("#e74c3c")
const PRV := Color("#2ecc71")

var selected_id := ""
var _cards: VBoxContainer
var _band: VBoxContainer
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
	var band_head := HBoxContainer.new()
	add_child(band_head)
	var band_title := _label("Add live input", ThemeBuilder.TEXT_MUTED, 13)
	band_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	band_head.add_child(band_title)
	var add_live := Button.new()
	add_live.text = "+"
	add_live.tooltip_text = "Add DeckLink, NDI, USB video, live audio, or webpage"
	add_live.focus_mode = Control.FOCUS_NONE
	add_live.pressed.connect(func() -> void: add_live_input.emit())
	band_head.add_child(add_live)
	_band = VBoxContainer.new()
	_band.add_theme_constant_override("separation", 4)
	add_child(_band)
	_page = Inspector.new()
	_page.patch.connect(_patch)
	_page.remove.connect(_remove)
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
	_show_band(payload)
	_sync_type_options()
	if selected_id != "" and not _entries.has(selected_id):
		deselect()
	elif selected_id != "":
		_page.show_destination(_entries[selected_id], _payload, DevicesTarget.settings.settings)


## WO-918 F18: only one Operator GUI destination is allowed (the server refuses the second) — the type list stops
## offering it while one exists, instead of failing after the click.
func _sync_type_options() -> void:
	var dests: Array = DM.R.a(DM.R.d(_payload.get("screenDestinations")).get("destinations"))
	var has_gui := DM.has_operator_gui(dests)
	for i in _type.item_count:
		if _type.get_item_metadata(i) == "operator_gui":
			_type.set_item_disabled(i, has_gui)
			_type.set_item_tooltip(i, "Only one Operator GUI destination is allowed." if has_gui else "")
			if has_gui and _type.selected == i:
				_type.select(0)


func has(id: String) -> bool:
	return _entries.has(id)


func select(id: String) -> void:
	if not _entries.has(id):
		return
	selected_id = id
	_page.show_destination(_entries[id], _payload, DevicesTarget.settings.settings)
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
	await add(str(_type.get_selected_metadata()))


## Also the Matrix view's "+ Destination" (pgm_prv; the web's skips the consumer seeding, here it is the same add).
func add(type: String) -> void:
	if _busy:
		return
	var dests: Array = DM.R.a(DM.R.d(_payload.get("screenDestinations")).get("destinations"))
	var req := DM.add_request(dests, type)
	_busy = true
	var r: Dictionary = await DevicesTarget.api.post_json("/api/device-view", {"addDestination": req.body})
	if r.ok and req.screen >= 1 and DevicesTarget.settings.is_loaded:
		var seed := DM.seed_patch(req.screen, DevicesTarget.settings.settings)
		if not seed.is_empty():
			await DevicesTarget.api.post_json("/api/settings", seed)
			await DevicesTarget.settings.load_from_server()
	_busy = false
	_done(r, "Add destination")


func _patch(id: String, body: Dictionary) -> void:
	var b := body.duplicate()
	b.id = id
	_done(await DevicesTarget.api.post_json("/api/device-view", {"updateDestination": b}), "Update destination")


func _remove(id: String) -> void:
	var warn := _remove_warning(id)
	if warn != "" and not await _ask(warn, "Remove"):
		return
	var r: Dictionary = await DevicesTarget.api.post_json("/api/device-view", {"removeDestination": {"id": id}})
	if r.ok:
		deselect()
	_done(r, "Remove destination")


## WO-918 F21: looks on the removed screen's bus stay in the project but nothing shows them — say so first.
func _remove_warning(id: String) -> String:
	var e: Dictionary = _entries.get(id, {})
	if e.is_empty() or e.get("host") == true or not DM.is_main_bus(e.get("mode")):
		return ""
	var idx := maxi(0, str(DM.R.d(e.get("dest")).get("mainScreenIndex", 0)).to_int())
	return DM.remove_confirm(str(e.get("label", id)), DM.looks_on_main(Store.project.get("scenes"), idx), idx)


func _ask(text: String, ok_text: String) -> bool:
	var dlg := ConfirmationDialog.new()
	dlg.dialog_text = text
	dlg.ok_button_text = ok_text
	dlg.title = "Confirm"
	add_child(dlg)
	dlg.confirmed.connect(func() -> void: _decided.emit(true))
	dlg.canceled.connect(func() -> void: _decided.emit(false))  # Cancel and the window close
	dlg.popup_centered()
	var ok: bool = await _decided
	dlg.queue_free()
	return ok


func _done(r: Dictionary, what: String) -> void:
	if r.ok:
		changed.emit()
	else:
		status.emit("%s failed: %s" % [what, _error(r)], false)



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


## The band's rows, or its note (host channels configured above / nothing yet).
func _show_band(payload: Dictionary) -> void:
	for c in _band.get_children():
		_band.remove_child(c)
		c.queue_free()
	var live_cm: Variant = DevicesTarget.value("channelMap")
	var rows := LI.band_rows(payload, live_cm)
	if rows.is_empty():
		_band.add_child(_note(LI.BAND_HOSTS_NOTE if not LI.H.host_destinations(payload, live_cm).is_empty() else LI.BAND_EMPTY_NOTE))
	for r in rows:
		var b := Button.new()
		b.text = "%s\n%s" % [r.label, r.detail]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.focus_mode = Control.FOCUS_NONE
		b.disabled = r.connectorId == ""
		b.add_theme_font_size_override("font_size", 12)
		if r.connectorId != "":
			b.tooltip_text = "Open this connector's settings"
			b.pressed.connect(func() -> void: focus_connector.emit(r.connectorId))
		_band.add_child(b)


## Title, "PGM/PRV · 1920x1080@50" (or "HOST · ch N"), then the output dot(s): one per half for a PGM/PRV pair
## (`id#pgm`, `id#prv`; PRV without a dot on a switcher bus) and for the Operator GUI's monitors "1" / "2" (WO-920:
## the same two anchors), else one on the title row. Under it: its cables.
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
	if Drop.accepts(d.dest):
		card.set_drag_forwarding(Callable(), func(_at: Vector2, data: Variant) -> bool: return Drop.parse(data) != "",
			func(_at: Vector2, data: Variant) -> void: _drop(Drop.parse(data), d))
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
	for i in d.halves.size():
		var half: String = d.halves[i]
		var tag_text: String = d.half_tags[i]
		var row := HBoxContainer.new()
		row.mouse_filter = Control.MOUSE_FILTER_PASS
		row.custom_minimum_size.y = 26
		var gui: bool = d.mode == "operator_gui"
		var tag := _label(tag_text, ThemeBuilder.TEXT if gui else (PGM if half == "pgm" else PRV), 11)
		tag.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT  # next to its dot, not at the card's left edge
		row.add_child(tag)
		if half == "pgm" or d.get("prv_dot", true):
			var tip := "%s %s output" % [d.label, tag_text]
			if gui:
				tip = "%s — monitor %s (%s window)" % [d.label, tag_text, "second operator" if half == "prv" else "main"]
			row.add_child(_dot(anchors, Model.anchor_key(d.connector, half), tip))
		v.add_child(row)
	for l in d.links:
		wrap.add_child(_label("  • " + str(l), ThemeBuilder.TEXT_MUTED, 11))
	return wrap


## A DeckLink connector dropped on destination `d`: status, then restart-dirty + reload (`changed`).
func _drop(cid: String, d: Dictionary) -> void:
	var io := DropIo.new()
	io.on_status = func(text: String, ok: bool) -> void: status.emit(text, ok)
	io.on_reload = func() -> void: changed.emit()
	await Drop.new(io).to_destination(cid, d.dest, d.intent)


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
