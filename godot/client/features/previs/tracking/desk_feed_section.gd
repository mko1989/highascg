extends VBoxContainer
## WO-1097 — "Send the fronts to the desk" in Follow → Output (owner 16.11: "send this as an unused artnet/sacn universe
## for ld's show and let him programm highascg take over of fronts under a fader"). Edits project.fixtures.feed
## (desk_feed_model.gd) through follow_section.gd; the server (src/fixtures/desk-feed.js) sends it. Status line =
## GET /api/tracking/follow `feed`; the LD's channel table = GET /api/tracking/follow/feed.csv (copied to the clipboard).

const M := preload("res://features/previs/tracking/desk_feed_model.gd")
const HelpDialog := preload("res://app/help_dialog.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal edited(feed: Dictionary)  # a new project.fixtures.feed

var feed := M.normalize({})
var _on: CheckBox
var _form: GridContainer
var _proto: OptionButton
var _uni: SpinBox
var _dest: LineEdit
var _prio: SpinBox
var _layout: OptionButton
var _addr: SpinBox
var _csv: Button
var _status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_on = CheckBox.new()
	_on.text = "Send the fronts to the lighting desk"
	_on.tooltip_text = ("The fronts' final pan / tilt / dimmer (tracking, calibration, Auto, handover) on a spare universe.\n" +
		"The desk merges it and the LD takes the fronts over under a fader. Independent of the Output switch.")
	_on.toggled.connect(func(on: bool) -> void: _emit("enabled", on))
	add_child(HelpDialog.beside(_on, "desk-feed-magicq"))
	_form = GridContainer.new()
	_form.columns = 2
	add_child(_form)
	_proto = _options(M.PROTOCOLS, func(i: int) -> void: _emit("protocol", M.PROTOCOLS[i][0]))
	_pair("Feed protocol", _proto)
	_uni = _spin(0, M.SACN_UNIVERSE_MAX, func(v: float) -> void: _emit("universe", int(v)))
	_uni.tooltip_text = "A universe the desk's show does not output. Mirror: one per rig universe, from this one up."
	_pair("Feed universe", _uni)
	_dest = LineEdit.new()
	_dest.placeholder_text = "desk ip[:port]"
	_dest.text_submitted.connect(func(v: String) -> void: _emit("dest", v.strip_edges()))
	_dest.focus_exited.connect(func() -> void: _emit("dest", _dest.text.strip_edges()))
	_pair("Desk address", _dest)
	_prio = _spin(1, 200, func(v: float) -> void: _emit("priority", int(v)))
	_pair("sACN priority", _prio)
	_layout = _options(M.LAYOUTS, func(i: int) -> void: _emit("layout", M.LAYOUTS[i][0]))
	_pair("Layout", _layout)
	_addr = _spin(1, 512, func(v: float) -> void: _emit("address", int(v)))
	_pair("First channel", _addr)
	_csv = Button.new()
	_csv.text = "Copy channel table (CSV)"
	_csv.tooltip_text = "The LD's patch list for the feed, from the live patch — also at http://<this box>:4200" + M.CSV_PATH
	_csv.pressed.connect(_copy_csv)
	add_child(_csv)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	show_feed(feed)


## Fields ← the project's settings (no signals; a field being typed in is left alone).
func show_feed(f: Variant) -> void:
	feed = M.normalize(f)
	if _on == null:
		return
	_on.set_pressed_no_signal(feed.enabled)
	var sacn: bool = feed.protocol == "sacn"
	_proto.select(1 if sacn else 0)
	_uni.min_value = 1 if sacn else 0
	_uni.max_value = M.SACN_UNIVERSE_MAX if sacn else M.PORT_ADDRESS_MAX
	_put(_uni, feed.universe)
	if not _dest.has_focus():
		_dest.text = str(feed.dest)
	_dest.placeholder_text = "desk ip  (empty = the universe's multicast group)" if sacn else "desk ip[:port]  (never a broadcast)"
	_put(_prio, feed.priority)
	_layout.select(1 if feed.layout == "compact" else 0)
	_put(_addr, feed.address)
	_row_visible(_prio, sacn)
	_row_visible(_addr, feed.layout == "compact")


## The server's view (GET /api/tracking/follow `feed`).
func show_status(st: Variant) -> void:
	if _status != null:
		_status.text = M.status_text(st)


func _copy_csv() -> void:
	var api: Variant = get_node_or_null("/root/Api")  # an autoload, named at runtime: the test runner compiles this without it
	if api == null:
		return
	var res: Dictionary = await api.get_bytes(M.CSV_PATH)
	if res.get("ok") == true:
		DisplayServer.clipboard_set((res.bytes as PackedByteArray).get_string_from_utf8())
		_csv.text = "Channel table copied"
	else:
		_csv.text = "Channel table: %s" % str(res.get("error", "failed"))


func _emit(key: String, v: Variant) -> void:
	if feed.get(key) == v:
		return
	var f := feed.duplicate(true)
	f[key] = v
	feed = M.normalize(f)
	edited.emit(feed)


func _put(sb: SpinBox, v: float) -> void:
	if not sb.get_line_edit().has_focus():
		sb.set_value_no_signal(v)


func _row_visible(c: Control, on: bool) -> void:
	c.visible = on
	(c.get_meta("label") as Control).visible = on


func _spin(lo: float, hi: float, cb: Callable) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = 1
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
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_form.add_child(l)
	c.set_meta("label", l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_form.add_child(c)
