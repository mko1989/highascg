extends RefCounted
## WO-602 slice 2 — timeline editing, the pure part, 1:1 with the web: snapping (timeline-canvas-snap.js), clip edge
## zones (timeline-canvas-render.js edgeZone), the clip mutations of timeline-state-clips.js (add / move to layer /
## update / remove / replace source + expandDurationToContent), defaultClip (timeline-state-model.js +
## editor-defaults.js applyTimelineClipDefaults) and the clip's first pixel rect (fill-math.js
## sceneLayerPixelRectForContentFit). Same JSON as the web, so a timeline edited here opens identically there.

const TM := preload("res://features/timeline/timeline_math.gd")

const SNAP_THRESHOLD_PX := 8.0
const EDGE_PX := 6.0
const MIN_CLIP_MS := 200.0
const CONTENT_END_PADDING_MS := 2000.0
const DEFAULT_CLIP_MS := 5000.0
const FITS := ["native", "fill-canvas", "horizontal", "vertical", "stretch"]


static func snap_value(v: float, candidates: Array, threshold: float) -> float:
	var best_diff := threshold
	var best := v
	for c in candidates:
		var d := absf(v - float(c))
		if d < best_diff:
			best_diff = d
			best = float(c)
	return best


## collectTimelineSnapCandidates: 0, the end, the playhead (when known), flags, every other clip's edges.
static func snap_candidates(tl: Dictionary, now_pointer: Variant, ex_layer := -1, ex_clip := "") -> Array:
	var out: Array = [0.0, float(tl.get("duration", 0))]
	if now_pointer != null:
		out.append(float(now_pointer))
	for f in tl.get("flags", []):
		if f is Dictionary:
			out.append(float(f.get("timeMs", 0)))
	var layers: Array = tl.get("layers", [])
	for li in layers.size():
		for c in layers[li].get("clips", []):
			if li == ex_layer and str(c.get("id", "")) == ex_clip:
				continue
			out.append(float(c.startTime))
			out.append(float(c.startTime) + float(c.duration))
	return out


## resolveSnappedStart: snap whichever clip edge is closer; the playhead pulls from 14/8 × the threshold.
## Deliberate fix over the web: there an edge with no candidate in range "snaps" to itself at distance 0 and so always
## beats the edge that did find one — clip moves never snap to clips/flags in the browser, only to the playhead.
static func snapped_start(raw: float, dur: float, candidates: Array, thr: float, now_pointer: Variant) -> float:
	var s := snap_value(raw, candidates, thr)
	var e := snap_value(raw + dur, candidates, thr) - dur
	var ds_snap := absf(s - raw) if s != raw else INF
	var de_snap := absf(e - raw) if e != raw else INF
	var out := raw
	if ds_snap <= de_snap:
		if ds_snap < thr:
			out = s
	elif de_snap < thr:
		out = e
	if now_pointer != null:
		var np := float(now_pointer)
		var nthr := thr * (14.0 / 8.0)
		var ds := absf(raw - np)
		var de := absf(raw + dur - np)
		if ds < nthr or de < nthr:
			out = np if ds <= de else np - dur
	return maxf(0.0, out)


## resolveSnappedEdge
static func snapped_edge(raw: float, candidates: Array, thr: float, now_pointer: Variant) -> float:
	var e := snap_value(raw, candidates, thr)
	var out := e if absf(e - raw) < thr else raw
	if now_pointer != null and absf(raw - float(now_pointer)) < thr * (14.0 / 8.0):
		out = float(now_pointer)
	return out


## edgeZone: "left" / "right" within 6 px of a clip edge, else "".
static func edge_zone(clip: Dictionary, ms: float, px_per_ms: float) -> String:
	var e := EDGE_PX / px_per_ms
	if absf(ms - float(clip.startTime)) < e:
		return "left"
	if absf(ms - (float(clip.startTime) + float(clip.duration))) < e:
		return "right"
	return ""


## The web clip-resize drag step: {startTime, duration, inPoint} changes, or {} when the clip would go under 200 ms.
static func resize_changes(edge: String, ms: float, orig: Dictionary, fps: float) -> Dictionary:
	var o_start := float(orig.start)
	var o_dur := float(orig.dur)
	if edge == "left":
		var ns := maxf(0.0, ms)
		var nd := o_start + o_dur - ns
		if nd <= MIN_CLIP_MS:
			return {}
		var dframes := floori((ns - o_start) * maxf(1.0, fps) / 1000.0)
		return {"startTime": ns, "duration": nd, "inPoint": maxi(0, int(orig.get("inPoint", 0)) + dframes)}
	var nd2 := maxf(MIN_CLIP_MS, ms - o_start)
	var ch := {"duration": nd2}
	if nd2 > o_dur:
		ch["inPoint"] = 0
	return ch


static func content_end(tl: Dictionary) -> float:
	var end := 0.0
	for l in tl.get("layers", []):
		for c in l.get("clips", []):
			end = maxf(end, float(c.get("startTime", 0)) + float(c.get("duration", 0)))
	for f in tl.get("flags", []):
		if f is Dictionary and (f.get("timeMs") is float or f.get("timeMs") is int):
			end = maxf(end, float(f.timeMs))
	return end


## expandDurationToContent → true when the timeline grew.
static func expand_duration(tl: Dictionary) -> bool:
	var target := ceilf(content_end(tl) + CONTENT_END_PADDING_MS)
	if target > float(tl.get("duration", 0)):
		tl["duration"] = target
		return true
	return false


## defaultClip + applyTimelineClipDefaults (settings editorDefaults.timeline: loopAlways, contentFit).
static func default_clip(source: Variant, start: float, dur: float, defaults: Dictionary = {}) -> Dictionary:
	var fit := str(defaults.get("contentFit", "native"))
	return {"id": TM.uid(), "source": source, "startTime": start, "duration": dur if dur > 0 else DEFAULT_CLIP_MS,
		"inPoint": 0, "outPoint": null, "keyframes": [], "audioRoute": "1+2", "muted": false, "volume": 1, "opacity": 1,
		"aspectLocked": true, "contentFit": fit if fit in FITS else "native", "startBehaviour": "beginning",
		"loopAlways": defaults.get("loopAlways", false) == true, "loop": false}


static func find_clip(tl: Dictionary, li: int, clip_id: String) -> Dictionary:
	var layers: Array = tl.get("layers", [])
	if li < 0 or li >= layers.size():
		return {}
	for c in layers[li].get("clips", []):
		if str(c.get("id", "")) == clip_id:
			return c
	return {}


## addClip (naturalDuration remembers the media's own length — WO-523).
static func add_clip(tl: Dictionary, li: int, source: Variant, start: float, dur: float, defaults: Dictionary = {}) -> Dictionary:
	var layers: Array = tl.get("layers", [])
	if li < 0 or li >= layers.size():
		return {}
	var c := default_clip(source, start, dur, defaults)
	c["naturalDuration"] = c.duration
	(layers[li].clips as Array).append(c)
	expand_duration(tl)
	return c


static func update_clip(tl: Dictionary, li: int, clip_id: String, changes: Dictionary) -> Dictionary:
	var c := find_clip(tl, li, clip_id)
	if c.is_empty():
		return {}
	c.merge(changes, true)
	expand_duration(tl)
	return c


static func move_clip_to_layer(tl: Dictionary, clip_id: String, from_li: int, to_li: int) -> Dictionary:
	var layers: Array = tl.get("layers", [])
	if from_li < 0 or from_li >= layers.size() or to_li < 0 or to_li >= layers.size():
		return {}
	var clips: Array = layers[from_li].clips
	for i in clips.size():
		if str(clips[i].get("id", "")) == clip_id:
			var c: Dictionary = clips[i]
			clips.remove_at(i)
			(layers[to_li].clips as Array).append(c)
			return c
	return {}


static func remove_clip(tl: Dictionary, li: int, clip_id: String) -> void:
	var layers: Array = tl.get("layers", [])
	if li < 0 or li >= layers.size():
		return
	var clips: Array = layers[li].clips
	for i in clips.size():
		if str(clips[i].get("id", "")) == clip_id:
			clips.remove_at(i)
			return


## replaceClipSource (WO-523): an operator-resized clip keeps its length, a media-length clip adopts the new one.
static func replace_clip_source(tl: Dictionary, li: int, clip_id: String, source: Variant, dur_ms: float) -> Dictionary:
	var c := find_clip(tl, li, clip_id)
	if c.is_empty():
		return {}
	var incoming := maxf(1.0, dur_ms if dur_ms > 0 else DEFAULT_CLIP_MS)
	var prev_nat := float(c.get("naturalDuration", 0)) if c.get("naturalDuration") != null else 0.0
	var prev_dur := maxf(1.0, float(c.get("duration", 0)))
	var resized := prev_nat <= 0 or prev_dur != prev_nat
	var d := prev_dur if resized else incoming
	c["source"] = source
	c["duration"] = d
	c["naturalDuration"] = incoming
	c["inPoint"] = 0
	c["outPoint"] = null
	for kf in c.get("keyframes", []):
		if kf is Dictionary and float(kf.get("time", 0)) > d:
			kf["time"] = d
	expand_duration(tl)
	return c


## sceneLayerPixelRectForContentFit → {x, y, w, h} program pixels.
static func fit_rect(cw: float, ch: float, mw: float, mh: float, fit: String) -> Dictionary:
	var w0 := maxf(1.0, cw)
	var h0 := maxf(1.0, ch)
	if not (mw > 0 and mh > 0):
		return {"x": 0, "y": 0, "w": w0, "h": h0}
	var ar := mw / mh
	match fit:
		"native":
			var w := maxf(1.0, roundf(mw))
			var h := maxf(1.0, roundf(mh))
			return {"x": _jsround((w0 - w) / 2.0), "y": _jsround((h0 - h) / 2.0), "w": w, "h": h}
		"stretch":
			return {"x": 0, "y": 0, "w": w0, "h": h0}
		"horizontal":
			var h := maxf(1.0, roundf(w0 / ar))
			return {"x": 0, "y": _jsround((h0 - h) / 2.0), "w": w0, "h": h}
		"vertical":
			var w := maxf(1.0, roundf(h0 * ar))
			return {"x": _jsround((w0 - w) / 2.0), "y": 0, "w": w, "h": h0}
	var s := minf(w0 / mw, h0 / mh)
	var fw := maxf(1.0, roundf(mw * s))
	var fh := maxf(1.0, roundf(mh * s))
	return {"x": _jsround((w0 - fw) / 2.0), "y": _jsround((h0 - fh) / 2.0), "w": fw, "h": fh}


## Math.round (half up, also for negatives: −0.5 → −0), unlike GDScript's round (half away from zero).
static func _jsround(v: float) -> float:
	return floorf(v + 0.5)


static func parse_resolution(s: String) -> Vector2i:
	var m := RegEx.create_from_string("(\\d+)\\s*[x×]\\s*(\\d+)").search(s)
	return Vector2i(m.get_string(1).to_int(), m.get_string(2).to_int()) if m != null else Vector2i.ZERO


## containRectPreservingAspect (WO-523): new media inside the exchanged clip's old rect, centre kept, no crop.
static func contain_rect(prev: Dictionary, mw: float, mh: float) -> Dictionary:
	var bw := maxf(1.0, roundf(float(prev.get("w", 0))))
	var bh := maxf(1.0, roundf(float(prev.get("h", 0))))
	var px := float(prev.get("x", 0))
	var py := float(prev.get("y", 0))
	if not (mw > 0 and mh > 0) or not (float(prev.get("w", 0)) > 0 and float(prev.get("h", 0)) > 0):
		return {"x": px, "y": py, "w": bw, "h": bh}
	var s := minf(bw / mw, bh / mh)
	var w := maxf(1.0, roundf(mw * s))
	var h := maxf(1.0, roundf(mh * s))
	return {"x": _jsround(px + bw / 2.0 - w / 2.0), "y": _jsround(py + bh / 2.0 - h / 2.0), "w": w, "h": h}


## findMediaRow: exact id, else the same lower-case basename without extension (normalizeMediaIdForMatch, minus
## its encoding-suffix stripping — Sources hands over exact ids).
static func find_media_row(rows: Array, value: String) -> Dictionary:
	if value == "":
		return {}
	for r in rows:
		if r is Dictionary and str(r.get("id", "")) == value:
			return r
	var nv := _norm_id(value)
	for r in rows:
		if r is Dictionary and _norm_id(str(r.get("id", ""))) == nv:
			return r
	return {}


static func _norm_id(id: String) -> String:
	return id.to_lower().replace("\\", "/").get_file().get_basename().strip_edges()


## nextLayerDisplayName: "Layer N" after the highest numbered / the count.
static func next_layer_name(tl: Dictionary) -> String:
	var layers: Array = tl.get("layers", [])
	var mx := 0
	var re := RegEx.create_from_string("(?i)^Layer\\s+(\\d+)$")
	for l in layers:
		var m := re.search(str(l.get("name", "")) if l is Dictionary else "")
		if m != null:
			mx = maxi(mx, m.get_string(1).to_int())
	return "Layer %d" % (maxi(mx, layers.size()) + 1)
