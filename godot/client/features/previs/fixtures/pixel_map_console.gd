extends VBoxContainer
## WO-916 — the pixel map window's "Console" rows: the mapped pixels' colours go to the lighting console all the time
## (colour only, independent of this box's DMX master; the LD decides what reaches the fixtures). Send on / off,
## Art-Net or sACN, the console's address, the fixtures' own universes or an own block from a first universe, and the
## rate the server samples + sends at. Part of GET / POST /api/fixtures/pixelmap/settings (`console`, `rate_hz`); the
## window saves it with the smoothing. The status line comes from /live (`console`).

const RATE_MAX := 60
const PROTOCOLS := ["artnet", "sacn"]
const LAYOUTS := ["fixture", "block"]

signal edited

var dirty := false
var _send: CheckBox
var _protocol: OptionButton
var _dest: LineEdit
var _layout: OptionButton
var _universe: SpinBox
var _rate: SpinBox
var _status: Label


func _init() -> void:
	add_theme_constant_override("separation", 4)
	var a := HBoxContainer.new()
	a.add_theme_constant_override("separation", 8)
	var title := Label.new()
	title.text = "Console"
	title.tooltip_text = "The mapped pixels' colours, sent to the lighting console all the time (colour only; dimmer, white and whether it reaches the fixtures stay with the LD). Independent of the DMX output switch."
	a.add_child(title)
	_send = CheckBox.new()
	_send.text = "Send"
	_send.tooltip_text = "Send the pixel colours to the console"
	_send.toggled.connect(func(_on: bool) -> void: _changed())
	a.add_child(_send)
	_protocol = OptionButton.new()
	_protocol.add_item("Art-Net")
	_protocol.add_item("sACN")
	_protocol.tooltip_text = "Art-Net needs the console's address; sACN without one goes out as multicast"
	_protocol.item_selected.connect(func(_i: int) -> void: _changed())
	a.add_child(_protocol)
	_dest = LineEdit.new()
	_dest.placeholder_text = "console IP"
	_dest.custom_minimum_size.x = 150
	_dest.select_all_on_focus = true  # RULES.md 1
	_dest.tooltip_text = "The console's IPv4 address (a.b.c.d, or a.b.c.d:port). Unicast — an Art-Net broadcast would land on this box's own lighting input."
	_dest.text_changed.connect(func(_t: String) -> void: _changed())
	a.add_child(_dest)
	add_child(a)
	var b := HBoxContainer.new()
	b.add_theme_constant_override("separation", 8)
	_layout = OptionButton.new()
	_layout.add_item("Fixture universes")
	_layout.add_item("Own block")
	_layout.tooltip_text = "Fixture universes: each pixel at its fixture's own universe and channels (the console merges them in). Own block: R G B per pixel, 170 per universe, from the first universe on (the pixel list in /live tells which is which)."
	_layout.item_selected.connect(func(_i: int) -> void: _changed())
	b.add_child(_layout)
	var ul := Label.new()
	ul.text = "From universe"
	b.add_child(ul)
	_universe = _spin(0, 32767, "The block's first universe (Art-Net port-address, or sACN universe from 1)")
	b.add_child(_universe)
	var rl := Label.new()
	rl.text = "Rate Hz"
	b.add_child(rl)
	_rate = _spin(0, RATE_MAX, "How often the picture is sampled and sent (25 = every 2nd frame of a 50 fps channel; 0 = every frame, costs more)")
	b.add_child(_rate)
	_status = Label.new()
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.clip_text = true
	b.add_child(_status)
	add_child(b)


func _spin(lo: int, hi: int, tip: String) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.step = 1
	s.rounded = true
	s.select_all_on_focus = true  # RULES.md 1; SpinBox evaluates + - * / on commit (RULES.md 2)
	s.tooltip_text = tip
	s.value_changed.connect(func(_v: float) -> void: _changed())
	return s


func _changed() -> void:
	_universe.editable = _layout.selected == 1
	dirty = true
	edited.emit()


## The settings reply ({ok, settings} or the settings) → the fields; a clean state afterwards.
func show_settings(data: Variant) -> void:
	var s := settings_from(data)
	var c: Dictionary = s.console
	_send.set_pressed_no_signal(bool(c.enabled))
	_protocol.select(PROTOCOLS.find(c.protocol))
	_dest.text = str(c.dest)
	_layout.select(LAYOUTS.find(c.layout))
	_universe.set_value_no_signal(int(c.universe))
	_universe.editable = c.layout == "block"
	_rate.set_value_no_signal(int(s.rate_hz))
	dirty = false


## What Save posts: {rate_hz, console}.
func body() -> Dictionary:
	return {"rate_hz": int(_rate.value), "console": {"enabled": _send.button_pressed, "protocol": PROTOCOLS[maxi(0, _protocol.selected)],
		"dest": _dest.text.strip_edges(), "layout": LAYOUTS[maxi(0, _layout.selected)], "universe": int(_universe.value)}}


## GET /api/fixtures/pixelmap/live → the status line.
func show_live(live: Variant) -> void:
	_status.text = status_line(live)


## The server's settings → {rate_hz, console} with its defaults for anything missing (25 Hz, on, Art-Net, fixture universes).
static func settings_from(data: Variant) -> Dictionary:
	var src: Variant = (data as Dictionary).get("settings", data) if data is Dictionary else {}
	var s: Dictionary = src if src is Dictionary else {}
	var c: Dictionary = s.get("console") if s.get("console") is Dictionary else {}
	var rate: Variant = s.get("rate_hz")
	var uni: Variant = c.get("universe")
	return {"rate_hz": clampi(int(rate), 0, RATE_MAX) if rate is float or rate is int else 25,
		"console": {"enabled": c.get("enabled") != false, "protocol": c.protocol if PROTOCOLS.has(c.get("protocol")) else "artnet",
			"dest": str(c.get("dest", "")) if c.get("dest") is String else "", "layout": c.layout if LAYOUTS.has(c.get("layout")) else "fixture",
			"universe": int(uni) if uni is float or uni is int else 1}}


## "→ 10.0.0.5:6454 · 6 universe(s) · 1234 packets", or why nothing goes out.
static func status_line(live: Variant) -> String:
	var c: Variant = (live as Dictionary).get("console") if live is Dictionary else null
	if not (c is Dictionary):
		return ""
	if c.get("enabled") == false:
		return "not sending"
	var unis: Array = c.get("universes") if c.get("universes") is Array else []
	if unis.is_empty():
		return "nothing mapped to send"
	var bad := unis.filter(func(u: Variant) -> bool: return u is Dictionary and u.get("problem") != null)
	if bad.size() == unis.size():
		return "not sending: %s" % str(bad[0].problem)
	var dest := str(unis.filter(func(u: Variant) -> bool: return u is Dictionary and u.get("problem") == null)[0].get("dest", ""))
	return "→ %s · %d universe(s) · %d packets%s" % [dest, unis.size() - bad.size(), int(c.get("packets", 0)),
		"" if bad.is_empty() else " · %d not sent: %s" % [bad.size(), str(bad[0].problem)]]
