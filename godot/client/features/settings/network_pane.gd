extends VBoxContainer
## WO-692 — Network: one card per NIC (GET /api/system/network `nics`, also ports that are down — a port without a
## cable keeps its settings and takes them when plugged in), DHCP / static + Apply (POST /api/system/network/apply;
## only the primary port's settings are the box's config.network), and Wi-Fi: on / off, scan, join with a password,
## disconnect (/api/system/network/wifi*). Lives in Settings → Network and on the Devices server page.

const Kit := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/network_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var _status: Label
var _cards: VBoxContainer
var _wifi_line: Label
var _wifi_box: VBoxContainer
var _radio: CheckButton
var _list: ItemList
var _pass: LineEdit
var _rows: Array = []
var _wifi_iface := ""
var _busy := false
var _loaded_at := 0


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	Kit.heading(self, "Network")
	Kit.note(self, "Every network port on this machine, also the ones without a cable — a port's settings are saved "
		+ "and take effect when it is plugged in. The primary port is the box's identity and on-screen address.")
	_status = Kit.note(self, "")
	_cards = VBoxContainer.new()
	_cards.add_theme_constant_override("separation", 10)
	add_child(_cards)
	Kit.heading(self, "Wi-Fi")
	_wifi_line = Kit.note(self, "Loading…")
	_wifi_box = VBoxContainer.new()
	_wifi_box.add_theme_constant_override("separation", 6)
	add_child(_wifi_box)
	var r := Kit.row(_wifi_box)
	_radio = CheckButton.new()
	_radio.text = "Wi-Fi on"
	_radio.toggled.connect(func(on: bool) -> void: _run("/api/system/network/wifi/radio", {"on": on}, "Turning Wi-Fi %s…" % ("on" if on else "off")))
	r.add_child(_radio)
	Kit.button(r, "Scan", func() -> void: _run("/api/system/network/wifi/scan", {"interface": _wifi_iface}, "Scanning…"))
	Kit.button(r, "Disconnect", func() -> void: _run("/api/system/network/wifi/disconnect", {"interface": _wifi_iface}, "Disconnecting…"))
	_list = ItemList.new()
	_list.custom_minimum_size.y = 150
	_list.item_activated.connect(func(_i: int) -> void: _join())
	_wifi_box.add_child(_list)
	var j := Kit.row(_wifi_box)
	_pass = LineEdit.new()
	_pass.secret = true
	_pass.placeholder_text = "Password (empty if open)"
	_pass.custom_minimum_size.x = 120
	_pass.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pass.text_submitted.connect(func(_t: String) -> void: _join())
	j.add_child(_pass)
	Kit.button(j, "Join", _join)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree() and Time.get_ticks_msec() - _loaded_at > 2000:
			refresh())
	refresh()


func refresh() -> void:
	_loaded_at = Time.get_ticks_msec()
	var net: Dictionary = await Api.get_json("/api/system/network")
	if not is_inside_tree():
		return
	if not net.ok:
		_status.text = "Network status unavailable: %s" % net.error
	else:
		_status.text = ""
		_fill_cards(net.data)
	var w: Dictionary = await Api.get_json("/api/system/network/wifi")
	if is_inside_tree():
		_fill_wifi(w.data if w.ok and w.data is Dictionary else {"available": false})


func _fill_cards(d: Dictionary) -> void:
	for c in _cards.get_children():
		c.queue_free()
	var primary := str(d.get("primaryInterface", ""))
	for nic in d.get("nics", []):
		if nic is Dictionary and str(nic.get("kind", "")) == "ethernet":
			_cards.add_child(_card(M.card(nic, primary)))
	if _cards.get_child_count() == 0:
		Kit.note(_cards, "No Ethernet ports found.")


func _card(c: Dictionary) -> Control:
	var panel := PanelContainer.new()
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	panel.add_child(v)
	var title := Label.new()
	title.text = c.title
	title.add_theme_font_size_override("font_size", 15)
	v.add_child(title)
	var st := Kit.note(v, "%s · MAC %s" % [c.status, c.mac])
	st.add_theme_color_override("font_color", ThemeBuilder.SUCCESS if c.up else ThemeBuilder.TEXT_MUTED)
	var modes := Kit.row(v)
	var group := ButtonGroup.new()
	var fields := GridContainer.new()  # label | field rows: narrow enough for the Inspector column
	fields.columns = 2
	fields.add_theme_constant_override("h_separation", 12)
	var edits := {}
	for f in [["IPv4 address", "ip", "192.168.1.20"], ["Prefix length", "prefix", "24"], ["Gateway", "gateway", "optional"],
			["DNS", "dns", "optional"]]:
		var l := Label.new()
		l.text = f[0]
		l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
		fields.add_child(l)
		var e := LineEdit.new()
		e.text = c[f[1]]
		e.placeholder_text = f[2]
		e.custom_minimum_size.x = 120
		e.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		fields.add_child(e)
		edits[f[1]] = e
	var mode := {"v": c.mode}
	for m in [["dhcp", "Auto (DHCP)"], ["static", "Manual (static)"]]:
		var rb := CheckBox.new()
		rb.text = m[1]
		rb.button_group = group
		rb.button_pressed = c.mode == m[0]
		rb.toggled.connect(func(on: bool) -> void:
			if on:
				mode.v = m[0]
				fields.visible = m[0] == "static")
		modes.add_child(rb)
	fields.visible = c.mode == "static"
	v.add_child(fields)
	var res := Label.new()
	res.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	var b := Kit.button(v, "Apply to %s" % c.name, func() -> void: pass)
	v.add_child(res)
	b.pressed.connect(func() -> void:
		var plan := M.apply_body(c.name, mode.v, edits.ip.text, edits.prefix.text, edits.gateway.text, edits.dns.text)
		if plan.has("error"):
			_say(res, plan.error, false)
			return
		if M.carries_origin(c, Config.origin):
			Kit.confirm(self, "This GUI reaches the server through %s. If its address changes, the GUI loses the server "
				% c.name + "until you reconnect to the new address. Apply?", func() -> void: _apply(plan.body, res, b))
		else:
			_apply(plan.body, res, b))
	return panel


func _apply(body: Dictionary, res: Label, b: Button) -> void:
	if _busy:
		return
	_busy = true
	b.disabled = true
	_say(res, "Applying…", true)
	var r: Dictionary = await Api.post_json("/api/system/network/apply", body)
	_busy = false
	if not is_instance_valid(res):
		return
	b.disabled = false
	if not r.ok:
		_say(res, _err(r), false)
		return
	var log := str(r.data.get("log", "")).strip_edges() if r.data is Dictionary else ""
	_say(res, log.get_slice("\n", log.count("\n")) if log != "" else "Applied.", true)
	await get_tree().create_timer(1.0).timeout
	refresh()


func _fill_wifi(st: Dictionary) -> void:
	_wifi_line.text = M.wifi_line(st)
	_wifi_box.visible = st.get("available", false)
	var ad: Array = st.get("adapters", [])
	_wifi_iface = str(ad[0].name) if not ad.is_empty() else ""
	_radio.set_pressed_no_signal(str(st.get("radio", "")) != "off")
	_rows = M.wifi_rows(st)
	_list.clear()
	for row in _rows:
		_list.add_item(row[0])


func _join() -> void:
	var sel := _list.get_selected_items()
	if sel.is_empty():
		_wifi_line.text = "Pick a network first."
		return
	var row: Array = _rows[sel[0]]
	if row[2] and _pass.text == "":
		_wifi_line.text = "\"%s\" needs a password." % row[1]
		return
	await _run("/api/system/network/wifi/connect", {"interface": _wifi_iface, "ssid": row[1], "password": _pass.text},
		"Joining \"%s\"…" % row[1])
	_pass.text = ""


func _run(path: String, body: Dictionary, busy: String) -> void:
	if _busy:
		return
	_busy = true
	_wifi_line.text = busy
	var r: Dictionary = await Api.post_json(path, body)
	_busy = false
	if not is_inside_tree():
		return
	if r.ok and r.data is Dictionary:
		_fill_wifi(r.data)
		refresh()
	else:
		_wifi_line.text = _err(r)


static func _err(r: Dictionary) -> String:
	var d: Variant = r.get("data")
	if d is Dictionary and d.has("error"):
		return str(d.error)
	return str(r.get("error", "failed"))


func _say(l: Label, text: String, ok: bool) -> void:
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if ok else ThemeBuilder.WARN)
