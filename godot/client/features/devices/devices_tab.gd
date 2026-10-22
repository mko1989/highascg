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
## Slice 4: a GPU port's row label (or a destination's mapped GPU output) opens gpu_output_controls.gd's page in the
## Inspector; it and a destination page exclude each other.
## Slice 5/6: DeckLink ports and the Stream / Record / Virtual cam / Audio outputs open their pages the same way;
## the rear panel's "+" adds an output (output_port_controls.gd).
## Slice 7: a click on the rear panel's background (not a port, cable or "+") opens the Caspar server page
## (server_controls.gd — frame rate, CEF, network, hot backup), like the web's casparBand → selectDevice(CASPAR_HOST).
## Slice 7c: the "Mapping nodes" column (mapping_panel.gd) between the destinations and the rear panel; a card (or a
## mapping connector focused from a destination) opens the node page (mapping_controls.gd).
## Slice 8: the header's download arrow saves a device snapshot (snapshot_dialogs.gd); Load opens from WO-608.
## Slice 10: the header (devices_toolbar.gd) toggles the Matrix view (matrix_view.gd) in place of the panels, and
## the Node view (node_panel.gd's cards in place of the rear panel, Bézier cables). The cables list is cables_list.gd.

const Model := preload("res://features/devices/devices_model.gd")
const PortIcon := preload("res://features/devices/port_icon.gd")
const RearPanel := preload("res://features/devices/rear_panel.gd")
const CableLayer := preload("res://features/devices/cable_layer.gd")
const CableGesture := preload("res://features/devices/cable_gesture.gd")
const H := preload("res://features/devices/host_channels.gd")
const DestinationsPanel := preload("res://features/devices/destinations_panel.gd")
const CableRules := preload("res://features/devices/cable_rules.gd")
const GpuControls := preload("res://features/devices/gpu_output_controls.gd")
const DeckLinkControls := preload("res://features/devices/decklink_port_controls.gd")
const OutputControls := preload("res://features/devices/output_port_controls.gd")
const ServerControls := preload("res://features/devices/server_controls.gd")
const MappingPanel := preload("res://features/devices/mapping_panel.gd")
const MappingControls := preload("res://features/devices/mapping_controls.gd")
const SnapshotDialogs := preload("res://features/devices/snapshot_dialogs.gd")
const LiveInputDialog := preload("res://features/devices/live_input_dialog.gd")
const Toolbar := preload("res://features/devices/devices_toolbar.gd")
const MatrixView := preload("res://features/devices/matrix_view.gd")
const ClusterPanel := preload("res://features/devices/cluster_panel.gd")  # WO-670 P2: linked servers
const NodePanel := preload("res://features/devices/node_panel.gd")
const NV := preload("res://features/devices/node_view_model.gd")
const CablesList := preload("res://features/devices/cables_list.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")

var _dests: DestinationsPanel
var _rear: RearPanel
var _list: CablesList
var _nodes: NodePanel
var _cables: Control
var _loading := false
var _reload_again := false
var _sticky := false  # the status holds a result/error worth keeping over the next "Updated …"
var _gesture: Node
var _anchors := {}  # anchor key → port_icon.gd
var _bar: Toolbar
var _body: Control
var _matrix: MatrixView
var _confirm: ConfirmationDialog
var _gpu: GpuControls
var _deck: DeckLinkControls
var _outp: OutputControls
var _server: ServerControls
var _maps: MappingPanel
var _mapc: MappingControls
var snapshots: SnapshotDialogs
var live_inputs: LiveInputDialog
var _payload := {}  # the merged device-view payload the page was built from


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
	snapshots = SnapshotDialogs.new()
	add_child(snapshots)
	snapshots.status.connect(_set_status)
	snapshots.applied.connect(refresh)
	live_inputs = LiveInputDialog.new()
	add_child(live_inputs)
	live_inputs.dirty.connect(func() -> void: _gesture.set_dirty(true))
	live_inputs.added.connect(refresh)
	_bar = Toolbar.new()
	v.add_child(_bar)
	_bar.cancel_pressed.connect(func() -> void: _gesture.cancel())
	_bar.reset_pressed.connect(func() -> void: _confirm.popup_centered())
	_bar.apply_pressed.connect(_gesture.apply_caspar)
	_bar.save_pressed.connect(func() -> void: snapshots.open_save(_rear, _cables))
	_bar.reload_pressed.connect(func() -> void:
		_sticky = false
		refresh())
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 40)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(body)
	_body = body
	_matrix = MatrixView.new()
	_matrix.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(_matrix)
	_matrix.route.connect(_gesture.route)
	_matrix.header.connect(_open_header)
	_matrix.add.connect(_matrix_add)
	var left := ScrollContainer.new()
	left.custom_minimum_size.x = 280
	left.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(left)
	_dests = DestinationsPanel.new()
	_dests.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.add_child(_dests)
	_dests.status.connect(_set_status)
	_dests.refresh_requested.connect(refresh)
	_dests.add_live_input.connect(live_inputs.open)
	_dests.changed.connect(func() -> void:
		_gesture.set_dirty(true)
		refresh())
	_dests.selected.connect(func(id: String) -> void:
		if id != "":
			_close_port()
		if id != "" and _gesture.selected_edge != "":
			_gesture.selected_edge = ""
			_sync())
	_gpu = GpuControls.new()
	add_child(_gpu)
	_gpu.status.connect(_set_status)
	_gpu.dirty.connect(func() -> void: _gesture.set_dirty(true))
	_gpu.reload.connect(func(_dirty: bool) -> void: refresh())
	_deck = DeckLinkControls.new()
	add_child(_deck)
	_deck.status.connect(_set_status)
	_deck.dirty.connect(func() -> void: _gesture.set_dirty(true))
	_deck.reload.connect(func(_dirty: bool) -> void: refresh())
	_outp = OutputControls.new()
	add_child(_outp)
	_outp.status.connect(_set_status)
	_outp.dirty.connect(func() -> void: _gesture.set_dirty(true))
	_outp.reload.connect(func(_dirty: bool) -> void: refresh())
	_server = ServerControls.new()
	add_child(_server)
	_server.status.connect(_set_status)
	_server.dirty.connect(func() -> void: _gesture.set_dirty(true))
	_server.reload.connect(func(_dirty: bool) -> void: refresh())
	_mapc = MappingControls.new()
	add_child(_mapc)
	_mapc.status.connect(_set_status)
	_mapc.dirty.connect(func() -> void: _gesture.set_dirty(true))
	_mapc.reload.connect(func(_dirty: bool) -> void: refresh())
	var mid := ScrollContainer.new()
	mid.custom_minimum_size.x = 190
	mid.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	body.add_child(mid)
	_maps = MappingPanel.new()
	_maps.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mid.add_child(_maps)
	_maps.add_node.connect(_mapc.add_node)
	_maps.add_output.connect(_mapc.add_card_output)
	_maps.open_node.connect(_open_mapping)
	# The web opens that connector's inspector (GPU outputs, DeckLink ports); anything else selects its cable.
	_dests.focus_connector.connect(func(id: String) -> void:
		if _open_port(id):
			return
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
	_rear.add_requested.connect(_outp.add_output)
	_rear.order_changed.connect(refresh)
	_rear.open_requested.connect(_open_port)
	_rear.edit_toggled.connect(func(first: String) -> void:  # web: edit mode on opens the first port's page
		if first != "":
			_open_port(first)
		refresh())
	_rear.gpu_edit.connect(func(what: String, a: String, b: String) -> void: _gpu.rear_action(what, a, b, _payload))
	right.add_child(_rear)
	_nodes = NodePanel.new()
	_nodes.add_requested.connect(_outp.add_output)
	_nodes.open_requested.connect(_open_port)
	right.add_child(_nodes)
	_list = CablesList.new()
	_list.hover.connect(func(id: String, on: bool) -> void:
		if on or _cables.active_id == id:
			_cables.active_id = id if on else "")
	_list.select.connect(func(id: String) -> void: _gesture.select_edge(id))
	_list.remove.connect(func(id: String) -> void: _gesture.remove_edge(id))
	right.add_child(_list)
	right.add_child(ClusterPanel.new())
	_cables = CableLayer.new()
	add_child(_cables)
	_cables.loops = Toolbar.saved_loops()  # WO-674: remembered per client
	_bar.loops_changed.connect(func(n: int) -> void: _cables.loops = n)
	_bar.view_changed.connect(func(_m: String) -> void:
		_show_mode()
		refresh())
	_show_mode()
	visibility_changed.connect(func() -> void: if is_visible_in_tree(): refresh())
	Ws.on("gpu_topology_changed", func(_d: Variant) -> void: if is_visible_in_tree(): refresh())  # DRM hotplug
	Model.GL.CP.listen(func(keys: Array) -> void:  # WO-598 D: shared GPU rows / DeckLink order loaded or changed elsewhere
		if is_visible_in_tree() and (keys.has("loaded") or keys.has("gpuLayout") or keys.has("decklinkRearOrder")):
			refresh())
	if is_visible_in_tree():
		refresh()


func _show_mode() -> void:
	var matrix := _bar.mode() == "matrix"
	_body.visible = not matrix
	_cables.visible = not matrix
	_matrix.visible = matrix
	_cables.simple = _bar.mode() == "simple"
	_rear.visible = not _cables.simple
	_nodes.visible = _cables.simple


## Matrix header: a destination opens its card, a connector its page (web selectDestinationById / selectKey).
func _open_header(id: String) -> void:
	var h := MatrixView.M.header_target(id)
	if h[0] == "dest":
		_close_port()
		_dests.select(h[1])
	elif not _open_port(h[1]):
		_set_status("%s has no settings page." % CableRules.friendly_label(_payload, id), false)


func _matrix_add(what: String) -> void:
	match what:
		"destination":
			await _dests.add("pgm_prv")
		"pixel_map":
			await _mapc.add_node()
		"live_input":
			live_inputs.open()
		_:
			await _outp.add_output(what)


## GET /api/device-view (+ settings once — the cable writes seed from them). A reload asked for while one is in
## flight runs again after it, so a mutation is never answered by a read that started before it.
## WO-604: a live-audio strip clicked in the Audio tab → that slot's host-channel page (web live-audio-input-select).
func inspect_destination(id: String) -> void:
	if not _dests.has(id):
		await refresh()
	_close_port()
	_dests.select(id)


## Something outside the tab changed Caspar's plan (a DeckLink dropped on Sources).
func mark_restart_dirty() -> void:
	_gesture.set_dirty(true)


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
	show_model(Model.build(payload, Store.get_value("channelMap"), Store.get_value("configComparison"),
		RearPanel.DO.saved(), Model.GL.saved()), payload)


func show_model(m: Dictionary, payload: Dictionary) -> void:
	_payload = payload
	var anchors := {}
	_dests.show_model(m, payload, anchors)
	_maps.show_nodes(payload, anchors, _mapc.node_id)
	if _matrix.visible:
		_matrix.show_payload(payload, Store.get_value("channelMap"))
	if _nodes.visible:
		_nodes.show_sections(NV.sections(m.slots, payload))
		anchors.merge(_nodes.anchors)
	else:
		_rear.show_slots(m.slots)
		anchors.merge(_rear.anchors)
	_list.show_cables(m.cables)
	_cables.edges = CableRules.a(CableRules.d(payload.get("graph")).get("edges"))
	_cables.set_cables(m.cables, anchors)
	_anchors = anchors
	for page in [_gpu, _deck, _outp]:
		if page.conn_id != "":
			var conn := _connector(page.conn_id)
			if conn.is_empty():
				_close_port()
			else:
				page.show_connector(conn, payload, Settings.settings)
	if _server.is_open:
		_server.show_server(payload, Settings.settings)
	if _mapc.node_id != "":
		if _mapc.G.find_node(payload.get("graph"), _mapc.node_id).is_empty():
			_close_port()
		else:
			_mapc.show_node(payload, _mapc.node_id)
	_sync()


func _connector(id: String) -> Dictionary:
	return CableRules.connector_by_id(_payload, id)


## The connector page for `id` (GPU output, DeckLink port, stream / record / virtual cam / audio output) in the shared
## Inspector (a destination page gives way); false when the connector has no page.
func _open_port(id: String) -> bool:
	var conn := _connector(id)
	var kind := str(conn.get("kind", ""))
	if kind in ["pixel_map_in", "pixel_map_out"]:
		_open_mapping(str(conn.get("deviceId", "")))
		return true
	var page: Node = _gpu if kind == "gpu_out" else (_deck if kind in ["decklink_io", "decklink_out"] else
		(_outp if kind in OutputControls.KINDS else null))
	if page == null:
		return false
	_dests.deselect()
	_close_port()
	page.show_connector(conn, _payload, Settings.settings)
	if InspectorPanel.current != null:
		InspectorPanel.current.present(page.page)
	_sync()
	return true


func _close_port() -> void:
	for page in [_gpu, _deck, _outp]:
		if page.conn_id != "":
			page.close()
			if InspectorPanel.current != null:
				InspectorPanel.current.release(page.page)
	if _server.is_open:
		_server.close()
		if InspectorPanel.current != null:
			InspectorPanel.current.release(_server.page)
	if _mapc.node_id != "":
		_mapc.close()
		_maps.highlight("")
		if InspectorPanel.current != null:
			InspectorPanel.current.release(_mapc.page)
	_sync()


func _open_mapping(id: String) -> void:
	_dests.deselect()
	_close_port()
	_mapc.show_node(_payload, id)
	_maps.highlight(id)
	if InspectorPanel.current != null:
		InspectorPanel.current.present(_mapc.page)


func _open_server() -> void:
	_dests.deselect()
	_close_port()
	_server.show_server(_payload, Settings.settings)
	if InspectorPanel.current != null:
		InspectorPanel.current.present(_server.page)


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
	_bar.sync(g)
	_list.mark(g.selected_edge)
	var open := ""
	for page in [_gpu, _deck, _outp]:
		open = page.conn_id if page.conn_id != "" else open
	_nodes.highlight(open, g.source_id if g.armed() else "")


## Gesture prompts ("Cable armed…", "Cable end grabbed…") give way to the next reload; results and errors stay.
func _set_status(text: String, ok: bool) -> void:
	_sticky = not ok or not (text.begins_with("Cable armed") or text.begins_with("Cable end grabbed") or text.begins_with("Applying"))
	_bar.set_status(text, ok)


## Clicks are taken here, before the GUI: a connector dot (rect grown 3 px) drives the gesture, a rear-panel port's
## row label or socket opens its page, then a cable selects;
## anything else cancels an armed gesture (web: empty space restores) and lets the click through.
func _input(event: InputEvent) -> void:
	if not is_visible_in_tree() or _confirm.visible or snapshots.is_open() or live_inputs.is_open() or _matrix.visible:
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
	if _rear.visible and _rear.begin_drag(pos):  # a DeckLink label press drags (release without a drop opens the page)
		get_viewport().set_input_as_handled()
		return
	var port := _rear.label_at(pos) if _rear.visible else ""
	if port != "":
		get_viewport().set_input_as_handled()
		_open_port(port)
		return
	var on_ui := _list.get_global_rect().has_point(pos) or _bar.get_global_rect().has_point(pos)
	var hit: String = _cables.hit(_cables.get_global_transform().affine_inverse() * pos)
	if hit != "":
		get_viewport().set_input_as_handled()
		_gesture.select_edge(hit)
	elif (_rear if _rear.visible else _nodes).get_global_rect().has_point(pos) and not get_viewport().gui_get_hovered_control() is BaseButton:
		if _gesture.selected_edge != "":
			_gesture.selected_edge = ""
			_sync()
		_open_server()
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
	elif k.keycode == KEY_Z and k.is_command_or_control_pressed() and not k.shift_pressed and _gesture.can_undo():
		get_viewport().set_input_as_handled()
		_gesture.undo()
	elif (k.keycode == KEY_DELETE or k.keycode == KEY_BACKSPACE) and _gesture.selected_edge != "":
		get_viewport().set_input_as_handled()
		_gesture.remove_edge(_gesture.selected_edge)
