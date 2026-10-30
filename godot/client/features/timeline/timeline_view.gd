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
## Slice 6: layers (timeline_layers.gd) — a header press selects the layer and dragging it reorders live; a divider
## drag trades height with the layer below (Shift: all layers); a double-click on a header or an empty track adds a
## layer below (below the last: at the end); right-click on a header asks the tab for the layer menu. Selecting a
## layer clears the clip / flag selection and the other way round; the selected header is lit (the web shows none).
## WO-837: screen sections (timeline_rows.gd — a divider row per screen, "+ Screen" in the corner, a layer dragged across
## a divider changes its screenIdx), the control lane at the bottom (timeline_lane.gd — companion_press / light flags as
## stacking chips; select / drag / Delete work on them as on ruler markers), and vertical scroll (wheel over the layer
## headers or Ctrl + wheel, the thumb on the right edge). The drag gestures moved to timeline_view_drag.gd.

signal seek_requested(ms: float)
signal clip_selected(li: int, clip_id: String)  # clip_id "" = nothing selected
signal edited
signal source_dropped(source: Dictionary, li: int, ms: float, screen: int)  # screen: the section of a new layer (RW.ALL = none)
signal keyframes_edited
signal flag_selected(id: String)  # "" = none
signal flags_edited
signal layer_selected(li: int)  # -1 = none
signal layers_edited
signal layer_menu(li: int)
signal screen_add_requested  # "+ Screen" pressed: the tab shows the menu of screens not yet in the timeline

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const K := preload("res://features/timeline/timeline_keyframes.gd")
const KD := preload("res://features/timeline/timeline_kf_draw.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const FD := preload("res://features/timeline/timeline_flag_draw.gd")
const L := preload("res://features/timeline/timeline_layers.gd")
const VD := preload("res://features/timeline/timeline_view_draw.gd")
const DR := preload("res://features/timeline/timeline_view_drag.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")
const LN := preload("res://features/timeline/timeline_lane.gd")
const LF := preload("res://features/timeline/timeline_light.gd")
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
var sel_layer := -1
var last_layer := -1  # the web's selectedLayer: the last layer or clip clicked — the paste target (never cleared)
var last_clicked := ""  # the web's canvas.dataset.lastClicked: ruler / divider / header / track / clip
var screen_names := {}  # screen index → label, from the channel map (the tab keeps it current)
var layers_bottom := 0.0  # where the layer area ends on screen (the control lane starts there); set by the painting
var _drag := {}
var _seek_at := 0


func _ready() -> void:
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_CLICK
	resized.connect(func() -> void:
		_clamp_y()
		queue_redraw())


func set_timeline(t: Dictionary) -> void:
	var first := tl.is_empty() or str(tl.get("id", "")) != str(t.get("id", ""))
	tl = t
	if not tl.is_empty():
		TM.ensure_heights(tl)
	if sel_id != "" and (first or TE.find_clip(tl, sel_li, sel_id).is_empty()):
		select(-1, "")
	if sel_flag != "" and (first or F.find(tl, sel_flag).is_empty()):
		select_flag("")
	if sel_layer >= 0 and (first or sel_layer >= (tl.get("layers", []) as Array).size()):
		select_layer(-1)
	if first:
		last_layer = -1
		last_clicked = ""
		fit()
	_clamp_y()
	queue_redraw()


## The control lane as laid out at the current zoom: {chips: [{flag, x, w, row}], count}.
func lane() -> Dictionary:
	return LN.layout(tl, px_per_ms, func(f: Dictionary) -> String: return LF.chip_text(f) if str(f.get("type", "")) == "light" else "")


## RW.viewport for the current size: where the lane starts, how far the layers scroll.
func vp() -> Dictionary:
	return RW.viewport(tl, size.y, int(lane().count))


func _clamp_y() -> void:
	scroll_y = clampf(scroll_y, 0.0, float(vp().max_scroll)) if not tl.is_empty() else 0.0


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
	VD.draw(self)


func _gui_input(event: InputEvent) -> void:
	if tl.is_empty():
		return
	if event is InputEventMouseButton:
		var mb := event as InputEventMouseButton
		if mb.pressed and mb.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			var dir := 1 if mb.button_index == MOUSE_BUTTON_WHEEL_UP else -1
			if mb.ctrl_pressed or (mb.position.x < TM.HEADER_W and mb.position.y >= TM.RULER_H):  # WO-837: scroll the layers
				scroll_y = clampf(scroll_y - dir * 48.0, 0.0, float(vp().max_scroll))
			elif mb.shift_pressed or mb.alt_pressed:  # pan
				_clamp_scroll(scroll_x - dir * 80.0 / px_per_ms)
			else:  # zoom around the cursor
				var at := TM.ms_at(maxf(mb.position.x, TM.HEADER_W), px_per_ms, scroll_x)
				px_per_ms = TM.zoom(px_per_ms, dir)
				_clamp_scroll(at - (maxf(mb.position.x, TM.HEADER_W) - TM.HEADER_W) / px_per_ms)
				_clamp_y()  # the lane's rows depend on the zoom
			queue_redraw()
			accept_event()
		elif mb.button_index == MOUSE_BUTTON_LEFT:
			if mb.pressed:
				_press(mb)
			else:
				_scrubbing = false
				DR.end_drag(self)
		elif mb.button_index == MOUSE_BUTTON_RIGHT and mb.pressed and mb.position.x < TM.HEADER_W and mb.position.y >= TM.RULER_H:
			var li := RW.layer_at(tl, mb.position.y, scroll_y)
			if li >= 0 and li < (tl.layers as Array).size() and mb.position.y < layers_bottom:
				select_layer(li)
				layer_menu.emit(li)
				accept_event()
	elif event is InputEventMouseMotion:
		var mm := event as InputEventMouseMotion
		if _scrubbing:
			_seek_to(mm.position.x)
			accept_event()
		elif not _drag.is_empty():
			DR.drag_to(self, mm.position)
			accept_event()
		else:
			_hover(mm.position)


## A left press, first match wins: the scroll thumb, a control-lane chip (or the empty lane), a ruler flag, the "+ Screen"
## corner, the ruler (seek), a layer-height divider, a track, a header.
func _press(mb: InputEventMouseButton) -> void:
	var pos := mb.position
	var v := vp()
	last_clicked = _zone(pos)
	accept_event()
	var th := RW.thumb(v, float(RW.content_h(tl)), scroll_y)
	if not th.is_empty() and pos.x >= size.x - RW.SCROLLBAR_W and pos.y >= TM.RULER_H and pos.y < float(v.layers_bottom):
		var grab: float = pos.y - float(th[0]) if pos.y >= float(th[0]) and pos.y < float(th[0]) + float(th[1]) else float(th[1]) / 2.0
		_drag = {"vbar": true, "off": grab}
		DR.drag_to(self, pos)
		return
	if pos.y >= float(v.lane_top):
		_press_lane(pos, float(v.lane_top))
		return
	var f := F.hit(tl, pos, _x)
	if pos.y < TM.RULER_H and pos.x <= TM.HEADER_W:
		screen_add_requested.emit()
	elif not f.is_empty():
		select_flag(str(f.id))
		_drag = {"flag": f, "orig": float(f.get("timeMs", 0))}
	elif pos.y < TM.RULER_H:
		_scrubbing = true
		_seek_to(pos.x)
	elif not RW.hit_divider(tl, pos.y, scroll_y).is_empty():
		TM.ensure_heights(tl)
		var d := RW.hit_divider(tl, pos.y, scroll_y)
		_drag = {"div": d[0], "div2": d[1], "orig": (tl.layerHeights as Array).duplicate(), "y0": pos.y, "shift": mb.shift_pressed}
	elif pos.x > TM.HEADER_W:
		_press_track(pos, mb.double_click)
	else:
		_press_header(pos, mb.double_click)


## WO-837: a chip selects its flag and drags it in time; the empty lane clears the selection.
func _press_lane(pos: Vector2, lane_top: float) -> void:
	var f := LN.hit(lane(), lane_top, pos, _x)
	if f.is_empty():
		select(-1, "")
		select_flag("")
		select_layer(-1)
		return
	select_flag(str(f.id))
	_drag = {"flag": f, "orig": float(f.get("timeMs", 0))}


## Delete / Backspace (timeline_keys.gd): the selected flag, else the selected keyframe, else the clip — never a
## layer (web).
func delete_selected() -> void:
	if sel_flag != "":
		F.remove(tl, sel_flag)
		select_flag("")
		flags_edited.emit()
	elif sel_kf != null:
		_remove_kf()
	elif sel_id != "":
		TE.remove_clip(tl, sel_li, sel_id)
		select(-1, "")
		edited.emit()


## The web's −/+ buttons (canvas.zoom): one step, the left edge stays.
func zoom_step(dir: int) -> void:
	px_per_ms = TM.zoom(px_per_ms, dir)
	_clamp_scroll(scroll_x)
	queue_redraw()


func select(li: int, clip_id: String) -> void:
	if li == sel_li and clip_id == sel_id:
		return
	if clip_id != "" and sel_flag != "":
		select_flag("")
	if clip_id != "" and sel_layer >= 0:
		select_layer(-1)
	sel_li = li if clip_id != "" else -1
	sel_id = clip_id
	if clip_id != "":
		last_layer = li
	sel_kf = null
	queue_redraw()
	clip_selected.emit(sel_li, sel_id)


func select_flag(id: String) -> void:
	if id == sel_flag:
		return
	if id != "":
		select(-1, "")
		select_layer(-1)
	sel_flag = id
	queue_redraw()
	flag_selected.emit(id)


func select_layer(li: int) -> void:
	if li == sel_layer:
		return
	if li >= 0:
		select(-1, "")
		select_flag("")
	sel_layer = li
	if li >= 0:
		last_layer = li
	queue_redraw()
	layer_selected.emit(li)


## web header mousedown: select + start a layer-move; double-click: insertLayerBelow (the last one when below it).
## WO-837: a divider row only has its "+" (a new layer in that section) and "x" (drop an empty section).
func _press_header(pos: Vector2, double: bool) -> void:
	var n := (tl.layers as Array).size()
	var row := RW.row_at(tl, pos.y, scroll_y)
	if not row.is_empty() and row.kind == "divider":
		match RW.divider_button(pos.x, int(row.screen)):
			"add":
				select_layer(L.add_in_section(tl, int(row.screen)))
				layers_edited.emit()
			"remove":
				if L.remove_screen(tl, int(row.screen)):
					layers_edited.emit()
		return
	var li := RW.layer_at(tl, pos.y, scroll_y)
	if double and li >= 0:
		select_layer(L.insert_below(tl, mini(li, n - 1)))
		layers_edited.emit()
	elif li >= 0 and li < n:
		select_layer(li)
		_drag = {"layer": li, "from": li, "from_screen": RW.layer_screen(tl.layers[li])}


func _zone(pos: Vector2) -> String:
	if pos.y < TM.RULER_H:
		return "ruler"
	if pos.y >= layers_bottom:
		return "lane"
	if not RW.hit_divider(tl, pos.y, scroll_y).is_empty():
		return "divider"
	if pos.x < TM.HEADER_W:
		return "header"
	return "track" if _clip_at(pos).is_empty() else "clip"


## The clip under `pos` → [layer index, clip] or [] (web hitClip over layerAt).
func _clip_at(pos: Vector2) -> Array:
	var li := RW.layer_at(tl, pos.y, scroll_y)
	if li < 0 or li >= (tl.layers as Array).size():
		return []
	var c := TM.hit_clip(tl, li, TM.ms_at(pos.x, px_per_ms, scroll_x))
	return [] if c.is_empty() else [li, c]


func _hover(pos: Vector2) -> void:
	if pos.y >= float(vp().lane_top):  # WO-837: chips are grabbed and dragged in time
		mouse_default_cursor_shape = Control.CURSOR_HSIZE if not LN.hit(lane(), float(vp().lane_top), pos, _x).is_empty() else Control.CURSOR_ARROW
		return
	if pos.y >= TM.RULER_H and not RW.hit_divider(tl, pos.y, scroll_y).is_empty():
		mouse_default_cursor_shape = Control.CURSOR_VSIZE
		return
	if pos.y < TM.RULER_H:
		mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if not F.hit(tl, pos, _x).is_empty() else Control.CURSOR_HSIZE
		return
	var hit := _clip_at(pos) if pos.x > TM.HEADER_W and pos.y >= TM.RULER_H else []
	var edge := TE.edge_zone(hit[1], TM.ms_at(pos.x, px_per_ms, scroll_x), px_per_ms) if not hit.is_empty() else ""
	mouse_default_cursor_shape = Control.CURSOR_HSIZE if edge != "" else (Control.CURSOR_MOVE if not hit.is_empty() else Control.CURSOR_ARROW)


## The clip row on screen (web clipRowRect) — keyframes are drawn and hit-tested in it.
func _row(li: int) -> Vector2:
	var ty := RW.top(tl, li, scroll_y)
	var top := maxf(ty + 4, TM.RULER_H)
	return Vector2(top, maxf(0.0, minf(ty + TM.layer_h(tl, li) - 4, layers_bottom) - top))


func _press_track(pos: Vector2, double := false) -> void:
	var hit := _clip_at(pos)
	if hit.is_empty():
		var li := RW.layer_at(tl, pos.y, scroll_y)
		var n := (tl.layers as Array).size()
		var row := RW.row_at(tl, pos.y, scroll_y)
		if double and not row.is_empty() and row.kind == "divider":  # WO-837: a new layer in that screen's section
			select_layer(L.add_in_section(tl, int(row.screen)))
			layers_edited.emit()
		elif double and li >= 0:  # web dblclick on an empty track: a layer below it (below the last: at the end)
			select_layer(L.insert_below(tl, mini(li, n - 1)))
			layers_edited.emit()
		elif li >= 0 and li < n:
			select_layer(li)  # web onLayerClick
		else:
			select(-1, "")
			select_layer(-1)
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


func _can_drop_data(at: Vector2, data: Variant) -> bool:
	if tl.is_empty() or not (data is Dictionary) or str(data.get("value", "")) == "":
		return false
	if data.get("type") == "effect":  # web WO-22: an effect lands on the clip under the cursor, nowhere else
		return not TM.hit_clip(tl, RW.layer_at(tl, at.y, scroll_y), TM.ms_at(at.x, px_per_ms, scroll_x)).is_empty()
	return true


## Web drop: ms under the cursor (≥ 0), layer clamped to [0, n] — n means "a new layer below" (WO-837: in the section
## of the divider dropped on / of the last row).
func _drop_data(at: Vector2, data: Variant) -> void:
	var tgt := RW.drop_target(tl, at.y, scroll_y)
	source_dropped.emit(data, int(tgt.li), maxf(0.0, TM.ms_at(at.x, px_per_ms, scroll_x)), int(tgt.screen))


func _seek_to(x: float) -> void:
	var ms := clampf(TM.ms_at(x, px_per_ms, scroll_x), 0.0, float(tl.get("duration", 0)))
	playhead_ms = ms
	queue_redraw()
	seek_requested.emit(ms)
