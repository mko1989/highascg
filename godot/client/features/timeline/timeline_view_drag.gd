extends RefCounted
## WO-602 — the timeline canvas' drag gestures (moved out of timeline_view.gd for the 500-line limit; WO-837 added the
## scroll thumb, the control-lane chip drag, height dividers across section borders and layers dragged across a
## screen divider). The view owns `_drag` (what was pressed) and calls these on motion / release.

const TM := preload("res://features/timeline/timeline_math.gd")
const TE := preload("res://features/timeline/timeline_edit.gd")
const K := preload("res://features/timeline/timeline_keyframes.gd")
const F := preload("res://features/timeline/timeline_flags.gd")
const L := preload("res://features/timeline/timeline_layers.gd")
const RW := preload("res://features/timeline/timeline_rows.gd")


static func drag_to(v: Control, pos: Vector2) -> void:
	var tl: Dictionary = v.tl
	var d: Dictionary = v._drag
	var ms := TM.ms_at(pos.x, v.px_per_ms, v.scroll_x)
	if d.has("vbar"):  # the vertical scroll thumb
		v.scroll_y = RW.scroll_for_thumb(v.vp(), float(RW.content_h(tl)), pos.y - float(d.off))
		v.queue_redraw()
		return
	if d.has("div"):
		tl["layerHeights"] = L.divider_heights(d.orig, d.div, pos.y - float(d.y0), d.shift, int(d.div2))
		v.queue_redraw()
		return
	if d.has("layer"):  # web layer-move: reorder live as the cursor enters another layer (WO-837: or another section)
		if pos.y < float(v.vp().layers_bottom):
			var to := L.drag_over(tl, int(d.layer), RW.row_at(tl, pos.y, v.scroll_y))
			if to != d.layer:
				d["layer"] = to
				v.sel_layer = to
				v.layer_selected.emit(to)
		v.queue_redraw()
		return
	if d.has("flag"):  # web onMoveFlagTime: clamped to the timeline, no snap
		F.update(tl, d.flag, {"timeMs": clampf(ms, 0.0, float(tl.get("duration", 0)))})
		v.queue_redraw()
		return
	var c := TE.find_clip(tl, d.li, d.id)
	if c.is_empty():
		return
	var thr := TE.SNAP_THRESHOLD_PX / float(v.px_per_ms)
	if d.has("kf"):
		var abs_ms := TE.snapped_edge(ms, K.snap_candidates(tl, d.now, d.kf), thr, d.now)
		if K.move(c, d.kf, abs_ms - float(c.startTime)):
			v.queue_redraw()
		return
	var cands := TE.snap_candidates(tl, d.now, d.li, d.id)  # the playhead at press: a resize moves it
	if d.edge == "":
		var start := TE.snapped_start(float(d.start) + ms - float(d.orig_ms), float(c.duration), cands, thr, d.now)
		var to_li := RW.layer_at(tl, pos.y, v.scroll_y)
		if to_li >= 0 and to_li < (tl.layers as Array).size() and to_li != d.li:
			TE.move_clip_to_layer(tl, d.id, d.li, to_li)
			d["li"] = to_li
			v.sel_li = to_li
			v.clip_selected.emit(v.sel_li, v.sel_id)
		TE.update_clip(tl, d.li, d.id, {"startTime": start})
	else:
		var ch := TE.resize_changes(d.edge, TE.snapped_edge(ms, cands, thr, d.now), d, float(tl.get("fps", 25)))
		if not ch.is_empty():
			TE.update_clip(tl, d.li, d.id, ch)
			scrub_preview(v, float(c.startTime) if d.edge == "left" else float(c.startTime) + float(c.duration))
	v.queue_redraw()


## onClipResizePreview: the playhead follows the dragged edge; the engine seeks at most every 100 ms.
static func scrub_preview(v: Control, ms: float) -> void:
	v.playhead_ms = clampf(ms, 0.0, float(v.tl.get("duration", 0)))
	var now := Time.get_ticks_msec()
	if now - int(v._seek_at) >= 100:
		v._seek_at = now
		v.seek_requested.emit(v.playhead_ms)


static func end_drag(v: Control) -> void:
	if v._drag.is_empty():
		return
	var tl: Dictionary = v.tl
	var d: Dictionary = v._drag
	v._drag = {}
	if d.has("vbar"):
		return
	if d.has("flag"):
		if float(d.flag.get("timeMs", 0)) != float(d.orig):
			v.flags_edited.emit()
		return
	if d.has("div") or d.has("layer"):
		var moved: bool = d.has("layer") and (d.layer != d.from or RW.layer_screen(tl.layers[d.layer]) != d.from_screen)
		if (d.has("div") and tl.layerHeights != d.orig) or moved:
			v.layers_edited.emit()
		return
	var c := TE.find_clip(tl, d.li, d.id)
	if c.is_empty():
		return
	if d.has("kf"):
		v.queue_redraw()
		if float(d.kf.time) != float(d.orig_time):  # web: commit only when the time changed
			v.keyframes_edited.emit()
		return
	if drag_changed(d, c):
		if d.edge != "":
			v.seek_requested.emit(v.playhead_ms)  # the trailing seek the throttle may have skipped
		v.edited.emit()


static func drag_changed(d: Dictionary, c: Dictionary) -> bool:
	return d.li != d.from_li or float(c.startTime) != float(d.start) or float(c.duration) != float(d.dur) \
		or int(c.get("inPoint", 0) if c.get("inPoint") != null else 0) != int(d.inPoint)
