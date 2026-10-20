extends VBoxContainer
## WO-631 — Follow output choice (owner 20.10: "add PosiStageNet output then. with a raw artnet as backup choice"):
## PosiStageNet sends the markers as PSN trackers so grandMA3 / MagicQ aim their own fixtures; Art-Net (backup) is
## this box aiming the patched heads itself. Edits `project.fixtures.output` {protocol, psn} via follow_section.gd;
## the server (src/fixtures/psn.js) transmits. Interface choices and counters come from GET /api/tracking/follow.

const F := preload("res://features/previs/tracking/follow_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
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
var _ifaces: Array = []  # [{name, address}]
var _server := {}  # the last GET /api/tracking/follow `psn` (kept for refreshes that don't poll)


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_proto = _options(PROTOCOLS, func(i: int) -> void: _emit("protocol", PROTOCOLS[i][0]))
	add_child(_proto)
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
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			poll())


## Server counters + interface list (on show, and from follow_section's refresh).
func poll() -> void:
	var res: Dictionary = await Api.get_json("/api/tracking/follow")
	var body: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var psn: Dictionary = body.get("psn") if body.get("psn") is Dictionary else {}
	_ifaces = psn.get("interfaces") if psn.get("interfaces") is Array else []
	_server = psn
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
	if not is_psn:
		_status.text = "Art-Net backup: the patched heads below are aimed by this box. Release them on the console first."
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


func _options(items: Array, cb: Callable) -> OptionButton:
	var b := OptionButton.new()
	for it in items:
		b.add_item(it[1])
	b.item_selected.connect(cb)
	return b


func _pair(text: String, c: Control) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_grid.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_grid.add_child(c)


func _line(cb: Callable) -> LineEdit:
	var e := LineEdit.new()
	e.text_submitted.connect(cb)
	e.focus_exited.connect(func() -> void: cb.call(e.text))
	return e
