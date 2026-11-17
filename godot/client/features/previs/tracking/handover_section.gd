extends VBoxContainer
## WO-1085 — the Auto follow "spot handover" settings in the Follow section (owner 15.11: "the lone presenter is lit by
## the 3 heads and the rest is off … other heads 'take over' when his crossing a threshold"). Edits
## project.fixtures.handover (handover_model.gd) through follow_section.gd; the server engine
## (src/fixtures/follow-handover.js) does the rest. The status line comes from GET /api/tracking/follow `handover`.

const H := preload("res://features/previs/tracking/handover_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

signal edited(handover: Dictionary)  # a new project.fixtures.handover

var handover := H.normalize({})
var _mode: OptionButton
var _form: GridContainer
var _heads: SpinBox
var _margin: SpinBox
var _fade: SpinBox
var _idle: OptionButton
var _lv_on: CheckBox
var _lv_proto: OptionButton
var _lv_uni: SpinBox
var _lv_addr: SpinBox
var _lv_dest: LineEdit
var _gr_on: CheckBox
var _gr_uni: SpinBox
var _gr_addr: SpinBox
var _gr_per: CheckBox
var _status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_mode = _options(H.MODES, func(i: int) -> void: _emit("mode", H.MODES[i][0]))
	_mode.tooltip_text = ("Auto heads: Split = every head follows (shared between people).\n" +
		"Spot handover = the N nearest heads per person are lit, the rest dark; others take over past a threshold.")
	add_child(_mode)
	_form = GridContainer.new()
	_form.columns = 2
	add_child(_form)
	_heads = _spin(1, 16, 1, func(v: float) -> void: _emit("heads", int(v)))
	_pair("Heads per person", _heads)
	_margin = _spin(0, 5, 0.05, func(v: float) -> void: _emit("margin_m", v))
	_margin.tooltip_text = "A new head takes over only when it is this much nearer — standing on a threshold never flickers."
	_pair("Threshold margin m", _margin)
	_fade = _spin(0, 10, 0.1, func(v: float) -> void: _emit("fade_s", v))
	_pair("Take-over fade s", _fade)
	_idle = _options(H.IDLE, func(i: int) -> void: _emit("idle", H.IDLE[i][0]))
	_pair("Nobody tracked", _idle)
	_lv_on = _check("Send head levels to the console", func(on: bool) -> void: _emit_in("levels", "enabled", on))
	_lv_on.tooltip_text = ("One channel per Auto head (patch order) = its spot level 0–255, then 'someone followed', A1…A9, Pin 1…9.\n" +
		"For PSN: patch them on the console (DMX remote → executor faders). Sent while Output is ON.")
	_pair("Automation levels", _lv_on)
	_lv_proto = _options([["artnet", "Art-Net"], ["sacn", "sACN"]], func(i: int) -> void:
		_emit_in("levels", "protocol", "artnet" if i == 0 else "sacn"))
	_pair("Levels protocol", _lv_proto)
	_lv_uni = _spin(0, H.SACN_UNIVERSE_MAX, 1, func(v: float) -> void: _emit_in("levels", "universe", int(v)))
	_pair("Levels universe", _lv_uni)
	_lv_addr = _spin(1, 512, 1, func(v: float) -> void: _emit_in("levels", "address", int(v)))
	_pair("Levels address", _lv_addr)
	_lv_dest = LineEdit.new()
	_lv_dest.placeholder_text = "console ip[:port]  (empty = broadcast / multicast)"
	_lv_dest.text_submitted.connect(func(v: String) -> void: _emit_in("levels", "dest", v.strip_edges()))
	_lv_dest.focus_exited.connect(func() -> void: _emit_in("levels", "dest", _lv_dest.text.strip_edges()))
	_pair("Levels destination", _lv_dest)
	_gr_on = _check("LD grant channel", func(on: bool) -> void: _emit_in("grant", "enabled", on))
	_gr_on.tooltip_text = ("A channel the console sends to this box (Art-Net). PSN + levels: the head levels are scaled by it —\n" +
		"one desk fader cross-fades the automation in and out. Own DMX with read-through: ≥ 50 % = HighAsCG drives the\n" +
		"spot heads, < 50 % = the console's values pass through. Console silent for 7.5 s = levels fade to 0 / heads go back.")
	_pair("Grant", _gr_on)
	_gr_uni = _spin(0, H.PORT_ADDRESS_MAX, 1, func(v: float) -> void: _emit_in("grant", "universe", int(v)))
	_pair("Grant universe (console)", _gr_uni)
	_gr_addr = _spin(1, 512, 1, func(v: float) -> void: _emit_in("grant", "address", int(v)))
	_pair("Grant address", _gr_addr)
	_gr_per = _check("one channel per head", func(on: bool) -> void: _emit_in("grant", "per_head", on))
	_pair("Grant per head", _gr_per)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_status)
	show_handover(handover)


## Fields ← the project's settings (no signals; a field being typed in is left alone).
func show_handover(h: Dictionary) -> void:
	handover = H.normalize(h)
	if _mode == null:
		return
	var on: bool = handover.mode == "handover"
	_mode.select(0 if not on else 1)
	for c: Control in [_heads, _margin, _fade, _idle]:  # Split: only the levels universe and the grant
		_row_visible(c, on)
	_put(_heads, handover.heads)
	_put(_margin, handover.margin_m)
	_put(_fade, handover.fade_s)
	_idle.select(0 if handover.idle == "home" else 1)
	var lv: Dictionary = handover.levels
	_lv_on.set_pressed_no_signal(lv.enabled)
	_lv_proto.select(0 if lv.protocol == "artnet" else 1)
	_lv_uni.min_value = 1 if lv.protocol == "sacn" else 0
	_lv_uni.max_value = H.SACN_UNIVERSE_MAX if lv.protocol == "sacn" else H.PORT_ADDRESS_MAX
	_put(_lv_uni, lv.universe)
	_put(_lv_addr, lv.address)
	if not _lv_dest.has_focus():
		_lv_dest.text = str(lv.dest)
	for c: Control in [_lv_proto, _lv_uni, _lv_addr, _lv_dest]:
		_row_visible(c, lv.enabled)
	var g: Dictionary = handover.grant
	_gr_on.set_pressed_no_signal(g.enabled)
	_put(_gr_uni, g.universe)
	_put(_gr_addr, g.address)
	_gr_per.set_pressed_no_signal(g.per_head)
	for c: Control in [_gr_uni, _gr_addr, _gr_per]:
		_row_visible(c, g.enabled)


## The server's view (GET /api/tracking/follow `handover`).
func show_status(st: Variant) -> void:
	if _status != null:
		_status.text = H.status_text(st)


func _emit(key: String, v: Variant) -> void:
	if handover.get(key) == v:
		return
	var h := handover.duplicate(true)
	h[key] = v
	handover = H.normalize(h)
	edited.emit(handover)


func _emit_in(part: String, key: String, v: Variant) -> void:
	if handover[part].get(key) == v:
		return
	var h := handover.duplicate(true)
	h[part][key] = v
	handover = H.normalize(h)
	edited.emit(handover)


func _put(sb: SpinBox, v: float) -> void:
	if not sb.get_line_edit().has_focus():
		sb.set_value_no_signal(v)


func _row_visible(c: Control, on: bool) -> void:
	c.visible = on
	(c.get_meta("label") as Control).visible = on


func _spin(lo: float, hi: float, step: float, cb: Callable) -> SpinBox:
	var sb := SpinBox.new()
	sb.min_value = lo
	sb.max_value = hi
	sb.step = step
	# WO-1106 B16: a typed value applies on Enter / focus-out only — per keystroke, typing "200" sent live DMX on
	# universe 2, then 20 (a desk's real show universe). Arrows / wheel still step at once.
	sb.update_on_text_changed = false
	sb.value_changed.connect(cb)
	return sb


func _check(text: String, cb: Callable) -> CheckBox:
	var cb2 := CheckBox.new()
	cb2.text = text
	cb2.toggled.connect(cb)
	return cb2


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
