extends VBoxContainer
## WO-631 — Follow output choice (owner 20.10: "add PosiStageNet output then. with a raw artnet as backup choice"):
## PosiStageNet sends the markers as PSN trackers so grandMA3 / MagicQ aim their own fixtures; Art-Net (backup) is
## this box aiming the patched heads itself. Edits `project.fixtures.output` {protocol, psn} via follow_section.gd;
## the server (src/fixtures/psn.js) transmits. Interface choices and counters come from GET /api/tracking/follow.

const F := preload("res://features/previs/tracking/follow_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const SenderPicker := preload("res://features/devices/sender_picker.gd")
const PROTOCOLS := [["psn", "PosiStageNet → console (MA3 / MagicQ aim)"], ["artnet", "Art-Net backup (this box aims)"]]
const AXES := [["stage", "Stage frame: X stage left · Y upstage · Z up"], ["y_up", "Y up: x · height · −upstage (PSN text)"]]

signal edited(output: Dictionary)  # a new {protocol, psn} for project.fixtures.output (enabled untouched)

var output := {}
var _proto: OptionButton
var _grid: GridContainer
var _group: LineEdit
var _iface: OptionButton
var _sys: LineEdit
var _axes: OptionButton
var _status: Label
var _thru: GridContainer  # WO-632 read-through (Art-Net backup only)
var _thru_on: CheckBox
var _offset: SpinBox
var _fade: SpinBox
var _console := {}  # the last GET /api/tracking/follow `console` (frames the box sees)
var _ifaces: Array = []  # [{name, address}]
var _server := {}  # the last GET /api/tracking/follow `psn` (kept for refreshes that don't poll)


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_proto = _options(PROTOCOLS, func(i: int) -> void: _emit("protocol", PROTOCOLS[i][0]))
	add_child(_proto)
	add_child(SenderPicker.make("lighting", "Sent by"))  # WO-723: which linked server transmits (hidden on one box)
	_grid = GridContainer.new()
	_grid.columns = 2
	add_child(_grid)
	_group = _line(func(v: String) -> void: _emit_psn("group", v.strip_edges()))
	_group.placeholder_text = "236.10.10.10"
	_pair("Multicast group", _group)
	_iface = OptionButton.new()
	_iface.item_selected.connect(func(i: int) -> void: _emit_psn("iface", "" if i == 0 else str(_ifaces[i - 1].address)))
	_pair("Interface", _iface)
	_sys = _line(func(v: String) -> void: _emit_psn("system_name", v.strip_edges()))
	_pair("System name", _sys)
	_axes = _options(AXES, func(i: int) -> void: _emit_psn("axes", AXES[i][0]))
	_pair("Axes", _axes)
	_thru = GridContainer.new()
	_thru.columns = 2
	add_child(_thru)
	_thru_on = CheckBox.new()
	_thru_on.text = "Read the console first"
	_thru_on.tooltip_text = ("The console sends the heads' universes to this box; every channel passes through, and pan / tilt\n" +
		"fade to tracking while the marker is tracked, then back to the console's values when it is lost.")
	_thru_on.toggled.connect(func(on: bool) -> void: _emit_through("enabled", on))
	_pair_in(_thru, "Read-through", _thru_on)
	_offset = _spin(-32767, 32767, 1, func(v: float) -> void: _emit_through("offset", int(v)))
	_pair_in(_thru, "Console universe = out +", _offset)
	_fade = _spin(0, 30, 0.1, func(v: float) -> void: _emit_through("fade_s", v))
	_pair_in(_thru, "Handover fade s", _fade)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			poll())
	var t := Timer.new()  # counters + console frames stay live while the page is open
	t.wait_time = 2.0
	t.timeout.connect(func() -> void:
		if is_visible_in_tree():
			poll())
	add_child(t)
	t.start()


## Server counters + interface list (on show, and from follow_section's refresh).
func poll() -> void:
	var res: Dictionary = await Api.get_json("/api/tracking/follow")
	var body: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var psn: Dictionary = body.get("psn") if body.get("psn") is Dictionary else {}
	_ifaces = psn.get("interfaces") if psn.get("interfaces") is Array else []
	_server = psn
	_console = body.get("console") if body.get("console") is Dictionary else {}
	show_output(output)


func show_output(o: Dictionary) -> void:
	output = o
	var server := _server
	if _proto == null:
		return
	var psn: Dictionary = o.get("psn", F.normalize_psn({}))
	var is_psn: bool = o.get("protocol", "psn") == "psn"
	_proto.select(0 if is_psn else 1)
	_grid.visible = is_psn
	if not _group.has_focus():
		_group.text = str(psn.group)
	if not _sys.has_focus():
		_sys.text = str(psn.system_name)
	_axes.select(0 if psn.axes == "stage" else 1)
	_iface.clear()
	_iface.add_item("OS default route")
	var at := 0
	for i in _ifaces.size():
		_iface.add_item("%s  %s" % [_ifaces[i].name, _ifaces[i].address])
		if str(_ifaces[i].address) == str(psn.iface):
			at = i + 1
	if psn.iface != "" and at == 0:
		_iface.add_item("%s (not on this box)" % psn.iface)
		at = _iface.item_count - 1
	_iface.select(at)
	var thru: Dictionary = o.get("through", F.normalize_through({}))
	_thru.visible = not is_psn
	_thru_on.set_pressed_no_signal(thru.enabled)
	if not _offset.get_line_edit().has_focus():
		_offset.set_value_no_signal(thru.offset)
	if not _fade.get_line_edit().has_focus():
		_fade.set_value_no_signal(thru.fade_s)
	_offset.editable = thru.enabled
	_fade.editable = thru.enabled
	if not is_psn:
		_status.text = ("Art-Net backup: this box aims the patched heads. " + ("Read-through: the console keeps them until " +
			"a head's marker is tracked, then pan / tilt fade over. Send the console's universes to this box at output + %d." % thru.offset
			if thru.enabled else "Release them on the console first."))
		var seen: Array = _console.get("universes", []) if _console.get("universes") is Array else []
		if thru.enabled:
			_status.text += ("\nConsole frames: none yet" if seen.is_empty() else "\nConsole frames: " + ", ".join(seen.map(
				func(u: Dictionary) -> String: return "U%d from %s (%.1f s)" % [int(u.universe), u.from, float(u.age_ms) / 1000.0])))
		return
	_status.text = ("Trackers = markers (id = marker id). On the console: PSN input, map tracker ids to fixtures." +
		" Calibrate (below) jogs heads over Art-Net — pick the backup while calibrating.")
	if not server.is_empty():
		_status.text = "PSN %s → %s:%d · %d packets · %d errors%s\n" % ["ON" if server.get("enabled") else "off",
			psn.group, int(psn.port), int(server.get("packets_sent", 0)), int(server.get("send_errors", 0)),
			(" · " + str(server.last_error)) if server.get("last_error") != null else ""] + _status.text


func _emit(key: String, v: Variant) -> void:
	var o := output.duplicate(true)
	if o.get(key) == v:
		return
	o[key] = v
	edited.emit(o)


func _emit_psn(key: String, v: Variant) -> void:
	var o := output.duplicate(true)
	var psn: Dictionary = o.get("psn", F.normalize_psn({}))
	if psn.get(key) == v:
		return
	psn[key] = v
	o["psn"] = F.normalize_psn(psn)
	edited.emit(o)


func _emit_through(key: String, v: Variant) -> void:
	var o := output.duplicate(true)
	var th: Dictionary = o.get("through", F.normalize_through({}))
	if th.get(key) == v:
		return
	th[key] = v
	o["through"] = F.normalize_through(th)
	edited.emit(o)


func _spin(lo: float, hi: float, step: float, cb: Callable) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = step
	sb.update_on_text_changed = true
	sb.value_changed.connect(cb)
	return sb


func _options(items: Array, cb: Callable) -> OptionButton:
	var b := OptionButton.new()
	for it in items:
		b.add_item(it[1])
	b.item_selected.connect(cb)
	return b


func _pair(text: String, c: Control) -> void:
	_pair_in(_grid, text, c)


func _pair_in(grid: GridContainer, text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	grid.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	grid.add_child(c)


func _line(cb: Callable) -> LineEdit:
	var e := LineEdit.new()
	e.text_submitted.connect(cb)
	e.focus_exited.connect(func() -> void: cb.call(e.text))
	return e
