extends VBoxContainer
## WO-602 slice 5 — the flag page for the global Inspector (web inspector-panel-timeline-flag.js, same order):
## "Timeline flag", Position (SMPTE / ++500 / plain ms), Flag → Label, Action; for Jump to: a time (hh:mm:ss:ms,
## optional) or another flag; for a Companion button press: the bound button's preview (live — it follows
## `companion.buttonPreview`), the preview status, Location ("page row column"), Page / Row / Column and Test press;
## then Remove flag. Edits mutate the flag (timeline_flags.gd) and emit `changed`; the tab saves and syncs.
## Not here yet: the web's "Choose button…" picker modal (a modal port, WO-608) — typing the location does the same.

signal changed
signal remove_requested

const F := preload("res://features/timeline/timeline_flags.gd")
const FD := preload("res://features/timeline/timeline_flag_draw.gd")
const TM := preload("res://features/timeline/timeline_math.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const HINT_JUMP := "For “Jump to”, set a time (hh:mm:ss:ms) or pick another flag; time wins if both are set."

var _tl: Dictionary = {}
var _flag: Dictionary = {}
var _syncing := false
var _pos: LineEdit
var _pos_ms: Label
var _label: LineEdit
var _type: OptionButton
var _jump: Control
var _jump_t: LineEdit
var _jump_f: OptionButton
var _jump_ids: Array = []
var _comp: Control
var _prev: Control
var _status: Label
var _loc: LineEdit
var _crd: Array = []  # page / row / column SpinBoxes


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var title := Label.new()
	title.text = "Timeline flag"
	title.add_theme_font_size_override("font_size", 15)
	add_child(title)
	var g := _grid(self)
	_pos = _line("SMPTE (HH:MM:SS:FF), ++500 / --500 offset, or plain ms", _commit_pos)
	var pr := HBoxContainer.new()
	pr.add_child(_pos)
	_pos_ms = _muted("")
	pr.add_child(_pos_ms)
	_row(g, "Position", pr)
	_head(self, "Flag")
	g = _grid(self)
	_label = _line("", func() -> void:
		if _label.text.strip_edges() != str(_flag.get("label", "")):
			_patch({"label": _label.text.strip_edges()}))
	_row(g, "Label", _label)
	_type = OptionButton.new()
	for l in F.TYPE_LABELS:
		_type.add_item(l)
	_type.item_selected.connect(func(i: int) -> void:
		_patch({"type": F.TYPES[i]})
		refresh()
		if F.TYPES[i] == "companion_press":
			_load_status())
	_row(g, "Action", _type)
	_jump = VBoxContainer.new()
	add_child(_jump)
	g = _grid(_jump)
	_jump_t = _line("HH:MM:SS:mmm, ++500 / --500 offset, or plain ms", _commit_jump)
	_jump_t.placeholder_text = "optional"
	_row(g, "Jump to time", _jump_t)
	_jump_f = OptionButton.new()
	_jump_f.fit_to_longest_item = false
	_jump_f.clip_text = true
	_jump_f.item_selected.connect(func(i: int) -> void: _patch({"jumpFlagId": _jump_ids[i] if _jump_ids[i] != "" else null}))
	_row(g, "Or jump to flag", _jump_f)
	var hint := _muted(HINT_JUMP)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_jump.add_child(hint)
	_build_companion()
	var del := Button.new()
	del.text = "Remove flag"
	del.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	del.pressed.connect(func() -> void: remove_requested.emit())
	add_child(del)


func _build_companion() -> void:
	_comp = VBoxContainer.new()
	add_child(_comp)
	_head(_comp, "Companion Button")
	_prev = Control.new()
	_prev.custom_minimum_size = Vector2(72, 72)
	_prev.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_prev.draw.connect(func() -> void:
		var t: Variant = FD.thumb(F.coords(_flag), _prev) if not _flag.is_empty() else null
		var r := Rect2(Vector2.ZERO, _prev.size)
		if t is Texture2D:
			_prev.draw_texture_rect(t, r, false)
		else:
			_prev.draw_rect(r, Color("#21262d"))
		_prev.draw_rect(r, Color("#30363d"), false, 1.0))
	_comp.add_child(_prev)
	_status = _muted("")
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_comp.add_child(_status)
	var g := _grid(_comp)
	_loc = _line("", func() -> void:
		var c: Variant = F.parse_location(_loc.text)
		if c == null:
			_loc.text = F.fmt_location(F.coords(_flag))
		else:
			_apply_coords(c))
	_loc.placeholder_text = "1 0 2"
	_row(g, "Location (page row column)", _loc)
	for i in 3:
		var s := SpinBox.new()
		s.min_value = 1 if i == 0 else -F.MAX_COORD
		s.max_value = F.MAX_COORD
		s.custom_minimum_size.x = 90
		s.value_changed.connect(func(_v: float) -> void:
			if not _syncing:
				_apply_coords(Vector3i(int(_crd[0].value), int(_crd[1].value), int(_crd[2].value))))
		_crd.append(s)
		_row(g, ["Page (1+)", "Row (0+)", "Column (0+)"][i], s)
	var test := Button.new()
	test.text = "Test press"
	test.tooltip_text = "Send Companion HTTP press (down + release), same as playhead crossing this flag"
	test.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	test.pressed.connect(func() -> void: _test_press(test))
	_comp.add_child(test)


func show_flag(tl: Dictionary, f: Dictionary) -> void:
	var was := _flag
	_tl = tl
	_flag = f
	refresh()
	if not is_same(was, f) and str(f.get("type", "")) == "companion_press":
		_load_status()


## Re-read the flag (after a canvas drag) without emitting.
func refresh() -> void:
	if _flag.is_empty() or _pos == null:
		return
	_syncing = true
	var fps := int(_tl.get("fps", 25))
	var t := float(_flag.get("timeMs", 0))
	if not _pos.has_focus():
		_pos.text = TM.fmt_smpte(t, fps)
	_pos_ms.text = "%d ms" % roundi(t)
	if not _label.has_focus():
		_label.text = str(_flag.get("label", ""))
	var type := str(_flag.get("type", "pause"))
	_type.select(maxi(0, F.TYPES.find(type)))
	_jump.visible = type == "jump"
	_comp.visible = type == "companion_press"
	if not _jump_t.has_focus():
		_jump_t.text = TM.fmt_hms(float(_flag.jumpTimeMs)) if _flag.get("jumpTimeMs") is float or _flag.get("jumpTimeMs") is int else ""
	_jump_f.clear()
	_jump_ids = [""]
	_jump_f.add_item("—")
	for o in F.flags(_tl):
		if o is Dictionary and not is_same(o, _flag):
			_jump_ids.append(str(o.get("id", "")))
			_jump_f.add_item(F.option_text(o))
	_jump_f.select(maxi(0, _jump_ids.find(str(_flag.get("jumpFlagId", "")))))
	var c := F.coords(_flag)
	if not _loc.has_focus():
		_loc.text = F.fmt_location(c)
	for i in 3:
		_crd[i].value = [c.x, c.y, c.z][i]
	_prev.queue_redraw()
	_syncing = false


func _patch(changes: Dictionary) -> void:
	if _syncing or _flag.is_empty():
		return
	F.update(_tl, _flag, changes)
	changed.emit()


func _commit_pos() -> void:
	if _flag.is_empty():
		return
	var t := float(_flag.get("timeMs", 0))
	var dur := float(_tl.get("duration", 999999))
	var v: Variant = TM.parse_tc(_pos.text, t, dur, int(_tl.get("fps", 25)))
	var ms := clampf(float(v), 0.0, dur) if v != null else t
	_pos.text = TM.fmt_smpte(ms, int(_tl.get("fps", 25)))
	if ms != t:
		_patch({"timeMs": ms})
		refresh()


func _commit_jump() -> void:
	if _flag.is_empty():
		return
	if _jump_t.text.strip_edges() == "":
		if _flag.has("jumpTimeMs"):
			_patch({"jumpTimeMs": null})
		return
	var cur := float(_flag.get("jumpTimeMs", 0)) if _flag.get("jumpTimeMs") != null else 0.0
	var v: Variant = F.parse_hms(_jump_t.text, cur, _tl.get("duration", 999999999))
	if v == null:
		_jump_t.text = TM.fmt_hms(float(_flag.jumpTimeMs)) if _flag.get("jumpTimeMs") != null else ""
		return
	_jump_t.text = TM.fmt_hms(v)
	if _flag.get("jumpTimeMs") == null or float(_flag.jumpTimeMs) != float(v):
		_patch({"jumpTimeMs": v})


func _apply_coords(c: Vector3i) -> void:
	_patch({"companionPage": c.x, "companionRow": c.y, "companionColumn": c.z})
	refresh()


func _load_status() -> void:
	_status.text = "Checking Companion preview…"
	var r: Dictionary = await Api.get_json("/api/companion/button-preview/status")
	var st: Dictionary = r.data if r.ok and r.data is Dictionary else {}
	if not r.ok:
		_status.text = "Could not reach HighAsCG Companion preview status."
	elif st.get("previewAvailable") == true:
		_status.text = "Preview via Companion Satellite (Button Subscriptions API)."
	elif str(st.get("hint", "")) != "":
		_status.text = str(st.hint)
	else:
		_status.text = {
			"satellite_disabled": "Companion Satellite is switched off in HighAsCG’s own Companion settings.",
			"subscriptions_disabled": "Satellite is connected. Previews additionally need Button Subscriptions API in Companion Settings — picking and pressing work without it.",
			"satellite_reconnecting": "Companion Satellite reachable — reconnecting; the preview appears shortly.",
		}.get(str(st.get("reason", "")), "Companion button preview unavailable — no answer from Companion Satellite. Pressing still works over the HTTP API.")


func _test_press(b: Button) -> void:
	var c := F.coords(_flag)
	b.disabled = true
	b.text = "Pressing…"
	var r: Dictionary = await Api.post_json("/api/companion/button-preview/test-press", {"page": c.x, "row": c.y, "column": c.z})
	b.disabled = false
	b.text = "Test press"
	if r.ok and r.data is Dictionary and r.data.get("ok") == true:
		_status.text = "Test press sent to %s." % F.fmt_location(c)
	else:
		var d: Dictionary = r.data if r.data is Dictionary else {}
		_status.text = "Test press failed: %s" % (str(d.error) if d.get("error") else ("Companion HTTP %s" % (str(int(d.status)) if d.get("status") is float else str(d.get("status", r.get("error", "error"))))))


func _line(tip: String, commit: Callable) -> LineEdit:
	var l := LineEdit.new()
	l.tooltip_text = tip
	l.custom_minimum_size.x = 130
	l.text_submitted.connect(func(_t: String) -> void: commit.call())
	l.focus_exited.connect(func() -> void: if not _syncing: commit.call())
	return l


func _muted(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _head(parent: Node, text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.ACCENT)
	parent.add_child(l)


func _grid(parent: Node) -> GridContainer:
	var g := GridContainer.new()
	g.columns = 2
	g.add_theme_constant_override("h_separation", 10)
	parent.add_child(g)
	return g


func _row(g: GridContainer, label: String, c: Control) -> void:
	var l := Label.new()
	l.text = label
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	g.add_child(l)
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.add_child(c)
