extends RefCounted
## WO-602 slice 7 — the timeline keyboard (web timeline-editor-inputs.js handleTimelineEditorKeydown), live while the
## Timeline tab is visible: Ctrl+C / Ctrl+V of the selected clip or flag (pasted at the playhead), Delete, Space =
## play / pause, Shift+←/→ = playhead to the previous / next snap point, Alt+←/→ = the selected flag or clip to it,
## ←/→ = the selected clip one frame (or the playhead one frame after a ruler click), i o p s v t = clip keyframes,
## Enter = the current-time field. Deviation (owner call, WO-602 "Behaviours to decide" 1): nothing here fires while
## a text field or a dialog has focus — the web takes Space, Shift+arrows and Ctrl+C / V even from text fields.
## i o p s v t keep the web's "set X then P": they also fire from the Inspector's number fields.

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const K := preload("res://features/timeline/timeline_keyframes.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const N := preload("res://features/timeline/timeline_nav.gd")

var tab: Node  # timeline_tab.gd
var _clip_board := {}  # {li, clip} — a deep copy (the web's clipBoard)
var _flag_board := {}


## True when the key was the timeline's.
func handle(k: InputEventKey) -> bool:
	var tl: Dictionary = tab.active()
	var view: Control = tab.view
	if tl.is_empty():
		return false
	var fo := tab.get_viewport().gui_get_focus_owner()
	if fo != null and fo.get_window() != tab.get_window():
		return false  # a dialog / popup owns the keyboard
	var spin := fo is LineEdit and fo.get_parent() is SpinBox
	var field := fo is TextEdit or fo is LineEdit
	var mod := (k.ctrl_pressed or k.meta_pressed) and not k.alt_pressed
	var code := k.keycode
	var arrow := code == KEY_LEFT or code == KEY_RIGHT
	if k.echo and not arrow:
		return false
	if field and not (spin and not mod and not k.alt_pressed and not k.shift_pressed and _kf_key(code) != ""):
		return false
	if mod and code == KEY_C:
		return _copy(tl)
	if mod and code == KEY_V:
		return _paste(tl)
	if mod:
		return false
	if code in [KEY_DELETE, KEY_BACKSPACE] and (view.sel_id != "" or view.sel_flag != ""):
		view.delete_selected()
		return true
	if code == KEY_SPACE:
		tab.transport.toggle_play()
		return true
	if code in [KEY_ENTER, KEY_KP_ENTER] and not (fo is BaseButton):
		tab.transport.focus_time()
		return true
	if arrow:
		return _arrow(tl, code == KEY_RIGHT, k.shift_pressed, k.alt_pressed)
	var key := _kf_key(code)
	if key == "" or k.alt_pressed or k.shift_pressed or view.sel_id == "":
		return false
	if spin:
		fo.release_focus()  # the SpinBox applies its text first ("set X then P")
	var c := TE.find_clip(tl, view.sel_li, view.sel_id)
	if c.is_empty() or not K.shortcut(c, key, view.playhead_ms, tab.clip_rect(), tab.clip_canvas()):
		return false
	view.queue_redraw()
	tab.kf_commit()
	return true


static func _kf_key(code: int) -> String:
	var key := OS.get_keycode_string(code).to_lower()
	return key if key in ["i", "o", "p", "s", "v", "t"] else ""


func _copy(tl: Dictionary) -> bool:
	var view: Control = tab.view
	var c := TE.find_clip(tl, view.sel_li, view.sel_id) if view.sel_id != "" else {}
	if not c.is_empty():
		_clip_board = {"li": view.sel_li, "clip": c.duplicate(true)}
		_flag_board = {}
		return true
	var f := F.find(tl, view.sel_flag) if view.sel_flag != "" else {}
	if not f.is_empty():
		_flag_board = f.duplicate(true)
		_clip_board = {}
		return true
	return false


func _paste(tl: Dictionary) -> bool:
	var view: Control = tab.view
	var at := roundf(view.playhead_ms)
	if not _clip_board.is_empty():
		var li := N.paste_layer(tl, view.last_layer, int(_clip_board.li))
		var c := N.paste_clip(tl, li, _clip_board.clip, at)
		if c.is_empty():
			return false
		view.select(li, str(c.id))
		tab.commit()
		return true
	if not _flag_board.is_empty():
		var f := F.duplicate_at(tl, _flag_board, at)
		view.select_flag(str(f.id))
		tab.commit()
		return true
	return false


func _arrow(tl: Dictionary, right: bool, shift: bool, alt: bool) -> bool:
	var view: Control = tab.view
	var c := TE.find_clip(tl, view.sel_li, view.sel_id) if view.sel_id != "" else {}
	if shift and not alt:  # playhead → the previous / next snap point
		var pts := N.snap_points(tl, view.playhead_ms)
		var t: Variant = N.next_point(pts, roundf(view.playhead_ms)) if right else N.prev_point(pts, roundf(view.playhead_ms))
		if t != null:
			tab.transport.seek(float(t))
		return true
	if alt and not shift:
		var f := F.find(tl, view.sel_flag) if view.sel_flag != "" else {}
		if not f.is_empty():
			var pts := N.snap_points(tl, view.playhead_ms, "", str(f.id))
			var t: Variant = N.next_point(pts, roundf(float(f.timeMs))) if right else N.prev_point(pts, roundf(float(f.timeMs)))
			if t == null:
				return false
			F.update(tl, f, {"timeMs": clampf(float(t), 0.0, float(tl.get("duration", 0)))})
			tab.commit()
			return true
		if not c.is_empty():
			var pts := N.snap_points(tl, view.playhead_ms, str(c.id))
			var t: Variant = N.next_point(pts, roundf(float(c.startTime))) if right else N.prev_point(pts, roundf(float(c.startTime)))
			if t == null:
				return false
			c["startTime"] = clampf(float(t), 0.0, maxf(0.0, float(tl.get("duration", 0)) - float(c.get("duration", 0))))
			tab.commit()
			return true
		return false
	if shift or alt:
		return false
	if not c.is_empty() and view.last_clicked != "ruler":  # the clip one frame
		var s := float(c.startTime)
		c["startTime"] = minf(float(tl.duration) - float(c.duration), s + N.frame_ms(tl)) if right else maxf(0.0, s - N.frame_ms(tl))
		tab.commit()
		return true
	if view.last_clicked == "ruler":  # the playhead one frame
		var ms: float = view.playhead_ms + (N.frame_ms(tl) if right else -N.frame_ms(tl))
		tab.transport.seek(clampf(ms, 0.0, float(tl.get("duration", 0))))
		return true
	return false
