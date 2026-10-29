extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 7 — the Caspar server page the Devices tab hands to the shared Inspector column when the rear panel's
## background is clicked (web device-view-caspar-render.js → selectDevice(CASPAR_HOST) →
## device-view-inspector-caspar.js): server facts, project frame rate, CEF GPU, network, and the hot backup
## (replication) section. server_page_model.gd builds the item list from server_flow.gd's state; the flow runs the
## requests through `_Io` below (the Api autoload). While open, the replication status is re-read every 3 s like the
## web's poll; the page is only rebuilt when its items changed, so an open select or a field being typed survives.
## The web toasts; the Devices tab has one status line, so a toast shows there when the action set no status itself.

signal dirty()

const M := preload("res://features/devices/server_page_model.gd")
const Flow := preload("res://features/devices/server_flow.gd")
const POLL_S := 3.0
const NetworkPane := preload("res://features/settings/network_pane.gd")

var page := VBoxContainer.new()
var is_open := false
var flow: Flow
var _io: _Io
var _timer := Timer.new()
var _shown: Array = []
var _status_set := false  # the running action set the status line (its toasts stay off it)
var _net: Control  # WO-692: kept across re-renders (the 3 s poll must not wipe a field being typed)


class _Io:
	extends RefCounted
	var c  # the server_controls.gd that made it; a replaced _Io is ignored

	func _init(owner: Node) -> void:
		c = owner

	static func _web(r: Dictionary) -> Dictionary:
		var err := ""
		if not r.ok:
			err = "HTTP %d: %s" % [r.status, r.error] if int(r.get("status", 0)) > 0 else str(r.error)
		return {"ok": r.ok, "data": r.data, "error": err}

	func get_json(path: String) -> Dictionary:
		return _web(await DevicesTarget.api.get_json(path))

	func post_json(path: String, body: Variant, timeout_s := 0.0) -> Dictionary:
		var r := _web(await DevicesTarget.api.post_json(path, body, timeout_s))
		if r.ok and path == "/api/settings":
			await DevicesTarget.settings.load_from_server()
		return r

	func confirm(text: String) -> bool:
		return await c._confirm(text, "OK")

	func reload() -> void:
		c.reload.emit(false)

	func dirty() -> void:
		c.dirty.emit()

	func status(text: String, ok: bool) -> void:
		c._status_set = true
		c.status.emit(text, ok)

	func toast(text: String, type: String) -> void:
		if not c._status_set:
			c.status.emit(text, type in ["success", "info"])

	func changed() -> void:
		if c._io == self:
			c._render()


func _init() -> void:
	page.add_theme_constant_override("separation", 4)
	_timer.wait_time = POLL_S
	_timer.timeout.connect(func() -> void:
		if is_open and not _busy:
			flow.refresh_status())


func _ready() -> void:
	add_child(_timer)


## (Re)open from the current device view + settings — the web re-renders the page on every load().
func show_server(payload: Dictionary, settings: Variant) -> void:
	is_open = true
	_io = _Io.new(self)
	flow = Flow.new(settings, payload, _io)
	_shown = []
	_render()
	_timer.start()
	flow.start()


func close() -> void:
	is_open = false
	_io = null
	_timer.stop()


func _render() -> void:
	if not is_open:
		return
	var items := M.items(flow.s, flow.clock.call(), true)
	if items == _shown:
		return
	_shown = items
	var focus: Variant = get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	var refocus: Variant = focus.get_meta("key", null) if focus is LineEdit and page.is_ancestor_of(focus) else null
	var caret: int = focus.caret_column if refocus != null else 0
	for ch in page.get_children():
		page.remove_child(ch)
		if ch != _net:
			ch.queue_free()
	var group := ButtonGroup.new()
	for it in items:
		var n := _item(it, group)
		page.add_child(n)
		if refocus != null and n is LineEdit and n.get_meta("key") == refocus:
			n.grab_focus()
			n.caret_column = caret


func _item(it: Dictionary, group: ButtonGroup) -> Control:
	match it.t:
		"network":
			if _net == null:
				_net = NetworkPane.new()
				_net.api = DevicesTarget.api
			return _net
		"title", "summary":
			return _title(it.text)
		"heading":
			var h := _text(it.text.to_upper(), ThemeBuilder.TEXT_MUTED, 11)
			h.custom_minimum_size.y = 26
			h.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
			return h
		"caption":
			return _caption(it.text)
		"small":
			var l := _note(it.text)
			l.add_theme_font_size_override("font_size", 10)
			match it.get("tone", ""):
				"ok":
					l.add_theme_color_override("font_color", ThemeBuilder.SUCCESS)
				"warn":
					l.add_theme_color_override("font_color", ThemeBuilder.WARN)
			return l
		"table":
			var g := GridContainer.new()
			g.columns = 2
			g.add_theme_constant_override("h_separation", 10)
			for r in it.rows:
				g.add_child(_caption(r[0]))
				var v := _text(r[1], ThemeBuilder.TEXT, 11)
				v.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
				v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
				g.add_child(v)
			return g
		"select":
			var ob := _select(it.options, it.value)
			ob.disabled = it.disabled
			ob.item_selected.connect(func(i: int) -> void: _on_select(it.key, str(ob.get_item_metadata(i))))
			return ob
		"check":
			var cb := _check(it.text, it.checked)
			cb.disabled = it.disabled
			cb.toggled.connect(func(on: bool) -> void: _act(func() -> void:
				if it.key == "auto_accept":  # WO-739
					await flow.set_auto_accept(on)
				else:
					await flow.set_cef(on)))
			return cb
		"radio":
			var rb := _check(it.text, it.checked)
			rb.button_group = group
			rb.toggled.connect(func(on: bool) -> void:
				if on:
					flow.s.net_mode = "static" if it.key == "net_static" else "dhcp"
					_render.call_deferred())
			return rb
		"input":
			var le := _line(it.value, "")
			le.set_meta("key", it.key)
			le.text_changed.connect(func(tx: String) -> void: flow.s[it.key] = tx)
			return le
		"button":
			var b := _button(it.text, func() -> void: pass)
			b.disabled = it.disabled
			b.pressed.connect(func() -> void: _act(func() -> void: await _press(it.text), b))
			return b
	return Control.new()


func _on_select(key: String, v: String) -> void:
	if key == "mode":
		_act(func() -> void: await flow.on_mode(v))
	else:
		flow.s[key] = v  # fps / iface / leader: read when their button is pressed


## One operator action at a time (the poll waits too); its toasts reach the status line only if it set none.
func _act(run: Callable, b: Button = null) -> void:
	if _busy:
		return
	_busy = true
	_status_set = false
	if b != null:
		b.disabled = true
	await run.call()
	_busy = false
	if is_instance_valid(b):
		b.disabled = false


func _press(text: String) -> void:
	match text:
		"Save project frame rate":
			await flow.save_fps()
		"Apply network":
			await flow.apply_network()
		"Scan for leaders":
			await flow.scan(false)
		"Become leader":
			await flow.become_leader()
		"Stop offering as leader":
			await flow.stop_leader()
		"Connect to leader":
			await flow.connect_leader()
		"Disconnect (standalone)":
			await flow.disconnect_peer()
		"Refresh connection":
			await flow.refresh_connection()
		"Apply Device View → Caspar":
			await flow.apply_caspar()
