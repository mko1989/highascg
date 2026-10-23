extends AcceptDialog
## WO-693 — DMX viewer (Previs → Fixtures → "DMX viewer…"): the Art-Net nodes and sACN sources the box sees (Scan =
## ArtPoll on every interface) and one universe's 512 slots live — the network's input (GET /api/dmx-monitor, which
## listens only while this window polls it) or what this box sends there (GET /api/fixtures/dmx/frame). A click on a
## node / source shows its first universe. Never sends DMX.

const D := preload("res://features/previs/fixtures/dmx_monitor_model.gd")
const Grid := preload("res://features/previs/fixtures/dmx_grid.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

const POLL_S := 0.25

var protocol := "artnet"
var view := "in"
var _proto: OptionButton
var _universe: SpinBox
var _view: OptionButton
var _list: ItemList
var _grid: Grid
var _status: Label
var _poll: Timer
var _rows: Array = []
var _busy := false
var _rows_key := ""
var _note := ""  # the Scan result, shown over the status for a few seconds
var _note_until := 0


func _init() -> void:
	title = "DMX viewer — Art-Net / sACN"
	ok_button_text = "Close"
	exclusive = false
	size = Vector2i(1500, 640)
	var body := VBoxContainer.new()
	body.add_theme_constant_override("separation", 8)
	add_child(body)
	var bar := HBoxContainer.new()
	_proto = OptionButton.new()
	_proto.add_item("Art-Net")
	_proto.add_item("sACN")
	_proto.item_selected.connect(func(i: int) -> void:
		protocol = "sacn" if i == 1 else "artnet"
		_universe.min_value = 1 if i == 1 else 0
		_universe.max_value = D.SACN_MAX if i == 1 else D.ARTNET_MAX
		_rows_key = ""
		_tick())
	bar.add_child(_proto)
	_universe = SpinBox.new()
	_universe.max_value = D.ARTNET_MAX
	_universe.prefix = "U"
	_universe.tooltip_text = "Art-Net port-address (net : sub-net : universe as one number) or sACN universe"
	_universe.update_on_text_changed = true
	_universe.value_changed.connect(func(_v: float) -> void: _tick())
	bar.add_child(_universe)
	_view = OptionButton.new()
	_view.add_item("Network input")
	_view.add_item("This box sends")
	_view.tooltip_text = "What arrives from the network, or what this box's fixture DMX output sends on that universe"
	_view.item_selected.connect(func(i: int) -> void:
		view = "out" if i == 1 else "in"
		_tick())
	bar.add_child(_view)
	var scan := Button.new()
	scan.text = "Scan (ArtPoll)"
	scan.tooltip_text = "Ask every Art-Net node on the box's networks to answer"
	scan.pressed.connect(_scan)
	bar.add_child(scan)
	_status = Label.new()
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.clip_text = true
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	bar.add_child(_status)
	body.add_child(bar)
	var split := HSplitContainer.new()
	split.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(split)
	_list = ItemList.new()
	_list.custom_minimum_size = Vector2(380, 420)
	_list.item_selected.connect(_on_row)
	split.add_child(_list)
	_grid = Grid.new()
	split.add_child(_grid)
	_poll = Timer.new()
	_poll.wait_time = POLL_S
	_poll.timeout.connect(_tick)
	add_child(_poll)
	visibility_changed.connect(func() -> void:
		if visible:
			_poll.start()
			_tick()
		else:
			_poll.stop())


func open() -> void:
	popup_centered()


func _tick() -> void:
	if _busy or not visible:
		return
	_busy = true
	var u := D.clamp_universe(protocol, int(_universe.value))
	var res: Dictionary = await Api.get_json(D.query(protocol, u))  # also keeps the server's listener alive
	var shown := res
	if view == "out":
		shown = await Api.get_json("/api/fixtures/dmx/frame?protocol=%s&universe=%d" % [protocol, u])
	_busy = false
	if not visible:
		return
	_grid.set_values(D.values(view, shown))
	_status.text = _note if Time.get_ticks_msec() < _note_until else D.status(view, protocol, u, shown)
	_fill_rows(res.data if res.ok and res.data is Dictionary else {})


func _fill_rows(snap: Dictionary) -> void:
	var rows := D.rows(snap, protocol)
	var key := JSON.stringify(rows.map(func(r: Dictionary) -> String: return r.text))
	if key == _rows_key:
		return
	_rows_key = key
	_rows = rows
	_list.clear()
	for r in rows:
		_list.add_item(r.text)
		_list.set_item_tooltip(_list.item_count - 1, r.tip)
	if rows.is_empty():
		_list.add_item("Nothing heard yet — Scan, or send to this box")
		_list.set_item_disabled(0, true)


func _on_row(i: int) -> void:
	if i < _rows.size() and int(_rows[i].universe) >= 0:
		_universe.value = int(_rows[i].universe)


func _scan() -> void:
	var res: Dictionary = await Api.post_json("/api/dmx-monitor/poll", {})
	if res.ok and res.data is Dictionary:
		_note = "ArtPoll sent to %s — answers appear in the list" % ", ".join(res.data.get("sent", []))
	else:
		_note = "Scan failed: %s" % res.get("error", "?")
	_note_until = Time.get_ticks_msec() + 4000
	_status.text = _note
