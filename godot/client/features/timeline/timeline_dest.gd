extends HBoxContainer
## WO-602 slice 8 — the timeline's second transport row (web timeline-transport.js .tl-tb-dest / .tl-tb-take): Dest
## screen (or All screens), PRV (only when that destination has a preview bus), PGM, the Take group (transition /
## frames / tween / Take → POST /take) and the status text. Every routing change is saved on the timeline and posted
## to the engine at once (web updateSendTo); while a timeline plays the engine's routing wins (timeline.playback).

const S := preload("res://features/timeline/timeline_send_to.gd")
const TransitionRow := preload("res://features/live/transition_row.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var tab: Node  # timeline_tab.gd
var _screen: OptionButton
var _screens: Array = []  # screenIdx per item (null = all)
var _prv: CheckBox
var _pgm: CheckBox
var _row: TransitionRow
var _take := {}  # view.takeTransition — per session, not saved (web)
var _status: Label
var _cm_seen := {}


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	add_child(_label("Dest:"))
	_screen = OptionButton.new()
	_screen.focus_mode = Control.FOCUS_NONE
	_screen.tooltip_text = "Output screen"
	_screen.item_selected.connect(_on_screen)
	add_child(_screen)
	_prv = _check("PRV", "Play to the preview bus", "preview")
	_pgm = _check("PGM", "Play to program", "program")
	add_child(VSeparator.new())
	_row = TransitionRow.new()
	_row.max_frames = 120
	_row.changed.connect(func(t: Dictionary) -> void: _take = t)
	add_child(_row)
	var take := Button.new()
	take.text = "Take"
	take.tooltip_text = "Take to program"
	take.focus_mode = Control.FOCUS_NONE
	take.pressed.connect(take_to_program)
	add_child(take)
	_status = _label("")
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_status.clip_text = true
	add_child(_status)
	Store.changed.connect(func(path: String, _v: Variant) -> void:
		if path == "*" or path == "channelMap":
			_on_channel_map())


func status(text: String) -> void:
	_status.text = text
	_status.tooltip_text = text


## The active timeline's routing → the controls (PGM-only destinations lose PRV, unsaved — web buildTransport).
func refresh() -> void:
	var tl: Dictionary = tab.active()
	var cm := _cm()
	var st := S.coerce(cm, S.normalize(tl.get("sendTo")))
	_screens.clear()
	_screen.clear()
	for o in S.screen_options(cm):
		_screen.add_item(o[0])
		_screens.append(o[1])
	_screen.select(maxi(0, _screens.find(st.screenIdx)))
	_screen.disabled = tl.is_empty()
	_prv.visible = S.prv_available(cm, st)
	_prv.set_pressed_no_signal(st.preview)
	_pgm.set_pressed_no_signal(st.program)
	_prv.disabled = tl.is_empty()
	_pgm.disabled = tl.is_empty()
	if _take.is_empty():
		_take = S.take_default(Settings.get_setting("editorDefaults.transition", {}), S.project_fps({}, cm))
	_row.setup(_take, false)
	if _cm_seen.is_empty():
		_cm_seen = cm.duplicate(true)
	if tab.monitor != null:
		tab.monitor.follow(st)  # WO-788: the picture follows Dest / PRV / PGM


## The routing the controls show (saved on play).
func send_to() -> Dictionary:
	var st := {"preview": _prv.button_pressed and _prv.visible, "program": _pgm.button_pressed,
		"screenIdx": _screens[_screen.selected] if _screen.selected >= 0 and _screen.selected < _screens.size() else 0}
	return S.coerce(_cm(), st)


## timeline.playback / a playing timeline's /state: the engine's routing is saved on that timeline.
func adopt(id: String, raw: Dictionary) -> void:
	for t in tab.root().get("timelines", []):
		if t is Dictionary and str(t.get("id", "")) == id:
			var st := S.normalize(raw)
			if st != S.normalize(t.get("sendTo")):
				t["sendTo"] = st
				ProjectSync.mark_dirty()
			if is_same(t, tab.active()):
				refresh()
			return


## web updateSendTo: coerce, save on the timeline, POST …/sendto (the engine re-routes only the timeline on air).
func update_send_to(st: Dictionary = {}) -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var next := S.coerce(_cm(), st if not st.is_empty() else send_to())
	if next != S.normalize(tl.get("sendTo")):
		tl["sendTo"] = next
		ProjectSync.mark_dirty()
	refresh()
	await Api.post_json("/api/timelines/%s/sendto" % str(tl.id).uri_encode(), next)


## Take: push the timeline, POST /take with the transition (the engine routes it to program and plays), then PGM on /
## PRV off saved and posted.
func take_to_program() -> void:
	var tl: Dictionary = tab.active()
	if tl.is_empty():
		return
	var fo := get_viewport().gui_get_focus_owner()
	if fo != null:
		fo.release_focus()  # a typed frame count commits first (web blur)
	if not await tab.transport.sync_to_server(tl):
		status("Timeline sync to the server failed")
		return
	var st := send_to()
	st["program"] = true
	st["preview"] = false
	var r: Dictionary = await Api.post_json("/api/timelines/%s/take" % str(tl.id).uri_encode(),
		S.take_body(_take, S.project_fps(tl, _cm()), st.screenIdx))
	status("" if r.ok else "Take failed: %s" % r.error)
	await update_send_to(st)


func _on_screen(i: int) -> void:
	if i < 0 or i >= _screens.size():
		return
	var st := send_to()
	st["screenIdx"] = _screens[i]
	update_send_to(st)


## channelMap change (web): re-coerce and re-post the active timeline's routing. Only on a real change — a state
## resync ("*") with the same map posts nothing.
func _on_channel_map() -> void:
	if tab == null or tab.active().is_empty() or _cm() == _cm_seen:
		return
	_cm_seen = _cm().duplicate(true)
	update_send_to(S.coerce(_cm(), S.normalize(tab.active().get("sendTo"))))


func _cm() -> Dictionary:
	var cm: Variant = Store.get_value("channelMap", {})
	return cm if cm is Dictionary else {}


func _label(text: String) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _check(text: String, tip: String, key: String) -> CheckBox:
	var c := CheckBox.new()
	c.text = text
	c.tooltip_text = tip
	c.focus_mode = Control.FOCUS_NONE
	c.toggled.connect(func(on: bool) -> void:
		var st := send_to()
		st[key] = on
		update_send_to(st))
	add_child(c)
	return c
