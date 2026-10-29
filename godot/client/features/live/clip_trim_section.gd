extends VBoxContainer
## WO-813 — the look layer's clip Trim (owner 29.10): a collapsible section under "Clip start point"; trim works under
## both start options (the "Custom" option it first lived under is gone). `header` ("▸ Trim", which layer_inspector.gd
## puts in its grid's label column) folds it, and it is folded again whenever the inspector shows another layer / clip
## or comes back into view (nothing saved). Folded: one row, "Full clip" or "in – out". Open (compact): [Trim in] in
## [Trim out] out on one row, the slider in one thin row below. A button press stores the slider position as the
## layer's trimInMs / trimOutMs (WO-570 fields: the take seeks to the in point and ends at the out point); Ctrl+click
## (Cmd+click), right-click or the small ↺ beside it resets that point to the clip's start / end (null = no trim); the
## fields take a typed m:ss.ff or seconds. The web twin is client/components/inspector-clip-trim.js.
## Dragging the slider moves the look's PRV copy like the timeline ruler does: POST /api/scene/layer-scrub through the
## timeline's paced scrub gate (WO-790), one request in flight here and the newest position next (WO-787
## timeline_transport.gd `seek`). PGM is never sought. Scrub / refusal notes go to `status` and the slider tooltip.

signal patch(p: Dictionary)
signal status(text: String)

const T := preload("res://features/live/clip_trim_model.gd")
const M := preload("res://features/live/media_math.gd")
const X := preload("res://features/live/mixer_math.gd")
const TimelineMedia := preload("res://features/timeline/timeline_media.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const RESET_TIP_IN := "Ctrl+click or ↺ to reset to the clip's start"
const RESET_TIP_OUT := "Ctrl+click or ↺ to reset to the clip's end"

var header := Button.new()  # the grid's label cell: "▸ Trim" / "▾ Trim"
var _media := TimelineMedia.new()
var _scene_id := ""
var _main := 0
var _layer: Dictionary = {}
var _key := ""
var _placed := ""  # the key the slider was put on the in point for
var _syncing := false
var _dur_ms := 0.0
var _fps := 25.0
var _loading := false
var _shown := false
var _busy := false
var _next := -1.0
var _note := ""
var _summary: Label
var _body: VBoxContainer
var _slider: HSlider
var _pos: Label
var _in_btn: Button
var _out_btn: Button
var _in_edit: LineEdit
var _out_edit: LineEdit


func _init() -> void:
	header.flat = true
	header.alignment = HORIZONTAL_ALIGNMENT_LEFT
	header.tooltip_text = "Trim in / out of this clip"
	header.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	for s in ["normal", "hover", "pressed", "hover_pressed"]:  # no padding: the text lines up with the grid labels
		header.add_theme_stylebox_override(s, StyleBoxEmpty.new())
	header.pressed.connect(func() -> void: set_open(not _body.visible))


func _ready() -> void:
	add_theme_constant_override("separation", 0)
	_summary = Label.new()
	_summary.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_summary.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	add_child(_summary)
	_body = VBoxContainer.new()
	_body.add_theme_constant_override("separation", 0)
	add_child(_body)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 4)
	_in_btn = _button(row, "Trim in", "Set In to the slider position\n" + RESET_TIP_IN, true)
	_in_edit = _field(row, true)
	_reset_btn(row, true)
	_out_btn = _button(row, "Trim out", "Set Out to the slider position\n" + RESET_TIP_OUT, false)
	_out_edit = _field(row, false)
	_reset_btn(row, false)
	_body.add_child(row)
	var srow := HBoxContainer.new()
	_slider = HSlider.new()
	_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_slider.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	_slider.tooltip_text = "Scrub the clip (moves it on PRV when this look is there)"
	_slider.value_changed.connect(_on_slide)
	srow.add_child(_slider)
	_pos = Label.new()
	_pos.add_theme_font_size_override("font_size", 12)
	_pos.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	srow.add_child(_pos)
	_body.add_child(srow)
	set_open(false)


func _notification(what: int) -> void:
	if what == NOTIFICATION_ENTER_TREE and _body != null:
		set_open(false)  # the Inspector adopted the page again
	elif what == NOTIFICATION_VISIBILITY_CHANGED and _body != null:
		var now := is_visible_in_tree()
		if now and not _shown:
			set_open(false)  # the inspector shows a layer again → folded (owner 29.10: default collapsed)
		_shown = now


func is_open() -> bool:
	return _body != null and _body.visible


func set_open(open: bool) -> void:
	header.text = ("▾ " if open else "▸ ") + "Trim"
	if _body == null:
		return
	_body.visible = open
	_summary.visible = not open
	_refresh()


## The inspector selected nothing: the next layer shown starts folded even when it is the same one.
func forget() -> void:
	_key = ""


func show_layer(scene_id: String, main_idx: int, layer: Dictionary) -> void:
	_scene_id = scene_id
	_main = main_idx
	_layer = layer
	var src: Dictionary = layer.get("source", {}) if layer.get("source") is Dictionary else {}
	var key := "%s|%s|%s" % [scene_id, layer.get("layerNumber", ""), src.get("value", "")]
	if key != _key:
		_key = key
		_dur_ms = 0.0
		_note = ""
		var value := str(src.get("value", ""))
		var clip := str(src.get("type", "media")) in ["media", "file", ""] and X.supports_loop(value, str(src.get("type", "media")))
		_set_row_visible(clip)  # templates, routes, stills: nothing to trim
		set_open(false)
		_loading = clip
		if clip:
			_load_duration(key, value)
	_refresh()


func _set_row_visible(on: bool) -> void:
	visible = on
	header.visible = on


func _load_duration(key: String, value: String) -> void:
	var row: Dictionary = await _media.row(value)
	var ms := float(row.get("durationMs", 0)) if row.get("durationMs") != null else 0.0
	var fps := float(row.get("fps", 0)) if row.get("fps") != null else 0.0
	if ms <= 0.0:
		var r: Dictionary = await Api.post_json("/api/media/cinf", {"id": value})
		if r.ok and r.data is Dictionary:
			ms = float(r.data.get("durationMs", 0))
	if key != _key:
		return
	_dur_ms = ms
	_fps = T.fps_or_default(fps)
	_loading = false
	_refresh()
	if Config.args.has("probe-trim"):  # dev (WO-813): --probe-trim[=open|<ms>] opens it (and scrubs PRV once), prints sizes
		_probe(str(Config.args["probe-trim"]))


func _refresh() -> void:
	if _body == null:
		return
	var known := _dur_ms > 0.0
	var tc := func(ms: float) -> String: return M.format_timecode(ms / 1000.0, _fps)
	_summary.text = "…" if _loading else (T.summary(_layer, _dur_ms, _fps) if known else "Clip length unknown")
	_slider.editable = known
	_in_edit.editable = known
	_out_edit.editable = known
	_in_btn.disabled = not known
	_out_btn.disabled = not known
	if not known:
		_pos.text = "--:--.--"
		_in_edit.text = ""
		_out_edit.text = ""
		return
	_syncing = true  # a lower max clamps the value and would emit value_changed → a scrub nobody asked for
	_slider.max_value = _dur_ms
	_slider.step = T.frame_to_ms(1, _fps)
	if _placed != _key:
		_placed = _key
		_slider.set_value_no_signal(T.in_ms(_layer))
	_syncing = false
	_pos.text = tc.call(_slider.value)
	var pt := T.points(_layer, _dur_ms)
	if not _in_edit.has_focus():
		_in_edit.text = tc.call(pt.x)
	if not _out_edit.has_focus():
		_out_edit.text = tc.call(pt.y)


func _probe(arg: String) -> void:
	if arg != "closed":
		set_open(true)
		if arg.is_valid_float() and float(arg) > 0.0:
			_slider.value = float(arg)
	await get_tree().process_frame
	await get_tree().process_frame
	print("[probe-trim] open=%s header=%s section=%s" % [is_open(), header.size, size])


func _on_slide(v: float) -> void:
	if _syncing:
		return
	_pos.text = M.format_timecode(v / 1000.0, _fps)
	if _busy:
		_next = v
		return
	_scrub(v)


## One request in flight; the newest position waits and goes when it returns (WO-787 / WO-790).
func _scrub(ms: float) -> void:
	_busy = true
	var layer_no := int(_layer.get("layerNumber", 0))
	var res: Dictionary = await Api.post_json("/api/scene/layer-scrub", {"sceneId": _scene_id, "mainIdx": _main, "layerNumber": layer_no, "ms": int(round(ms))})
	_busy = false
	var note := T.scrub_note(res.data) if res.ok and res.data is Dictionary else "Scrub failed: %s" % res.error
	_slider.tooltip_text = note
	if note != _note:
		_note = note
		status.emit(note)
	if _next >= 0.0:
		var n := _next
		_next = -1.0
		_scrub(n)


func _apply(r: Dictionary) -> void:
	if not r.ok:
		status.emit(str(r.error))
		_refresh()
		return
	patch.emit(r.patch)


func _trim(is_in: bool) -> void:
	_apply(T.set_in(_layer, _slider.value, _dur_ms, _fps) if is_in else T.set_out(_layer, _slider.value, _dur_ms, _fps))


func _reset(is_in: bool) -> void:
	_apply(T.reset_in(_layer, _fps) if is_in else T.reset_out(_layer, _dur_ms, _fps))


## A typed point (m:ss.ff or seconds) on Enter / leaving the field; garbage or an unchanged text keeps the point.
func _commit(is_in: bool) -> void:
	var e := _in_edit if is_in else _out_edit
	var pt := T.points(_layer, _dur_ms)
	if _dur_ms <= 0.0 or e.text == M.format_timecode((pt.x if is_in else pt.y) / 1000.0, _fps):
		return
	var ms := T.parse_tc(e.text, _fps)
	if not is_nan(ms):
		_apply(T.set_in(_layer, ms, _dur_ms, _fps) if is_in else T.set_out(_layer, ms, _dur_ms, _fps))
	pt = T.points(_layer, _dur_ms)  # what is stored now (the patch re-showed the layer), so a focus-out after Enter is a no-op
	e.text = M.format_timecode((pt.x if is_in else pt.y) / 1000.0, _fps)


func _button(parent: Control, text: String, tip: String, is_in: bool) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.pressed.connect(func() -> void: _trim(is_in))
	b.gui_input.connect(func(e: InputEvent) -> void:  # Ctrl / Cmd+click or right-click: the clip's start / end (owner 29.10)
		if T.is_reset_click(e):
			b.accept_event()  # before the Button sees the press → no "set to the slider" as well
			_reset(is_in))
	parent.add_child(b)
	return b


## The small ↺ beside a point: the same _reset as Ctrl+click (owner 29.10: right-click does not work in the web client).
func _reset_btn(parent: Control, is_in: bool) -> Button:
	var b := Button.new()
	b.text = "↺"
	b.flat = true
	b.focus_mode = Control.FOCUS_NONE
	b.tooltip_text = RESET_TIP_IN if is_in else RESET_TIP_OUT
	b.pressed.connect(func() -> void: _reset(is_in))
	parent.add_child(b)  # enabled with the length unknown too: a reset needs no length
	return b


func _field(parent: Control, is_in: bool) -> LineEdit:
	var e := LineEdit.new()
	e.custom_minimum_size.x = 72
	e.alignment = HORIZONTAL_ALIGNMENT_CENTER
	e.tooltip_text = "%s point — type m:ss.ff or seconds" % ("In" if is_in else "Out")
	e.text_submitted.connect(func(_t: String) -> void: _commit(is_in))
	e.focus_exited.connect(func() -> void: _commit(is_in))
	parent.add_child(e)
	return e
