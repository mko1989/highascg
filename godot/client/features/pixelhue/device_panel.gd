extends ScrollContainer
## WO-1039 — PixelHue "Device" sub-tab (Studio device-ui.js, device-maintenance-ui.js, device-extras-ui.js,
## self-test-ui.js, source-backup-ui.js): name / identify / fan / genlock, operating mode, layer profile, clock,
## electrostatic protection, source backup, network, installed cards, self-test, restart / shut down / factory reset.
## Reads `device`, `self-test`, `source-backup`; writes `device` {changes}, `device-action`, `self-test`, `source-backup`.
## Anything that restarts, shuts down, resets or re-addresses the switcher asks first. Logic: device_model.gd.

signal status(text: String)

const M := preload("res://features/pixelhue/device_model.gd")
const StudioApi := preload("res://features/pixelhue/studio_api.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const NF := preload("res://core/numeric_field.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SelfTestBlock := preload("res://features/pixelhue/device_selftest_block.gd")
const BackupBlock := preload("res://features/pixelhue/device_backup_block.gd")

var _state: Dictionary = {}
var _body: VBoxContainer
var _busy := false
var _selftest: VBoxContainer
var _backup: VBoxContainer
# controls of the current render
var _name: LineEdit
var _beacon: OptionButton
var _fan: OptionButton
var _gl_type: OptionButton
var _gl_input: OptionButton
var _mode: OptionButton
var _layer: OptionButton
var _layer_note: Label
var _zone: OptionButton
var _when: LineEdit
var _instant := 0
var _as_enable: OptionButton
var _as_time: LineEdit
var _net_mode: OptionButton
var _net: Array = []
var _keep: OptionButton


func _init() -> void:
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_theme_constant_override("separation", 10)
	add_child(_body)
	_selftest = SelfTestBlock.new()
	_backup = BackupBlock.new()
	for b in [_selftest, _backup]:
		b.connect("send", _send)
	_backup.connect("problem", func(t: String) -> void: status.emit(t))
	var l := Label.new()
	l.text = "Connect a device to load its setup."
	_body.add_child(l)


func refresh() -> void:
	if _busy:
		return
	_busy = true
	var r := await StudioApi.read(Api, "device")
	if not r.ok:
		_busy = false
		status.emit(str(r.error))
		return
	_state = r.data
	var st := await StudioApi.read(Api, "self-test")
	_selftest.call("show_state", st.data if st.ok else {})
	var bk := await StudioApi.read(Api, "source-backup")
	_backup.call("show_state", bk.data if bk.ok else {})
	_busy = false
	_render()


## One write. resource: device ({changes}), device-action, self-test, source-backup.
func _send(resource: String, body: Dictionary, done: String) -> void:
	if _busy:
		return
	_busy = true
	status.emit("Working…")
	var wire := {"changes": body} if resource == "device" else body
	var r := await StudioApi.write(Api, resource, wire)
	_busy = false
	if not r.ok:
		status.emit(str(r.error))
		_render()  # put the controls back to what the switcher has
		return
	var d: Dictionary = r.data
	match resource:
		"device":
			_state = d
			status.emit(done)
		"device-action":
			if M.is_reconnect(d):
				status.emit(str(d.get("message", "Done.")))
				if d.get("host") != null:
					status.emit("%s Reconnect at %s." % [str(d.get("message", "")), str(d.host)])
				return
			_state = d
			status.emit(done)
		"self-test":
			_selftest.call("show_state", d)
			status.emit(M.self_test_done(d))
			return
		"source-backup":
			_backup.call("show_state", d)
			status.emit(done)
			return
	_render()


func _render() -> void:
	for blk in [_selftest, _backup]:
		if blk.get_parent() == _body:
			_body.remove_child(blk)
	for c in _body.get_children():
		_body.remove_child(c)
		c.queue_free()
	if _state.is_empty():
		return
	var node: Dictionary = _state.get("node", {})
	var opts: Dictionary = _state.get("options", {})
	var dev: Dictionary = _state.get("device", {})
	Kit.heading(_body, "%s setup" % str(dev.get("model", "")))
	var facts := Kit.grid(_body)
	Kit.fill_grid(facts, M.facts(_state))
	_general(node, opts)
	if (opts.get("workModes", []) as Array).size() > 1:
		_mode_block(node, opts)
	if (opts.get("layerModes", []) as Array).size() > 1:
		_layer_block(node, opts)
	if node.get("time") is Dictionary and (opts.get("timezones", []) as Array).size() > 0:
		_clock_block(node, opts)
	if node.get("antiStatic") is Dictionary and opts.get("antiStatic") is Dictionary:
		_static_block(node, opts)
	_body.add_child(_backup)
	_network_block()
	if (node.get("subcards", []) as Array).size() > 0:
		_cards_block(node)
	_body.add_child(_selftest)
	_maintenance_block(opts)
	if _state.get("configurationAvailable") == false:
		Kit.note(_body, "Capability information is unavailable. Only reported settings are shown.")


func _option(items: Array, selected_value: int) -> OptionButton:
	var ob := OptionButton.new()
	for it in items:
		ob.add_item(str(it[1]), int(it[0]))
	var idx := ob.get_item_index(selected_value)
	if idx >= 0:
		ob.select(idx)
	return ob


func _labelled(parent: Node, text: String, c: Control) -> void:
	var r := Kit.row(parent)
	var l := Label.new()
	l.text = text
	l.custom_minimum_size.x = 150
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	r.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	r.add_child(c)


func _general(node: Dictionary, opts: Dictionary) -> void:
	Kit.heading(_body, "Device")
	_name = LineEdit.new()
	_name.text = str(node.get("name", ""))
	_name.max_length = 32
	_labelled(_body, "Device name", _name)
	_beacon = null
	if opts.get("beacon") == true:
		_beacon = _option([[0, "Off"], [1, "On"]], int(node.get("beacon", 0)))
		_labelled(_body, "Identify device", _beacon)
	_fan = null
	if (opts.get("fanModes", []) as Array).size() > 0:
		var fm: Array = []
		for v in opts.fanModes:
			fm.append([int(v), M.fan_label(int(v))])
		_fan = _option(fm, int(node.get("fanMode", 0)))
		_labelled(_body, "Fan mode", _fan)
	_gl_type = null
	_gl_input = null
	if (opts.get("genlockTypes", []) as Array).size() > 0:
		var gl: Dictionary = node.get("genlock", {}) if node.get("genlock") is Dictionary else {}
		var gt: Array = []
		for v in opts.genlockTypes:
			gt.append([int(v), M.genlock_label(int(v))])
		_gl_type = _option(gt, int(gl.get("type", 0)))
		_labelled(_body, "Genlock", _gl_type)
		var ins: Array = []
		for i in _state.get("inputs", []):
			ins.append([int(i.get("id", 0)), str(i.get("name", ""))])
		_gl_input = _option(ins, int(gl.get("sourceId", 0)))
		_labelled(_body, "Genlock input", _gl_input)
		_gl_input.get_parent().visible = int(gl.get("type", 0)) == 2
		_gl_type.item_selected.connect(func(_i: int) -> void: _gl_input.get_parent().visible = _gl_type.get_selected_id() == 2)
	Kit.button(_body, "Save device settings", _save_device)


func _save_device() -> void:
	var bad := M.validate_name(_name.text)
	if bad != "":
		status.emit(bad)
		return
	var form := {"name": _name.text, "beacon": _beacon.get_selected_id() if _beacon != null else -1,
		"fan": _fan.get_selected_id() if _fan != null else -1,
		"genlock_type": _gl_type.get_selected_id() if _gl_type != null else -1,
		"genlock_input": _gl_input.get_selected_id() if _gl_input != null and _gl_input.item_count > 0 else 0}
	var ch := M.device_changes(_state.get("node", {}), form)
	if ch.is_empty():
		status.emit("No device changes.")
		return
	_send("device", ch, "Device settings saved.")


func _mode_block(node: Dictionary, opts: Dictionary) -> void:
	Kit.heading(_body, "Operating mode")
	var items: Array = []
	for m in opts.workModes:
		items.append([int(m.value), str(m.label)])
	var cur: int = int((node.get("mode", {}) as Dictionary).get("workMode", -1))
	_mode = _option(items, cur)
	_labelled(_body, "Mode", _mode)
	Kit.button(_body, "Change mode", func() -> void:
		if _mode.get_selected_id() == cur:
			return
		Kit.confirm(self, "Changing device mode can reset screens and routing. Change mode?",
			func() -> void: _send("device", M.mode_body(_mode.get_selected_id()), "Device mode changed.")))


func _layer_block(node: Dictionary, opts: Dictionary) -> void:
	Kit.heading(_body, "Layer profile")
	var cur := int(node.get("layerMode", -1))
	var items: Array = []
	for m in opts.layerModes:
		items.append([int(m.value), "%s%s" % [str(m.label), " (current)" if int(m.value) == cur else ""]])
	_layer = _option(items, cur)
	_labelled(_body, "Profile", _layer)
	_layer_note = Kit.note(_body, "")
	var upd := func(_i := 0) -> void:
		for m in opts.layerModes:
			if int(m.value) == _layer.get_selected_id():
				_layer_note.text = M.layer_text(m)
	_layer.item_selected.connect(upd)
	upd.call()
	Kit.button(_body, "Change layer profile", func() -> void:
		if _layer.get_selected_id() == cur:
			return
		Kit.confirm(self, "Switch layer profile? The device recreates its layers, so existing layer programming can be lost.",
			func() -> void: _send("device", M.layer_body(_layer.get_selected_id()), "Layer profile changed.")))


func _clock_block(node: Dictionary, opts: Dictionary) -> void:
	Kit.heading(_body, "Device clock")
	var zones: Array = opts.timezones
	var items: Array = []
	for z in zones:
		items.append([int(z.value), M.zone_label(z)])
	var t: Dictionary = node.time
	_zone = _option(items, int(t.get("timezone", 0)))
	_labelled(_body, "Time zone", _zone)
	_instant = int(t.get("timestamp", 0))
	_when = LineEdit.new()
	_when.text = M.wall_time(_instant, M.zone_offset(zones, _zone.get_selected_id()))
	_when.placeholder_text = "YYYY-MM-DD HH:MM:SS"
	_labelled(_body, "Date and time", _when)
	# changing the zone keeps the instant and shows it in the new zone, as the device will
	_when.text_submitted.connect(func(s: String) -> void:
		var v := M.parse_wall_time(s, M.zone_offset(zones, _zone.get_selected_id()))
		if v >= 0:
			_instant = v)
	_zone.item_selected.connect(func(_i: int) -> void:
		_when.text = M.wall_time(_instant, M.zone_offset(zones, _zone.get_selected_id())))
	var r := Kit.row(_body)
	Kit.button(r, "Set clock", func() -> void:
		var v := M.parse_wall_time(_when.text, M.zone_offset(zones, _zone.get_selected_id()))
		if v < 0:
			status.emit("Device date and time must look like 2026-11-11 14:30:00 (2000-2100).")
			return
		_send("device", M.clock_body(_zone.get_selected_id(), v), "Device settings saved."))
	Kit.button(r, "Use this computer's time", func() -> void:
		var now := int(Time.get_unix_time_from_system())
		var tz_min := int(Time.get_time_zone_from_system().get("bias", 0))
		var pick := _zone.get_selected_id()
		for z in zones:  # a zone with this computer's UTC offset, if the current choice differs
			if int(z.offset) == tz_min and M.zone_offset(zones, pick) != tz_min:
				pick = int(z.value)
				break
		_send("device", M.clock_body(pick, now), "Device settings saved."))


func _static_block(node: Dictionary, opts: Dictionary) -> void:
	Kit.heading(_body, "Electrostatic protection")
	var lim: Dictionary = opts.antiStatic
	var a: Dictionary = node.antiStatic
	_as_enable = _option([[0, "Off"], [1, "On"]], int(a.get("enable", 0)))
	_labelled(_body, "Protection", _as_enable)
	_as_time = LineEdit.new()
	NF.math_line(_as_time, true, int(lim.get("min", 0)), int(lim.get("max", 0)))
	_as_time.text = str(int(a.get("time", 0)))
	_labelled(_body, "Hold last image (%d-%d ms)" % [int(lim.get("min", 0)), int(lim.get("max", 0))], _as_time)
	Kit.button(_body, "Save protection", func() -> void:
		var r := M.anti_static(_as_enable.get_selected_id(), _as_time.text, lim)
		if not r.ok:
			status.emit(str(r.error))
			return
		_send("device", r.body, "Device settings saved."))
	Kit.note(_body, "When a static discharge briefly drops an input, its last image is held for this long instead of going black.")


func _network_block() -> void:
	Kit.heading(_body, "Network")
	var n: Variant = _state.get("network")
	if not n is Dictionary:
		Kit.note(_body, "Network settings are unavailable on this device.")
		return
	_net_mode = _option([[0, "Static"], [1, "DHCP"]], int(n.get("dhcp", 0)))
	_labelled(_body, "Address mode", _net_mode)
	_net = []
	for k in [["ip", "IP address"], ["netmask", "Subnet mask"], ["gateway", "Gateway"]]:
		var le := LineEdit.new()
		le.text = str(n.get(k[0], ""))
		_labelled(_body, str(k[1]), le)
		_net.append(le)
	var sync := func(_i := 0) -> void:
		for le in _net:
			(le as LineEdit).editable = _net_mode.get_selected_id() == 0
	_net_mode.item_selected.connect(sync)
	sync.call()
	Kit.button(_body, "Save network", func() -> void:
		var r := M.network(_net_mode.get_selected_id(), (_net[0] as LineEdit).text, (_net[1] as LineEdit).text, (_net[2] as LineEdit).text)
		if not r.ok:
			status.emit(str(r.error))
			return
		var cur: Dictionary = _state.network
		var net: Dictionary = r.network
		if int(net.dhcp) == int(cur.get("dhcp", -1)) and (int(net.dhcp) == 1 or (net.ip == cur.get("ip") and net.netmask == cur.get("netmask") and net.gateway == cur.get("gateway"))):
			status.emit("No network changes supplied.")
			return
		Kit.confirm(self, M.network_confirm(net), func() -> void: _send("device-action", M.network_action(net), "Network settings saved.")))
	Kit.note(_body, "%s · MAC %s" % [str(n.get("port", "")), str(n.get("mac", "unknown"))])


func _cards_block(node: Dictionary) -> void:
	Kit.heading(_body, "Installed cards")
	var g := Kit.grid(_body)
	g.columns = 4
	for r in M.card_rows(node.subcards):
		for cell in r:
			var l := Label.new()
			l.text = str(cell)
			l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			l.custom_minimum_size.x = 160
			g.add_child(l)


func _maintenance_block(opts: Dictionary) -> void:
	Kit.heading(_body, "Restart and reset")
	var who := M.device_name(_state)
	var power: Array = opts.get("power", [])
	var r := Kit.row(_body)
	if power.has("restart"):
		Kit.button(r, "Restart device", func() -> void:
			Kit.confirm(self, "Restart %s? Outputs go dark until it is back." % who,
				func() -> void: _send("device-action", M.restart_action(), "")))
	if power.has("shutdown"):
		Kit.button(r, "Shut down", func() -> void:
			Kit.confirm(self, "Shut down %s? It can only be powered on again at the unit." % who,
				func() -> void: _send("device-action", M.shutdown_action(), "")))
	var items: Array = []
	for i in M.RESET_KEEPS.size():
		items.append([i, M.RESET_KEEPS[i][1]])
	_keep = _option(items, 0)
	_labelled(_body, "Factory reset", _keep)
	Kit.button(_body, "Factory reset…", func() -> void:
		var keep: String = M.RESET_KEEPS[_keep.get_selected_id()][0]
		Kit.prompt(self, "Factory reset %s: %s. The device restarts. Type RESET to continue." % [who, M.keep_label(keep)], "",
			func(typed: String) -> void:
				if typed == "RESET":
					_send("device-action", M.factory_reset_action(keep), "")
				else:
					status.emit("Factory reset cancelled: RESET was not typed.")))
