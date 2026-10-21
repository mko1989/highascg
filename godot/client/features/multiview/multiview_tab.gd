extends VBoxContainer
## WO-600 M — the Multiview tab (web client/components/multiview-editor.js toolbar + state wiring). Multiviewer 1's
## layout is the project's `multiview` slice (autosaved like every other show edit, so a web editor on the same show
## sees it); multiviewers 2+ and the four preset slots stay on this machine (ui.cfg — the web keeps them in the
## browser). Edits apply through POST /api/multiview/apply (the server composes every AMCP line, directive D):
## right away after a drag / drop / menu edit, 800 ms after a toggle, only when Auto-apply is on — the style
## settings (timers under labels, timer size, highlight, BG) always apply, like the web. Click a cell = audio focus
## (POST /api/multiview/audio-focus). Without a multiview destination the canvas says so and nothing is sent.

const L := preload("res://features/multiview/mv_layout.gd")
const D := preload("res://features/multiview/mv_doc.gd")
const MvCanvas := preload("res://features/multiview/mv_canvas.gd")
const UI_CFG := "user://ui.cfg"
const APPLY_DEBOUNCE_S := 0.8

var st: Dictionary = D.empty()
var index := 1
var canvas: MvCanvas
var _cm: Dictionary = {}
var _bar: HBoxContainer
var _pick: OptionButton
var _checks := {}  # state key -> CheckBox
var _scale: SpinBox
var _bg: ColorPickerButton
var _presets: Array = []
var _say: Label
var _timer: Timer
var _applying := false
var _apply_again := false
var _quiet := false  # set while the toolbar is filled from state (no edit signals)


func _ready() -> void:
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	_bar = HBoxContainer.new()
	add_child(_bar)
	_pick = OptionButton.new()
	_pick.item_selected.connect(func(i: int) -> void: switch_to(i + 1))
	_bar.add_child(_pick)
	_button("Refresh output", refresh_output, "Re-apply every multiview layout (e.g. after a CasparCG restart)")
	_check("autoApply", "Auto-apply", false)
	_check("showOverlay", "Borders", false)
	_check("showTimersUnderLabels", "Timers under labels", true)
	var tl := Label.new()
	tl.text = "Timer size %"
	_bar.add_child(tl)
	_scale = SpinBox.new()
	_scale.min_value = 50
	_scale.max_value = 300
	_scale.value_changed.connect(func(v: float) -> void: _edit("timerScale", v, true))
	_bar.add_child(_scale)
	_check("highlightTopTimer", "Highlight top timer", true)
	_bg = ColorPickerButton.new()
	_bg.text = "BG"
	_bg.edit_alpha = false
	_bg.custom_minimum_size.x = 48
	_bg.popup_closed.connect(func() -> void: _edit("bgColor", "#" + _bg.color.to_html(false), true))
	_bar.add_child(_bg)
	var pl := Label.new()
	pl.text = "  Presets"
	_bar.add_child(pl)
	for i in 4:
		var b := _button(str(i + 1), _preset_click.bind(i), "Empty: click saves the layout here. Stored: click recalls it. Right-click: save over / clear.")
		b.gui_input.connect(_preset_input.bind(i))
		_presets.append(b)
	_say = Label.new()
	_say.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_say.clip_text = true
	_say.add_theme_color_override("font_color", Color("#f0b429"))
	_bar.add_child(_say)
	canvas = MvCanvas.new()
	canvas.size_flags_vertical = Control.SIZE_EXPAND_FILL
	canvas.st = st
	canvas.edited.connect(func(_now: bool) -> void: persist(true, true))
	canvas.audio_focus.connect(audio_focus)
	canvas.notice.connect(say)
	add_child(canvas)
	_timer = Timer.new()
	_timer.one_shot = true
	_timer.wait_time = APPLY_DEBOUNCE_S
	_timer.timeout.connect(apply_now)
	add_child(_timer)
	Store.project_changed.connect(func(_p: Dictionary) -> void: reload())
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path.begins_with("channelMap"):
			_on_channel_map())
	_on_channel_map()
	reload()


func _button(text: String, cb: Callable, tip := "") -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(cb)
	_bar.add_child(b)
	return b


func _check(key: String, text: String, style: bool) -> void:
	var c := CheckBox.new()
	c.text = text
	c.toggled.connect(func(on: bool) -> void: _edit(key, on, style))
	_bar.add_child(c)
	_checks[key] = c


func say(text: String) -> void:
	_say.text = text
	_say.tooltip_text = text


func enabled() -> bool:
	return _cm.get("multiviewEnabled") != false and mv_channel() != null


func mv_channel() -> Variant:
	var chs := D.mv_channels(_cm)
	return chs[index - 1] if index - 1 < chs.size() else null


func _on_channel_map() -> void:
	var v: Variant = Store.get_value("channelMap", {})
	_cm = v if v is Dictionary else {}
	var chs := D.mv_channels(_cm)
	_pick.clear()
	for i in chs.size():
		_pick.add_item("Multiview %d (Ch %s)" % [i + 1, str(chs[i])])
	_pick.visible = chs.size() > 1
	if chs.size() > 1:
		_pick.select(clampi(index - 1, 0, chs.size() - 1))
	canvas.cm = _cm
	canvas.mv_ch = mv_channel() if _cm.get("multiviewEnabled") != false else null
	canvas.hold_video()
	_sync_canvas_size()
	canvas.queue_redraw()


## web syncMultiviewCanvasFromChannelMap → setCanvasSize: rescale so the applied layout is unchanged.
func _sync_canvas_size() -> void:
	var want := D.canvas_size(_cm)
	if want == Vector2.ZERO or (want.x == float(st.canvasWidth) and want.y == float(st.canvasHeight)):
		return
	var wh := L.rescale(st.cells, float(st.canvasWidth), float(st.canvasHeight), want.x, want.y)
	st.canvasWidth = wh[0]
	st.canvasHeight = wh[1]
	persist(false, false)


## (Re)read the stored layout of the current multiviewer — skipped mid-drag (the echo of our own edit).
func reload() -> void:
	if not canvas._drag.is_empty():
		return
	var data: Variant = Store.project.get("multiview") if index == 1 else _cfg().get_value("multiview", "layout_%d" % index, {})
	var next: Variant = D.load(data, _cm)
	var focus: Variant = st.get("audioActiveCellId")
	st.clear()
	st.merge(next if next != null else D.empty())
	if st.audioActiveCellId == null:
		st.audioActiveCellId = focus
	_sync_canvas_size()
	_fill_toolbar()
	canvas.queue_redraw()


func switch_to(n: int) -> void:
	if n == index:
		return
	index = n
	canvas.selected_id = ""
	reload()
	_on_channel_map()


func _fill_toolbar() -> void:
	_quiet = true
	for k in _checks:
		_checks[k].button_pressed = bool(st[k])
	_scale.value = float(st.timerScale)
	_bg.color = Color.from_string(str(st.bgColor), Color.BLACK)
	var slots := D.slots(_cfg().get_value("multiview", "presets_%d" % index, []))
	for i in 4:
		_presets[i].modulate = Color("#7ee787") if slots[i] != null else Color.WHITE
	_quiet = false


func _edit(key: String, v: Variant, style: bool) -> void:
	if _quiet:
		return
	st[key] = L.timer_scale(v) if key == "timerScale" else v
	canvas.queue_redraw()
	if key == "autoApply":
		persist(false, false)
	elif style:
		persist(false, false)
		apply_now()
	else:
		persist(true, false)


## Store the layout (project slice for multiviewer 1, ui.cfg otherwise) and apply it when Auto-apply is on:
## `now` = flush (drag end / drop / menu), else the 800 ms debounce.
func persist(apply: bool, now: bool) -> void:
	if index == 1:
		if Store.project.is_empty():
			return
		Store.project["multiview"] = D.export(st)
		ProjectSync.mark_dirty()
	else:
		var cfg := _cfg()
		cfg.set_value("multiview", "layout_%d" % index, D.snapshot(st))
		cfg.save(UI_CFG)
	if apply and st.autoApply and enabled():
		if now:
			_timer.stop()
			apply_now()
		else:
			_timer.start()


func apply_now() -> void:
	if not enabled():
		return
	var body: Variant = L.apply_body(index, D.export(st))
	if body == null:
		return
	if _applying:
		_apply_again = true
		return
	_applying = true
	var res: Dictionary = await Api.post_json("/api/multiview/apply", body)
	_applying = false
	say("" if res.ok else "Apply failed: %s" % str(res.get("error", res.get("status"))))
	if _apply_again:
		_apply_again = false
		apply_now()


func refresh_output() -> void:
	var chs := D.mv_channels(_cm)
	if chs.is_empty():
		say("No multiview channel configured.")
		return
	var ok := 0
	var bad := 0
	for n in range(1, chs.size() + 1):
		var data: Variant = D.export(st) if n == index else (Store.project.get("multiview") if n == 1 else _cfg().get_value("multiview", "layout_%d" % n, {}))
		var body: Variant = L.apply_body(n, data) if data is Dictionary else null
		if body == null:
			continue
		var res: Dictionary = await Api.post_json("/api/multiview/apply", body)
		if res.ok:
			ok += 1
		else:
			bad += 1
	say("No multiview layout to apply yet." if ok + bad == 0 else "Multiview refresh: %d applied, %d failed." % [ok, bad] if bad > 0 \
		else "Multiview output refreshed (%d layout%s)." % [ok, "" if ok == 1 else "s"])


func audio_focus(id: String) -> void:
	st.audioActiveCellId = id
	persist(false, false)
	canvas.queue_redraw()
	if not enabled():
		return
	var res: Dictionary = await Api.post_json("/api/multiview/audio-focus", {"n": index, "cellId": id})
	say("" if res.ok else "Audio focus: %s" % str(res.get("error", res.get("status"))))


func _cfg() -> ConfigFile:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	return cfg


func _preset_click(i: int) -> void:
	var slots := D.slots(_cfg().get_value("multiview", "presets_%d" % index, []))
	if slots[i] == null:
		_save_preset(i)
	else:
		var next: Variant = D.load(slots[i], _cm, st)
		if next != null:
			st.clear()
			st.merge(next)
			_sync_canvas_size()
			_fill_toolbar()
			canvas.selected_id = ""
			canvas.queue_redraw()
			persist(true, true)
			say("Preset %d recalled." % (i + 1))


func _save_preset(i: int) -> void:
	var cfg := _cfg()
	var slots := D.slots(cfg.get_value("multiview", "presets_%d" % index, []))
	slots[i] = D.snapshot(st)
	cfg.set_value("multiview", "presets_%d" % index, slots)
	cfg.save(UI_CFG)
	_fill_toolbar()
	say("Layout saved to preset %d." % (i + 1))


func _preset_input(e: InputEvent, i: int) -> void:
	var mb := e as InputEventMouseButton
	if mb == null or not mb.pressed or mb.button_index != MOUSE_BUTTON_RIGHT:
		return
	var pm := PopupMenu.new()
	pm.add_item("Save layout here", 0)
	pm.add_item("Clear preset", 1)
	pm.id_pressed.connect(func(id: int) -> void:
		if id == 0:
			_save_preset(i)
		else:
			var cfg := _cfg()
			var slots := D.slots(cfg.get_value("multiview", "presets_%d" % index, []))
			slots[i] = null
			cfg.set_value("multiview", "presets_%d" % index, slots)
			cfg.save(UI_CFG)
			_fill_toolbar())
	pm.popup_hide.connect(pm.queue_free)
	add_child(pm)
	var at := Vector2i(get_viewport().get_mouse_position())
	if not get_viewport().gui_embed_subwindows:
		at += get_window().position
	pm.popup(Rect2i(at, Vector2i.ZERO))
