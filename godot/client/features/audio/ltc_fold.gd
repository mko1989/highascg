extends VBoxContainer
## WO-1092 — LTC timecode in the Audio tab (moved from Settings → Timecode; config keys `ltc.*` unchanged, saved through
## Settings like any settings row, so POST /api/settings restarts the LTC service). One fold: a header that always shows
## the LTC out / in state, and when open the essentials of LTC out (device, channel or pair, time source, start TC,
## level, status) and LTC in; rate, user bits, latency trim and the paused behaviour sit behind "More".
## The header listens to WS `ltc.status`; GET /api/ltc fills in while open and the push is silent (WO-1106 B31).

const Form := preload("res://features/settings/settings_form.gd")
const LM := preload("res://features/settings/ltc_model.gd")
const M := preload("res://features/settings/settings_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Fit := preload("res://features/audio/ltc_fold_fit.gd")  # the fold never widens the window (eyes off screen, 17.11)
const WS_FRESH_MS := 1500  # WO-1106 B31: a WS status younger than this makes the HTTP poll unnecessary

var _head: Button
var _body: HFlowContainer
var _out: Form
var _in: Form
var _status: Label
var _detail: Label
var _share_note: Label
var _devices: Array = []
var _dev_ob: OptionButton
var _dev_items: Array = []
var _ch_ob: OptionButton
var _ch_items: Array = []
var _cards_in: Array = []
var _fetched := false
var _last: Variant = null
var _ws_ms := -100000  # WO-1106 B31: when ltc.status last came over WS
var _fetching := false  # a GET /api/ltc in flight


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_head = Button.new()
	_head.flat = true
	_head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_head.focus_mode = Control.FOCUS_NONE
	_head.tooltip_text = "LTC timecode out and in. Click to open."
	_head.pressed.connect(func() -> void: _open(not _body.visible))
	Fit.head(_head)
	add_child(_head)
	_body = Fit.body()
	_body.visible = false
	add_child(_body)
	_out = Form.new()
	_out.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_child(_out)
	_in = Form.new()
	_in.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_child(_in)
	_build_out(_out)
	_build_in(_in)
	Fit.fit(_body)
	var t := Timer.new()
	t.wait_time = 1.0  # WO-1106 B31: was a 0.25 s HTTP poll on top of the 5 Hz WS push
	t.autostart = true
	t.timeout.connect(_poll)
	add_child(t)
	Ws.on("ltc.status", _on_ws)
	Settings.loaded.connect(_hydrate)
	Settings.changed.connect(_hydrate)
	_show(null)
	_fetch_status()


func _open(on: bool) -> void:
	_body.visible = on
	if on:
		_fetch_lists()
		_hydrate()
	_show(_last)


func _hydrate() -> void:
	if not _body.visible:
		return
	_out.hydrate()
	_in.hydrate()
	_sync_pickers()


func _build_out(f: Form) -> void:
	f.heading("LTC out")
	f.check("Send LTC", "ltc.output.enabled", false)
	_dev_ob = OptionButton.new()
	_dev_ob.item_selected.connect(_pick_device)
	_row(f, "Device", _dev_ob)
	_ch_ob = OptionButton.new()
	_ch_ob.tooltip_text = "One channel, or a pair carrying the same LTC. The other channels of the device stay silent."
	_ch_ob.item_selected.connect(_pick_channel)
	_row(f, "Channel", _ch_ob)
	_share_note = f.note("")
	_share_note.visible = false
	f.option("Time", "ltc.output.source", LM.OUT_SOURCE, "timeline")
	f.text("Start TC (timeline 0 · test)", "ltc.output.offset", "00:00:00:00")
	f.number("Level (dBFS peak)", "ltc.output.volumeDb", -60, 0, -18)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	f.target.add_child(_status)
	_detail = f.note("")
	var more := _more(f)
	f.target = more
	f.option("LTC rate", "ltc.output.fps", LM.OUT_FPS, "timeline")
	f.text("User bits (8 hex)", "ltc.output.userBits", "00000000")
	f.number("Latency trim (ms, + = later)", "ltc.output.latencyMs", -500, 1000, 0)
	f.option("While paused", "ltc.output.whenPaused", LM.WHEN_PAUSED, "silence")
	f.note("Loop wrap and seek re-align the LTC once (one jump); drift is slewed away without a jump. Latency trim lines LTC up " +
		"with picture at the receiver: the device latency is already compensated.")
	f.target = f


func _build_in(f: Form) -> void:
	f.heading("LTC in")
	f.check("Read LTC", "ltc.input.enabled", false)
	var src := f.option("From", "ltc.input.source", [["alsa", "Audio input device"], ["bridge", "Live-audio input slot"]], "alsa")
	var dev := f.group()
	f.target = dev
	_capture_device(f)
	f.target = f
	var slot := f.group()
	f.target = slot
	f.number("Live-audio slot", "ltc.input.slot", 1, 8, 1)
	f.target = f
	f.number("LTC on channel", "ltc.input.channel", 1, 64, 1)
	f.check("Timeline follows LTC (chase)", "ltc.input.chase.enabled", false)
	var more := _more(f)
	f.target = more
	f.option("LTC rate", "ltc.fps", LM.FPS, "25")
	f.number("Channels on the device", "ltc.input.channels", 1, 64, 2)
	f.text("Timeline 0 is at", "ltc.input.chase.offset", "00:00:00:00")
	f.note("A device is opened by LTC alone — a card the live-audio inputs already use (the DM3) is read through its slot.")
	f.target = f
	var sync := func() -> void:
		var bridge := str(Settings.get_setting("ltc.input.source", "alsa")) == "bridge"
		dev.visible = not bridge
		slot.visible = bridge
	src.item_selected.connect(func(_i: int) -> void: sync.call())
	f.on_hydrate(sync)


## A "More" disclosure: a flat toggle and the group it shows.
func _more(f: Form) -> VBoxContainer:
	var b := Button.new()
	b.flat = true
	b.text = "▸ More"
	b.focus_mode = Control.FOCUS_NONE
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	f.target.add_child(b)
	var g := f.group()
	g.visible = false
	b.pressed.connect(func() -> void:
		g.visible = not g.visible
		b.text = ("▾ More" if g.visible else "▸ More"))
	return g


func _row(f: Form, label: String, c: Control) -> void:
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = label
	l.custom_minimum_size.x = Form.LABEL_W
	row.add_child(l)
	row.add_child(c)
	f.target.add_child(row)


## LTC in's capture device: GET /api/audio/alsa-cards?dir=capture (WO-1055), the stable plughw:CARD=… names.
func _capture_device(f: Form) -> void:
	var items := [["", "None"]]
	var ob := f.option("Device", "ltc.input.device", items, "")
	f.on_hydrate(func() -> void:
		var cur := str(Settings.get_setting("ltc.input.device", ""))
		var next := LM.device_items(_cards_in, cur)
		items.clear()
		items.append_array(next)
		ob.clear()
		for it in items:
			ob.add_item(str(it[1]))
		ob.select(maxi(0, LM.index_of(items, cur, _cards_in))))


func _fetch_lists() -> void:
	var r: Dictionary = await Api.get_json("/api/ltc/devices")
	if r.ok and r.data is Dictionary and r.data.get("devices") is Array:
		_devices = r.data.devices
	if not _fetched:
		_fetched = true
		var c: Dictionary = await Api.get_json("/api/audio/alsa-cards?dir=capture")
		if c.ok and c.data is Dictionary and c.data.get("cards") is Array:
			_cards_in = c.data.cards
		_in.hydrate()
	_sync_pickers()


func _sync_pickers() -> void:
	var dev := str(Settings.get_setting("ltc.output.device", ""))
	_dev_items = LM.out_device_items(_devices, dev)
	_dev_ob.clear()
	for it in _dev_items:
		_dev_ob.add_item(str(it[1]))
	_dev_ob.select(maxi(0, LM.index_of(_dev_items, dev)))
	var n := LM.device_channels(_devices, dev, int(Settings.get_setting("ltc.output.channels", 2)))
	_ch_items = LM.channel_items(n)
	var cur := LM.channel_value(int(Settings.get_setting("ltc.output.channel", 1)), Settings.get_setting("ltc.output.pair", false) == true)
	_ch_ob.clear()
	for it in _ch_items:
		_ch_ob.add_item(str(it[1]))
	_ch_ob.select(maxi(0, LM.index_of(_ch_items, cur)))
	var prog := _program_entry(dev)
	_share_note.visible = not prog.is_empty()
	if not prog.is_empty():
		_share_note.text = "Shares the program audio card (%s uses ch 1–%d): LTC gets its own channel, program and LTC never mix. Apply the CasparCG config in Devices once for it to take effect." % [
			str(prog.get("usedBy", ["program"])[0]) if prog.get("usedBy") is Array and not (prog.usedBy as Array).is_empty() else "program", int(prog.get("programChannels", 2))]


func _program_entry(dev: String) -> Dictionary:
	for d in _devices:
		if d is Dictionary and str(d.get("value", "")) == dev and d.get("program") == true:
			return d
	return {}


func _pick_device(i: int) -> void:
	var v := str(_dev_items[i][0])
	var n := LM.device_channels(_devices, v, 2)
	var ch := mini(int(Settings.get_setting("ltc.output.channel", 1)), n)
	Settings.patch({"ltc": {"output": {"device": v, "channels": n, "channel": ch}}})
	_sync_pickers()


func _pick_channel(i: int) -> void:
	var c: Dictionary = LM.parse_channel(str(_ch_items[i][0]))
	Settings.patch({"ltc": {"output": {"channel": c.channel, "pair": c.pair}}})


## WO-1106 B31: the server pushes ltc.status over WS (5 Hz) while a direction is on; HTTP only fills in while that push
## is silent (LTC off, a reconnect), one request at a time — the 0.25 s poll piled up in the Api's 6-slot pool.
func _on_ws(d: Variant) -> void:
	_ws_ms = Time.get_ticks_msec()
	_show(d)


func _poll() -> void:
	if _body.visible and is_visible_in_tree() and Time.get_ticks_msec() - _ws_ms > WS_FRESH_MS:
		_fetch_status()


func _fetch_status() -> void:
	if _fetching:
		return
	_fetching = true
	var r: Dictionary = await Api.get_json("/api/ltc")
	_fetching = false
	if r.ok:
		_show(r.data)


func _show(d: Variant) -> void:
	_last = d
	var line := "LTC — " + LM.status_line(d)
	_head.text = ("▾ " if _body.visible else "▸ ") + line
	var bad := d is Dictionary and d.get("output") is Dictionary and str(d.output.get("state", "")) in ["missing", "busy", "error"]
	var c: Color = ThemeBuilder.WARN if bad else ThemeBuilder.TEXT_MUTED
	for n in ["font_color", "font_hover_color", "font_pressed_color"]:
		_head.add_theme_color_override(n, c)
	if _status:
		_status.text = line
		_detail.text = LM.out_detail(d.get("output") if d is Dictionary else null)
