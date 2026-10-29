extends VBoxContainer
## WO-806 — the Program audio footer section (web audio-mixer-panel.js, the owner's "compact audio mixer"), under
## Timers at the bottom of the Inspector on every tab. Masters (one column per PGM / PRV bus, one bar per bus channel,
## dense past 4 channels — WO-227), then one dense row per audio layer, grouped per program channel (live inputs
## first): S / M / ■, routing toggles, level bar, fader, dB. The data and every write go through audio_console_ctl.gd,
## the Audio tab's own client, so a move here shows on the tab and back. Meters tick only while open and on screen.
## Open / closed is remembered for this session (owner 29.10). The body is height-capped and scrolls.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const AM := preload("res://features/audio/audio_meter_model.gd")
const AA := preload("res://features/audio/audio_actions.gd")
const DM := preload("res://features/audio/audio_dock_model.gd")
const Ctl := preload("res://features/audio/audio_console_ctl.gd")
const Row := preload("res://features/audio/audio_dock_row.gd")
const Master := preload("res://features/audio/audio_dock_master.gd")
const MAX_H := 320.0
const EMPTY := "No program audio playing."

static var session_open := false

var osc: Node  # shell's OscMirror (meters)
var ctl := Ctl.new()
var _rows: Array = []
var _sig := ""
var _smooth := {}  # meter key → smoothed 0…1
var _tick_acc := 0.0
var _toggle: Button
var _scroll: ScrollContainer
var _body: VBoxContainer
var _masters: HFlowContainer
var _inputs: VBoxContainer
var _status: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	_toggle = Button.new()
	_toggle.flat = true
	_toggle.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_toggle.tooltip_text = "Program audio — master and layer faders (the full console is the Audio tab)"
	_toggle.pressed.connect(func() -> void: set_open(not _scroll.visible))
	add_child(_toggle)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	_body = VBoxContainer.new()
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_theme_constant_override("separation", 4)
	_body.minimum_size_changed.connect(_fit)
	_scroll.add_child(_body)
	_body.add_child(_title("Masters"))
	_masters = HFlowContainer.new()
	_masters.add_theme_constant_override("h_separation", 6)
	_masters.add_theme_constant_override("v_separation", 6)
	_body.add_child(_masters)
	_body.add_child(_title("Inputs"))
	_inputs = VBoxContainer.new()
	_inputs.add_theme_constant_override("separation", 3)
	_body.add_child(_inputs)
	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_status.custom_minimum_size.x = 200
	_status.add_theme_color_override("font_color", ThemeBuilder.ERROR)
	_status.visible = false
	_body.add_child(_status)
	ctl.changed.connect(_refresh)
	ctl.status.connect(func(t: String) -> void:
		_status.text = t
		_status.visible = t != "")
	Store.changed.connect(func(path: String, value: Variant) -> void:
		if ctl.on_store(path, value):  # keeps the mixer / routing state even while closed
			_refresh())
	Store.project_changed.connect(func(_p: Dictionary) -> void: _refresh())
	Settings.changed.connect(_refresh)
	Settings.loaded.connect(_refresh)
	set_open(session_open)


func set_open(open: bool) -> void:
	session_open = open
	_scroll.visible = open
	_toggle.text = ("▾ " if open else "▸ ") + "Program audio"
	if open:
		_sig = ""
		_refresh()
		ctl.fetch()  # refreshes again when the reads land


func is_open() -> bool:
	return _scroll.visible


func _fit() -> void:
	_scroll.custom_minimum_size.y = minf(_body.get_combined_minimum_size().y, MAX_H)


static func _title(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 11)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _refresh() -> void:
	if not is_open() or not is_visible_in_tree():
		return
	var st := ctl.state()
	var cm: Dictionary = st.channelMap
	var progs := Ctl.programs(cm)
	_rows = ctl.rows(st)
	var s := DM.shape(_rows, func(r: Dictionary) -> int: return AR.bus_channel_count(Settings.settings, cm, r.ch), progs)
	if s != _sig:
		_sig = s
		rebuild(_rows, progs, func(r: Dictionary) -> int: return AR.bus_channel_count(Settings.settings, cm, r.ch))
		ctl.fetch_plan(_rows)
	var solos := ctl.solos()
	for r in _rows:
		var strip: Variant = ctl.strips.get(r.key)
		if strip == null:
			continue
		strip.row = r
		ctl.metas[r.key] = AR.meter_meta(r)
		if not ctl.pending(r.key):
			strip.set_gain(float(r.get("v", 1.0)))
		strip.set_solo(solos.has(r.key))
		if strip is Row:
			strip.set_muted(r.get("muted", false) == true)
			strip.set_routing(AA.routing_entry(ctl.routing, r))
			strip.set_screens(AA.cross_screen_buttons(ctl.xplan, r), AA.cross_screen_targets(r))


## Builds the masters and the rows (headless-testable: `bars_of(row)` = the master's bus channel count).
func rebuild(rows: Array, progs: Array, bars_of: Callable) -> void:
	for c in _masters.get_children() + _inputs.get_children():
		c.get_parent().remove_child(c)
		c.queue_free()
	ctl.clear()
	_smooth.clear()
	for r in DM.masters(rows):
		var m := Master.new()
		m.setup(r, int(bars_of.call(r)))
		ctl.bind(m, r)
		_masters.add_child(m)
	for g in DM.groups(rows, progs):
		var h := _title(g.title)
		_inputs.add_child(h)
		for r in g.rows:
			var row := Row.new()
			row.setup(r, g.dense, progs)
			ctl.bind(row, r)
			_inputs.add_child(row)
	if _inputs.get_child_count() == 0:
		var e := _title(EMPTY)
		_inputs.add_child(e)


func _process(delta: float) -> void:
	if not is_open() or not is_visible_in_tree():
		return
	ctl.flush()
	_tick_acc += delta
	if _tick_acc < AM.TICK_S:
		return
	_tick_acc = 0.0
	var ctx := {"osc": osc.channels if osc else {}, "info": Store.get_value("channels"), "live": Store.get_value("scene.live"),
		"vars": Store.get_value("variables")}
	for key in ctl.strips:
		var s: Variant = ctl.strips[key]
		if s is Master:  # one meter per program bus channel
			for i in (s as Master).meter.levels.size():
				var b := "%s:bus:%d" % [key, i]
				var r := AM.read_key(ctx, b, {})
				(s as Master).meter.set_bar(i, _smoothed(b, r.level), AM.colour(r.level))
		else:
			var r := AM.read_key(ctx, key, ctl.metas.get(key, {}))
			(s as Row).level.set_level(_smoothed(key, r.level), AM.colour(r.level))
			if r.state != "":
				(s as Row).set_input_state(r.state)


func _smoothed(key: String, level: float) -> float:
	var v := AM.smooth(_smooth.get(key, 0.0), level)
	_smooth[key] = v
	return v
