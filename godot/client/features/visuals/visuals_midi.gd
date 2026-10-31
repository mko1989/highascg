extends Node
## WO-900 — MIDI control of the Visuals (owner 31.10: an Akai APC40 mkII). A control moved on the controller drives the page's
## own slider or button the way a click or drag does — through the control's value / signals — so it autosaves, edits the live
## deck in place and recalls looks exactly like the UI. Sliders are picked up (midi_pickup.gd): a fader does nothing until it
## reaches the slider's value; while it waits, the slider shows where the fader is (midi_ghost.gd) and the MIDI line says
## where to bring it. Learn / Unmap / the APC40 map / pad lights: midi_panel.gd on the page. The mapping is this client's
## (ui.cfg [midi]): the controller is plugged into this machine, not into the show. Inputs and hot-plug: midi_input.gd.

const MidiMap := preload("res://features/midi/midi_map.gd")
const Pickup := preload("res://features/midi/midi_pickup.gd")
const MidiInput := preload("res://features/midi/midi_input.gd")
const Leds := preload("res://features/midi/midi_leds.gd")
const Out := preload("res://features/midi/midi_out.gd")
const Ghost := preload("res://features/midi/midi_ghost.gd")
const MidiPanel := preload("res://features/midi/midi_panel.gd")
const UiCfg := preload("res://core/ui_cfg.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const Auto := preload("res://features/visuals/visuals_autopilot.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const Apc := preload("res://features/visuals/visuals_midi_apc.gd")
const SECTION := "midi"

var tab: Node
var panel: MidiPanel
var map := []  ## the bindings (midi_map.gd)
var pick := {}  ## source key → pickup state (midi_pickup.gd)
var mode := ""  ## "", "learn" or "unmap"
var learned := {}  ## Learn: the control moved, waiting for the target click
var note := ""
var waiting := false  # `note` is about a control that has not picked its slider up
var cfg_path := ""  ## where the mapping is kept ("" = nowhere: the test runner)
var inputs: MidiInput
var why_off := ""
var leds := false  ## APC40 pad lights (Ableton mode + the lights from the bindings)
var out := Out.new()
var apc := false  ## an APC40 is plugged in: its control names in the texts
var _lit := {}  # the lights as last sent
var _cc_last := {}  # source key → last CC value: a CC on a button target presses on its rising edge
var _ghosts := {}  # target → its Ghost
var _auto_back := 2  # Auto switched on from a button goes back to this item (8 bars)
var apc_view: Apc  # WO-909: the Controller mode (the APC40 drawn) and the device-knob auto page
var _hello_until := 0  # msec: until then CCs are the APC's position report (_hello)


## `persist`: keep the mapping in ui.cfg (false under the test runner, which shares user://).
func _init(t: Node, persist := false) -> void:
	tab = t
	cfg_path = UiCfg.PATH if persist else ""
	panel = tab.page.midi_panel
	panel.ctl = self
	panel.learn_toggled.connect(func(on: bool) -> void: _set_mode("learn" if on else ""))
	panel.unmap_toggled.connect(func(on: bool) -> void: _set_mode("unmap" if on else ""))
	panel.menu_picked.connect(_menu)
	apc_view = Apc.new(self)
	add_child(apc_view)
	if tab.work != null:
		tab.work.add_mode("controller", "Controller", apc_view.surface, Apc.HINT)
	_load()
	inputs = MidiInput.new()
	inputs.devices_changed.connect(_devices)
	add_child(inputs)
	var timer := Timer.new()
	timer.wait_time = 0.1
	timer.autostart = true
	timer.timeout.connect(tick)
	add_child(timer)
	_show()


## Opens the controller's inputs — not in a probe client (`--probe-midi=<dir>` feeds its own events; `…:real` opens them).
func _ready() -> void:
	var cfg: Node = tab._g("Config")
	var probe := str(cfg.args.get("probe-midi", "")) if cfg else ""
	why_off = "MIDI inputs stay closed in a probe client" if cfg == null or (probe != "" and not probe.ends_with(":real")) else inputs.start()
	_show()


func _input(event: InputEvent) -> void:
	if event is InputEventMIDI:
		handle(event)


func handle(e: InputEventMIDI) -> void:
	var msg := MidiMap.decode(e)
	if msg.is_empty():
		return
	apc_view.surface.touch(msg)
	if mode != "":
		if msg.kind != "off":
			_captured(msg)
		return
	var hello := Time.get_ticks_msec() < _hello_until  # the APC reporting its faders: positions, not moves
	var b := MidiMap.find(map, msg)
	if b.is_empty():
		if msg.kind != "off" and not hello:
			_say("%s — not mapped (Learn maps it)" % _name(msg))
		return
	var c := control_of(b.target)
	if c == null:
		if msg.kind != "off" and not hello:
			_say("%s → %s: not there" % [_name(msg), MidiMap.target_label(b.target)])
		return
	if MidiMap.is_range(b.target):
		_move(b, msg, c as Range, hello)
	elif not hello:
		_button(b, msg, c)


func _move(b: Dictionary, msg: Dictionary, c: Range, hello := false) -> void:
	if msg.kind != "cc" or c == null or not c.editable:
		return
	var k := MidiMap.key(b)
	if not pick.has(k):
		pick[k] = Pickup.new_state()
	var st: Dictionary = pick[k]
	if hello:
		Pickup.seen(st, msg.val / 127.0, c.ratio)
		_ghost(b.target, st, c)
		return
	var v := Pickup.turn(st, msg.val / 127.0, c.ratio) if _encoder(b) else Pickup.move(st, msg.val / 127.0, c.ratio)
	if v >= 0.0:
		var before := c.value
		c.ratio = v  # value_changed: the same path as a drag
		if not c.is_inside_tree() and c.value != before:
			c.value_changed.emit(c.value)  # a Range emits only inside the tree: the page before the Inspector first shows it
		Pickup.took(st, c.ratio)
	_ghost(b.target, st, c)
	var label := "%s → %s" % [_name(msg), MidiMap.target_label(b.target)]
	if Pickup.waiting(st):
		_say("%s waits: it is at %d %%, bring it to %s" % [label, roundi(msg.val / 1.27), _value_text(b.target, c)], true)
	else:
		_say("%s %s" % [label, _value_text(b.target, c)])


func _button(b: Dictionary, msg: Dictionary, c: Control) -> void:
	var press: bool = msg.kind == "note"
	if msg.kind == "cc":
		var k := MidiMap.key(b)
		press = msg.val >= 64 and int(_cc_last.get(k, 0)) < 64
		_cc_last[k] = msg.val
	if not press or (c is BaseButton and (c as BaseButton).disabled):
		return
	match b.target.get_slice(":", 0):
		"mute", "blackout":
			(c as BaseButton).button_pressed = not (c as BaseButton).button_pressed  # toggled: as a click
		"tap":
			(c as BaseButton).button_down.emit()  # the Tap button taps on the press
		"auto":
			_auto(c as OptionButton)
		"select":
			apc_view.select(b.target)
		_:
			(c as BaseButton).pressed.emit()
	_say("%s → %s" % [_name(msg), MidiMap.target_label(b.target)])


## Auto from a button: off ↔ the last running choice (8 bars at first).
func _auto(ob: OptionButton) -> void:
	var to := 0
	if ob.selected > 0:
		_auto_back = ob.selected
	else:
		to = _auto_back if _auto_back < ob.item_count else Auto.BARS.find(8)
	ob.select(to)
	ob.item_selected.emit(to)


## A target id → the page's control (null when it is not there: layer 5 of a 3-layer stack, look 9 of 4).
func control_of(target: String) -> Control:
	var p := target.split(":")
	var n := int(p[1]) - 1 if p.size() > 1 else -1
	match p[0]:
		"layer", "mute":
			var rows: Array = tab.page.layer_list.rows
			if n < 0 or n >= rows.size():
				return null
			return rows[n].slider if p[0] == "layer" else rows[n].eye
		"param", "burst":
			return tab.page.control(target)
		"look":
			return tab.page.show_panel.look_button(n)
		"xfade", "take", "cut":  # WO-908: only while A/B is on
			return tab.dj.control(p[0])
		"dev", "select":  # WO-909: the device knob page, the layer rows
			return apc_view.control_of(target)
	return tab.page.show_panel.control(target)


## Every target Learn / Unmap can click.
static func targets() -> Array:
	var out_ := ["master", "fade", "burst", "tap", "audio", "blackout", "auto", "xfade", "take", "cut"]
	for p in M.PARAMS:
		out_.append("param:" + p)
	for i in 8:
		out_.append_array(["layer:%d" % (i + 1), "mute:%d" % (i + 1)])
	for i in Looks.MAX:
		out_.append("look:%d" % (i + 1))
	return out_


func wants_click() -> bool:
	return mode == "unmap" or (mode == "learn" and not learned.is_empty())


## A click at `pos` (canvas coordinates) while Learn / Unmap waits: true when it hit a target (the click is used up).
func click_at(pos: Vector2) -> bool:
	for id in targets():
		var c := control_of(id)
		if c != null and c.is_visible_in_tree() and c.get_global_rect().has_point(pos):
			pick_target(id)
			return true
	return false


## Learn: the moved control now drives `target`. Unmap: `target` loses its mappings.
func pick_target(target: String) -> void:
	if mode == "unmap":
		map = MidiMap.unbind_target(map, target)
		_saved()
		_set_mode("")
		_say("%s: unmapped" % MidiMap.target_label(target))
	elif mode == "learn" and not learned.is_empty():
		if MidiMap.is_range(target) and learned.kind != "cc":
			_say("%s is a pad or button: click a button (a look, Burst, Tap, …) — a slider wants a fader or knob" % _name(learned))
			return
		var src := learned
		map = MidiMap.learn(map, src, target)
		pick.erase(MidiMap.key(map.back()))
		_saved()
		_set_mode("")
		_say("%s → %s" % [_name(src), MidiMap.target_label(target)])


func _captured(msg: Dictionary) -> void:
	if mode == "unmap":
		var had := not MidiMap.find(map, msg).is_empty()
		map = MidiMap.unbind_source(map, msg)
		_saved()
		_set_mode("")
		_say(("%s: unmapped" if had else "%s was not mapped") % _name(msg))
		return
	learned = msg
	_say("%s — now click the slider or button it should drive" % _name(msg))


func _set_mode(m: String) -> void:
	mode = m
	learned = {}
	match m:
		"learn":
			_say("Move a fader, knob or pad on the controller…")
		"unmap":
			_say("Move a control, or click a slider or button, to remove its mapping")
		_:
			_show()


func _menu(id: int) -> void:
	match id:
		MidiPanel.MENU_APC:
			map = MidiMap.apc40()
			pick.clear()
			_saved()
			_say("APC40 mkII map: %d controls" % map.size())
		MidiPanel.MENU_CLEAR:
			map = []
			pick.clear()
			_saved()
			_say("No MIDI mappings — Learn adds one")
		MidiPanel.MENU_LEDS:
			leds = not leds
			if cfg_path != "":
				UiCfg.save_value(SECTION, "leds", leds, cfg_path)
			_leds_changed()
			_show()


## Every 0.1 s: a slider moved from elsewhere puts its fader back to waiting (and shows the tick); the lights follow.
func tick() -> void:
	for b in map:
		var k := MidiMap.key(b)
		if pick.has(k) and not _encoder(b):  # an encoder is never waiting (WO-912)
			var c := control_of(b.target) as Range
			if c != null:
				Pickup.observe(pick[k], c.ratio)
				_ghost(b.target, pick[k], c)
	if out.port != "":  # the knob rings always (WO-912: the APC then turns on from the app's value); the pad lights when on
		var f := Leds.frame(map, led_state)
		if not leds:
			f = Leds.rings(f)
		out.send(Leds.diff(_lit, f))
		_lit = f
	out.pump()
	if leds and out.error != "" and note != out.error:
		_say(out.error)
	if _hello_until > 0 and Time.get_ticks_msec() >= _hello_until:
		_hello_until = 0
		var n := pick.values().filter(func(st: Dictionary) -> bool: return Pickup.waiting(st)).size()
		_say("Controller ready — %d fader%s wait%s: bring each to its amber tick" % [n, "" if n == 1 else "s", "s" if n == 1 else ""]
			if n > 0 else "Controller ready — every fader is at its slider", n > 0)


## A target's light: OFF..ALERT for a button, its value 0..127 for a slider (an APC knob's ring).
func led_state(target: String) -> int:
	var c := control_of(target)
	if MidiMap.is_range(target):
		return roundi((c as Range).ratio * 127.0) if c != null else 0
	match target.get_slice(":", 0):
		"look":
			var i := int(target.get_slice(":", 1)) - 1
			return Leds.OFF if i >= tab.show_ctl.looks.size() else (Leds.ON if i == tab.show_ctl.showing else Leds.AVAIL)
		"mute":
			return Leds.OFF if c == null else (Leds.ON if (c as BaseButton).button_pressed else Leds.ALERT)
		"blackout":
			return Leds.ALERT if tab.mixer.blackout else Leds.AVAIL
		"select":
			return Leds.OFF if c == null else (Leds.ON if int(target.get_slice(":", 1)) - 1 == tab.sel else Leds.AVAIL)
		"auto":
			return Leds.ON if c != null and (c as OptionButton).selected > 0 else Leds.AVAIL
		"audio":
			return Leds.ON if c != null and (c as BaseButton).button_pressed else Leds.AVAIL
	return Leds.AVAIL


func _leds_changed() -> void:
	_lit = {}
	if out.port == "":
		return
	if leds:
		out.send(Leds.SYSEX_ABLETON)  # the lights are the host's from here; the next tick sends them all
	else:
		out.send(Leds.diff(_lit, {}))
		_hello()


## An APC40 came (or its port changed): find its port, say hello.
func _port(listing: String) -> void:
	out.port = Leds.port_of(listing)
	_lit = {}
	if out.port != "":
		_hello()
		if leds:
			out.send(Leds.SYSEX_ABLETON)


## The Generic-mode Introduction (its power-on mode, so nothing changes on it): the APC answers with every fader's position
## (CC 7 × 8, master, crossfader — measured 31.10), so the sliders show where the faders are before anyone touches them.
func _hello() -> void:
	out.send(Leds.SYSEX_GENERIC)
	_hello_until = Time.get_ticks_msec() + 1500


func _encoder(b: Dictionary) -> bool:
	return apc and b.kind == "cc" and Leds.ring(int(b.num))


func _devices(names: PackedStringArray) -> void:
	apc = Array(names).any(func(n: String) -> bool: return n.findn("APC40") >= 0)
	if apc:
		out.list_ports(_port)
	else:
		out.port = ""
	_show()


func _ghost(target: String, st: Dictionary, c: Range) -> void:
	var g: Variant = _ghosts.get(target)
	if g != null and (not is_instance_valid(g) or (g as Node).get_parent() != c):
		if is_instance_valid(g):
			(g as Node).queue_free()
		g = null
		_ghosts.erase(target)
	if Pickup.waiting(st):
		if g == null:
			g = Ghost.new()
			c.add_child(g)
			_ghosts[target] = g
		g.at = float(st.hw)
	elif g != null:
		(g as Node).queue_free()
		_ghosts.erase(target)


func _value_text(target: String, c: Range) -> String:
	return "%.1f s" % c.value if target == "fade" else "%d %%" % roundi(c.ratio * 100.0)


func _name(msg: Dictionary) -> String:
	return MidiMap.describe(msg, apc)


func _say(text: String, wait := false) -> void:
	note = text
	waiting = wait
	_show()


func _load() -> void:
	var c := ConfigFile.new()
	if cfg_path == "" or c.load(cfg_path) != OK or not c.has_section_key(SECTION, "map"):
		map = MidiMap.apc40()
	else:
		map = MidiMap.normalize(c.get_value(SECTION, "map"))
	leds = cfg_path != "" and c.get_value(SECTION, "leds", false) == true


func _saved() -> void:
	if cfg_path != "":
		UiCfg.save_value(SECTION, "map", map, cfg_path)


func _show() -> void:
	var dev := why_off if why_off != "" else ("No MIDI controller — plug one in" if inputs == null or inputs.names.is_empty()
		else ", ".join(inputs.names))
	if why_off == "" and inputs != null and inputs.held_elsewhere():
		dev += " (another program reads a plugged-in controller: one reader at a time)"
	var tip := "\n".join(map.map(func(b: Dictionary) -> String: return "%s → %s" % [_name(b), MidiMap.target_label(b.target)]))
	panel.set_state("%s · %d mapped" % [dev, map.size()], tip, note, mode, leds, waiting)
