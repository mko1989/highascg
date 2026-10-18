extends Control
## WO-602 — timeline canvas (web timeline-canvas.js + -render.js + -clip.js + -wheel.js, read-only slice): ruler with
## nice ticks, layer headers, tracks, clips in the layer palette with their label, flags, the duration end and the
## red playhead. Vertical wheel zooms around the cursor, Shift/Alt + wheel pans; click/drag on the ruler seeks.
## HiDPI comes from Godot's content scale (the web canvas has no devicePixelRatio handling).
## Slice 2 (timeline-canvas-pointer.js): click selects a clip (empty track deselects), drag moves it — also onto another
## layer — or resizes it from a 6 px edge zone, both snapping (timeline_edit.gd); a resize scrubs the playhead to the
## dragged edge. Sources drop onto tracks (below the last layer = a new one); Delete removes the selected clip. The
## view mutates the shared timeline Dictionary and emits `edited` once per gesture that changed something.
## Slice 4: keyframe diamonds + the eased opacity / volume curve (timeline_kf_draw.gd). Pressing a diamond selects it
## and drags it in time (snapped, never past a same-property neighbour); a double-click on a clip adds an opacity key
## at that time with the current value; Delete removes the selected key (its fill / scale partner too) before the clip.
## Keyframe gestures emit `keyframes_edited` (the tab syncs and re-seeks).
## Slice 5: flags (timeline_flag_draw.gd) — pressing one in the ruler selects it (instead of seeking) and drags it in
## time, unsnapped like the web; Delete removes the selected flag. A flag and a clip are never selected together.

signal seek_requested(ms: float)
signal clip_selected(li: int, clip_id: String)  # clip_id "" = nothing selected
signal edited
signal source_dropped(source: Dictionary, li: int, ms: float)
signal keyframes_edited
signal flag_selected(id: String)  # "" = none
signal flags_edited

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const K := preload("res://features/timeline/timeline_keyframes.gd")
const KD := preload("res://features/timeline/timeline_kf_draw.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const FD := preload("res://features/timeline/timeline_flag_draw.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var tl: Dictionary = {}
var playhead_ms := 0.0
var px_per_ms := 0.1
var scroll_x := 0.0
var scroll_y := 0.0
var follow := true
var _scrubbing := false
var sel_li := -1
var sel_id := ""
var sel_kf: Variant = null  # the selected keyframe Dictionary (by identity) of the selected clip
var sel_flag := ""
var _drag := {}
var _seek_at := 0


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_CLICK


func set_timeline(t: Dictionary) -> void:
	var first := tl.is_empty() or str(tl.get("id", "")) != str(t.get("id", ""))
	tl = t
	if not tl.is_empty():
		TM.ensure_heights(tl)
	if sel_id != "" and (first or TE.find_clip(tl, sel_li, sel_id).is_empty()):
		select(-1, "")
	if sel_flag != "" and (first or F.find(tl, sel_flag).is_empty()):
		select_flag("")
	if first:
		fit()
	queue_redraw()


func fit() -> void:
	var dur := float(tl.get("duration", 30000))
	if size.x <= TM.HEADER_W + 40:  # not laid out yet (the tab builds before it is shown) — fit on the first resize
		if not resized.is_connected(fit):
			resized.connect(fit, CONNECT_ONE_SHOT)
		return
	if dur > 0:
		px_per_ms = maxf(TM.MIN_PX_MS, (size.x - TM.HEADER_W - 20) / dur)
		scroll_x = 0.0
	queue_redraw()


func set_playhead(ms: float, playing: bool) -> void:
	playhead_ms = ms
	if follow and playing:
		var track_w := size.x - TM.HEADER_W
		var right := scroll_x + track_w / px_per_ms
		if ms > right - 0.1 * track_w / px_per_ms or ms < scroll_x:  # keep the playhead in view (page follow)
			_clamp_scroll(ms - 0.1 * track_w / px_per_ms)
	queue_redraw()


func _clamp_scroll(ms: float) -> void:
	var track_w := size.x - TM.HEADER_W
	var max_scroll := maxf(0.0, float(tl.get("duration", 0)) - track_w / px_per_ms) if px_per_ms > 0 else 0.0
	scroll_x = clampf(ms, 0.0, max_scroll)


func _x(ms: float) -> float:
	return TM.x_at(ms, px_per_ms, scroll_x)


func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), ThemeBuilder.BG_DARK)
	if tl.is_empty():
		draw_string(get_theme_default_font(), Vector2(TM.HEADER_W + 12, 60), "No timeline", HORIZONTAL_ALIGNMENT_LEFT, -1, 14, ThemeBuilder.TEXT_MUTED)
		return
	var font := get_theme_default_font()
	var layers: Array = tl.get("layers", [])
	var dur := float(tl.get("duration", 30000))
	var fps := int(tl.get("fps", 25))
	# tracks
	for i in layers.size():
		var y := TM.track_top(tl, i, scroll_y)
		var h := TM.layer_h(tl, i)
		if y + h < TM.RULER_H or y > size.y:
			continue
		draw_rect(Rect2(TM.HEADER_W, y, size.x - TM.HEADER_W, h), Color("#0d1117") if i % 2 == 0 else Color("#10151c"))
		draw_rect(Rect2(TM.HEADER_W, y + h - 1, size.x - TM.HEADER_W, 1), Color("#21262d"))
		for c in layers[i].get("clips", []):
			_draw_clip(c, i, y, h, font)
	# past-the-end shade
	var end_x := _x(dur)
	if end_x < size.x:
		draw_rect(Rect2(maxf(end_x, TM.HEADER_W), TM.RULER_H, size.x - maxf(end_x, TM.HEADER_W), size.y - TM.RULER_H), Color(0, 0, 0, 0.35))
	FD.draw_trails(self, tl, _x, size, sel_flag)
	# headers
	draw_rect(Rect2(0, 0, TM.HEADER_W, size.y), Color("#161b22"))
	for i in layers.size():
		var y := TM.track_top(tl, i, scroll_y)
		if y + TM.layer_h(tl, i) < TM.RULER_H or y > size.y:
			continue
		draw_string(font, Vector2(8, y + 18), str(layers[i].get("name", "Layer %d" % (i + 1))), HORIZONTAL_ALIGNMENT_LEFT, TM.HEADER_W - 12, 12, ThemeBuilder.TEXT)
		draw_rect(Rect2(0, y + TM.layer_h(tl, i) - 1, TM.HEADER_W, 1), Color("#21262d"))
	draw_rect(Rect2(TM.HEADER_W - 1, 0, 1, size.y), Color("#30363d"))
	_draw_ruler(font, dur, fps)
	FD.draw_markers(self, tl, _x, size.x, sel_flag, font)
	# playhead
	var px := roundf(_x(playhead_ms)) + 0.5
	if px >= TM.HEADER_W:
		draw_line(Vector2(px, TM.RULER_H), Vector2(px, size.y), ThemeBuilder.ERROR, 1.0)
		draw_colored_polygon(PackedVector2Array([Vector2(px - 6, 0), Vector2(px + 6, 0), Vector2(px, 12)]), ThemeBuilder.ERROR)


func _draw_ruler(font: Font, dur: float, fps: int) -> void:
	draw_rect(Rect2(TM.HEADER_W, 0, size.x - TM.HEADER_W, TM.RULER_H), Color("#161b22"))
	draw_rect(Rect2(TM.HEADER_W, TM.RULER_H - 1, size.x - TM.HEADER_W, 1), Color("#30363d"))
	var interval := TM.ruler_interval(px_per_ms)
	var end_ms := scroll_x + (size.x - TM.HEADER_W) / px_per_ms
	var t := ceilf(scroll_x / interval) * interval
	while t <= minf(end_ms, dur + interval):
		var x := _x(t)
		draw_rect(Rect2(x, 0, 1, TM.RULER_H), Color("#21262d"))
		draw_rect(Rect2(x, TM.RULER_H - 6, 1, 6), Color("#58a6ff"))
		draw_string(font, Vector2(x + 3, TM.RULER_H - 9), TM.fmt_timecode(t, fps), HORIZONTAL_ALIGNMENT_LEFT, -1, 10, ThemeBuilder.TEXT_MUTED)
		t += interval
	var sub := interval / 5.0
	if sub * px_per_ms >= 5.0:
		var s := ceilf(scroll_x / sub) * sub
		while s <= end_ms:
			if fmod(s, interval) >= 1.0:
				draw_rect(Rect2(_x(s), TM.RULER_H - 4, 1, 4), Color("#30363d"))
			s += sub


func _draw_clip(c: Dictionary, li: int, track_y: float, track_h: int, font: Font) -> void:
	if not (c.get("source") is Dictionary) or str(c.source.get("value", "")) == "":
		return
	var x := _x(float(c.get("startTime", 0)))
	var w := maxf(3.0, float(c.get("duration", 0)) * px_per_ms)
	var top := maxf(track_y + 4, TM.RULER_H)
	var bottom := minf(track_y + track_h - 4, size.y)
	var h := bottom - top
	if x + w < TM.HEADER_W + 1 or x > size.x or h < 4:
		return
	var col := Color(TM.CLIP_PALETTE[li % TM.CLIP_PALETTE.size()])
	var r := Rect2(x, top, w, h)
	draw_style_box(_box(col), r)
	if li == sel_li and str(c.get("id", "")) == sel_id:
		draw_rect(r.grow(-1), Color.WHITE, false, 2.0)
	var label := str(c.source.get("label", c.source.value)).get_file()
	var lx := maxf(x, TM.HEADER_W + 1) + 5
	var avail := minf(x + w, size.x) - lx - 4
	if avail > 12 and h >= 14:
		draw_string(font, Vector2(lx, top + 13), label, HORIZONTAL_ALIGNMENT_LEFT, avail, 11, Color(1, 1, 1, 0.92))
	KD.draw(self, c, top, h, _x, TM.HEADER_W, size.x, sel_kf, _drag.has("kf"))


func _box(col: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(3)
	return sb


func _gui_input(event: InputEvent) -> void:
	if tl.is_empty():
		return
	if event is InputEventKey:
		var k := event as InputEventKey
		if k.pressed and not k.echo and k.keycode in [KEY_DELETE, KEY_BACKSPACE] and (sel_id != "" or sel_flag != ""):
			if sel_flag != "":
				F.remove(tl, sel_flag)
				select_flag("")
				flags_edited.emit()
			elif sel_kf != null:
				_remove_kf()
			else:
				TE.remove_clip(tl, sel_li, sel_id)
				select(-1, "")
				edited.emit()
			accept_event()
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var dir := 1 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1
			if mb.shift_pressed or mb.alt_pressed:  # pan
				_clamp_scroll(scroll_x - dir * 80.0 / px_per_ms)
			else:  # zoom around the cursor
				var at := TM.ms_at(maxf(mb.position.x, TM.HEADER_W), px_per_ms, scroll_x)
				px_per_ms = TM.zoom(px_per_ms, dir)
				_clamp_scroll(at - (maxf(mb.position.x, TM.HEADER_W) - TM.HEADER_W) / px_per_ms)
			queue_redraw()
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed and not F.hit(tl, mb.position, _x).is_empty():
				var f := F.hit(tl, mb.position, _x)
				select_flag(str(f.id))
				_drag = {"flag": f, "orig": float(f.get("timeMs", 0))}
				accept_event()
			elif mb.pressed and mb.position.y < TM.RULER_H and mb.position.x > TM.HEADER_W:
				_scrubbing = true
				_seek_to(mb.position.x)
				accept_event()
			elif mb.pressed and mb.position.x > TM.HEADER_W:
				_press_track(mb.position, mb.double_click)
				accept_event()
			elif not mb.pressed:
				_scrubbing = false
				_end_drag()
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if _scrubbing:
			_seek_to(mm.position.x)
			accept_event()
		elif not _drag.is_empty():
			_drag_to(mm.position)
			accept_event()
		else:
			_hover(mm.position)


func select(li: int, clip_id: String) -> void:
	if li == sel_li and clip_id == sel_id:
		return
	if clip_id != "" and sel_flag != "":
		select_flag("")
	sel_li = li if clip_id != "" else -1
	sel_id = clip_id
	sel_kf = null
	queue_redraw()
	clip_selected.emit(sel_li, sel_id)


func select_flag(id: String) -> void:
	if id == sel_flag:
		return
	if id != "":
		select(-1, "")
	sel_flag = id
	queue_redraw()
	flag_selected.emit(id)


## The clip under `pos` → [layer index, clip] or [] (web hitClip over layerAt).
func _clip_at(pos: Vector2) -> Array:
	var li := TM.layer_at_y(tl, pos.y, scroll_y)
	if li >= (tl.layers as Array).size():
		return []
	var c := TM.hit_clip(tl, li, TM.ms_at(pos.x, px_per_ms, scroll_x))
	return [] if c.is_empty() else [li, c]


func _hover(pos: Vector2) -> void:
	if pos.y < TM.RULER_H:
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if not F.hit(tl, pos, _x).is_empty() else Control.CURSOR_HSIZE
		return
	var hit := _clip_at(pos) if pos.x > TM.HEADER_W and pos.y >= TM.RULER_H else []
	var edge := TE.edge_zone(hit[1], TM.ms_at(pos.x, px_per_ms, scroll_x), px_per_ms) if not hit.is_empty() else ""
	mouse_default_cursor_shape = Control.CURSOR_HSIZE if edge != "" else (Control.CURSOR_MOVE if not hit.is_empty() else Control.CURSOR_ARROW)


## The clip row on screen (web clipRowRect) — keyframes are drawn and hit-tested in it.
func _row(li: int) -> Vector2:
	var ty := TM.track_top(tl, li, scroll_y)
	var top := maxf(ty + 4, TM.RULER_H)
	return Vector2(top, maxf(0.0, minf(ty + TM.layer_h(tl, li) - 4, size.y) - top))


func _press_track(pos: Vector2, double := false) -> void:
	var hit := _clip_at(pos)
	if hit.is_empty():
		select(-1, "")
		return
	var c: Dictionary = hit[1]
	var ms := TM.ms_at(pos.x, px_per_ms, scroll_x)
	select(hit[0], str(c.id))
	var row := _row(hit[0])
	var ki := K.hit(c, row.x, row.y, pos, _x)
	if ki >= 0:
		sel_kf = c.keyframes[ki]
		_drag = {"kf": sel_kf, "li": hit[0], "id": str(c.id), "orig_time": float(sel_kf.time), "now": playhead_ms}
		queue_redraw()
		return
	if sel_kf != null:
		sel_kf = null
		queue_redraw()
	if double:  # web onDblClickAddKeyframe: opacity at the current value
		var t := clampf(roundf(ms - float(c.startTime)), 0.0, float(c.get("duration", 0)))
		sel_kf = K.add(c, {"time": t, "property": "opacity", "value": K.interp(c, t, "opacity", 1.0), "easing": "linear"})
		queue_redraw()
		keyframes_edited.emit()
		return
	_drag = {"edge": TE.edge_zone(c, ms, px_per_ms), "li": hit[0], "from_li": hit[0], "id": str(c.id), "orig_ms": ms,
		"start": float(c.startTime), "dur": float(c.duration), "now": playhead_ms, "inPoint": int(c.get("inPoint", 0) if c.get("inPoint") != null else 0)}


func _drag_to(pos: Vector2) -> void:
	var ms := TM.ms_at(pos.x, px_per_ms, scroll_x)
	if _drag.has("flag"):  # web onMoveFlagTime: clamped to the timeline, no snap
		F.update(tl, _drag.flag, {"timeMs": clampf(ms, 0.0, float(tl.get("duration", 0)))})
		queue_redraw()
		return
	var c := TE.find_clip(tl, _drag.li, _drag.id)
	if c.is_empty():
		return
	var thr := TE.SNAP_THRESHOLD_PX / px_per_ms
	if _drag.has("kf"):
		var abs_ms := TE.snapped_edge(ms, K.snap_candidates(tl, _drag.now, _drag.kf), thr, _drag.now)
		if K.move(c, _drag.kf, abs_ms - float(c.startTime)):
			queue_redraw()
		return
	var cands := TE.snap_candidates(tl, _drag.now, _drag.li, _drag.id)  # the playhead at press: a resize moves it
	if _drag.edge == "":
		var start := TE.snapped_start(float(_drag.start) + ms - float(_drag.orig_ms), float(c.duration), cands, thr, _drag.now)
		var to_li := TM.layer_at_y(tl, pos.y, scroll_y)
		if to_li >= 0 and to_li < (tl.layers as Array).size() and to_li != _drag.li:
			TE.move_clip_to_layer(tl, _drag.id, _drag.li, to_li)
			_drag["li"] = to_li
			sel_li = to_li
			clip_selected.emit(sel_li, sel_id)
		TE.update_clip(tl, _drag.li, _drag.id, {"startTime": start})
	else:
		var ch := TE.resize_changes(_drag.edge, TE.snapped_edge(ms, cands, thr, _drag.now), _drag, float(tl.get("fps", 25)))
		if not ch.is_empty():
			TE.update_clip(tl, _drag.li, _drag.id, ch)
			_scrub_preview(float(c.startTime) if _drag.edge == "left" else float(c.startTime) + float(c.duration))
	queue_redraw()


## onClipResizePreview: the playhead follows the dragged edge; the engine seeks at most every 100 ms.
func _scrub_preview(ms: float) -> void:
	playhead_ms = clampf(ms, 0.0, float(tl.get("duration", 0)))
	var now := Time.get_ticks_msec()
	if now - _seek_at >= 100:
		_seek_at = now
		seek_requested.emit(playhead_ms)


func _end_drag() -> void:
	if _drag.is_empty():
		return
	var d := _drag
	_drag = {}
	if d.has("flag"):
		if float(d.flag.get("timeMs", 0)) != float(d.orig):
			flags_edited.emit()
		return
	var c := TE.find_clip(tl, d.li, d.id)
	if c.is_empty():
		return
	if d.has("kf"):
		queue_redraw()
		if float(d.kf.time) != float(d.orig_time):  # web: commit only when the time changed
			keyframes_edited.emit()
		return
	if _drag_changed(d, c):
		if d.edge != "":
			seek_requested.emit(playhead_ms)  # the trailing seek the throttle may have skipped
		edited.emit()


static func _drag_changed(d: Dictionary, c: Dictionary) -> bool:
	return d.li != d.from_li or float(c.startTime) != float(d.start) or float(c.duration) != float(d.dur) \
		or int(c.get("inPoint", 0) if c.get("inPoint") != null else 0) != int(d.inPoint)


func _remove_kf() -> void:
	var c := TE.find_clip(tl, sel_li, sel_id)
	var kf: Dictionary = sel_kf
	sel_kf = null
	if c.is_empty():
		return
	K.remove(c, str(kf.property), float(kf.time))
	if K.partner(str(kf.property)) != "":
		K.remove(c, K.partner(str(kf.property)), float(kf.time))
	queue_redraw()
	keyframes_edited.emit()


func _can_drop_data(_at: Vector2, data: Variant) -> bool:
	return not tl.is_empty() and data is Dictionary and str(data.get("value", "")) != "" and data.get("type") != "effect"


## Web drop: ms under the cursor (≥ 0), layer clamped to [0, n] — n means "a new layer below".
func _drop_data(at: Vector2, data: Variant) -> void:
	var li := clampi(TM.layer_at_y(tl, at.y, scroll_y), 0, (tl.layers as Array).size())
	source_dropped.emit(data, li, maxf(0.0, TM.ms_at(at.x, px_per_ms, scroll_x)))


func _seek_to(x: float) -> void:
	var ms := clampf(TM.ms_at(x, px_per_ms, scroll_x), 0.0, float(tl.get("duration", 0)))
	playhead_ms = ms
	queue_redraw()
	seek_requested.emit(ms)
