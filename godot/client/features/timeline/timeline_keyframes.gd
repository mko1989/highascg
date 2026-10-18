extends RefCounted
## WO-602 slice 4 — clip keyframes, the pure part, 1:1 with the web: the mutations of lib/timeline-state-keyframes.js
## (add replaces the same property + time, remove within 0.5 ms, clear by property / range, position + scale pairs,
## the drag clamp that never crosses a same-property neighbour), marker geometry + hit test + drag snap candidates
## (components/timeline-canvas-snap.js), the linear value the engine sends on a seek / scrub (timeline-engine.js
## _lerp) and the eased value Caspar plays between two keys (timeline-keyframe-mixer.js: the END key's easing, mapped
## like src/caspar/caspar-tween.js). A keyframe is {time (clip-local ms), property, value, easing}; fill / scale values
## are normalized to the program canvas (px / W, px / H).

const PROPS := {"opacity": {"label": "Opacity", "min": 0.0, "max": 1.0, "default": 1.0},
	"volume": {"label": "Volume", "min": 0.0, "max": 2.0, "default": 1.0}}
const COLORS := {"opacity": "#ffd700", "volume": "#4ec9b0", "fill_x": "#569cd6", "fill_y": "#569cd6",
	"scale_x": "#c586c0", "scale_y": "#c586c0"}
const EASINGS := ["linear", "ease-in", "ease-out", "ease-in-out"]
const ROW_PAD := 7.0
const HIT_PX := 8.0
const FADE_MS := 500.0
const SCALE_MAX := 4.0
const _POWERS := {"quad": 2.0, "cubic": 3.0, "quart": 4.0, "quint": 5.0}
const _ALIASES := {"easein": "easeinquad", "easeout": "easeoutquad", "easeinout": "easeinoutquad", "easeboth": "easeinoutquad"}


static func kfs(clip: Dictionary) -> Array:
	if not (clip.get("keyframes") is Array):
		clip["keyframes"] = []
	return clip.keyframes


## The keys of one property, by time (stable, like Array.prototype.sort).
static func of(clip: Dictionary, prop: String) -> Array:
	return _sorted((clip.get("keyframes", []) as Array).filter(func(k: Variant) -> bool:
		return k is Dictionary and str(k.get("property", "")) == prop) if clip.get("keyframes") is Array else [])


static func _sorted(a: Array) -> Array:
	var out := a.duplicate()
	for i in range(1, out.size()):  # insertion sort: stable
		var k: Variant = out[i]
		var j := i - 1
		while j >= 0 and float(out[j].time) > float(k.time):
			out[j + 1] = out[j]
			j -= 1
		out[j + 1] = k
	return out


static func _resort(clip: Dictionary) -> void:
	var s := _sorted(kfs(clip))
	kfs(clip).assign(s)  # in place: the canvas drag holds the keyframe by identity


## addKeyframe
static func add(clip: Dictionary, kf: Dictionary) -> Dictionary:
	var keep := kfs(clip).filter(func(k: Variant) -> bool:
		return not (k is Dictionary and str(k.get("property", "")) == str(kf.property) and float(k.time) == float(kf.time)))
	keep.append(kf)
	kfs(clip).assign(_sorted(keep))
	return kf


## removeKeyframe
static func remove(clip: Dictionary, prop: String, time: float) -> void:
	kfs(clip).assign(kfs(clip).filter(func(k: Variant) -> bool:
		return not (k is Dictionary and str(k.get("property", "")) == prop and absf(float(k.time) - time) < 0.5)))


## clearKeyframeRange (inclusive)
static func clear_range(clip: Dictionary, prop: String, from_ms: float, to_ms: float) -> void:
	kfs(clip).assign(kfs(clip).filter(func(k: Variant) -> bool:
		return not (k is Dictionary and str(k.get("property", "")) == prop and float(k.time) >= from_ms and float(k.time) <= to_ms)))


static func add_position(clip: Dictionary, time: float, fx: float, fy: float, easing := "linear") -> void:
	var t := maxf(0.0, time)
	add(clip, {"time": t, "property": "fill_x", "value": fx, "easing": easing})
	add(clip, {"time": t, "property": "fill_y", "value": fy, "easing": easing})


## addScaleKeyframe takes one value for both axes (scale = w / W), which squashes media that is not the canvas
## shape — here the y axis gets its own value (h / H) so a recorded key never changes the picture.
static func add_scale(clip: Dictionary, time: float, sx: float, sy: float, easing := "linear") -> void:
	var t := maxf(0.0, time)
	add(clip, {"time": t, "property": "scale_x", "value": clampf(sx, 0.0, SCALE_MAX), "easing": easing})
	add(clip, {"time": t, "property": "scale_y", "value": clampf(sy, 0.0, SCALE_MAX), "easing": easing})


## The partner of a fill / scale key (the pair is edited and removed together).
static func partner(prop: String) -> String:
	return {"fill_x": "fill_y", "fill_y": "fill_x", "scale_x": "scale_y", "scale_y": "scale_x"}.get(prop, "")


## Inspector `i`: fade in over the first 500 ms.
static func fade_in(clip: Dictionary) -> void:
	clear_range(clip, "opacity", 0.0, FADE_MS)
	add(clip, {"time": 0.0, "property": "opacity", "value": 0.0, "easing": "linear"})
	add(clip, {"time": FADE_MS, "property": "opacity", "value": 1.0, "easing": "linear"})


## `o`: fade out over the last 500 ms.
static func fade_out(clip: Dictionary) -> void:
	var dur := float(clip.get("duration", 0))
	var start := maxf(0.0, dur - FADE_MS)
	clear_range(clip, "opacity", start, dur + 1.0)
	add(clip, {"time": start, "property": "opacity", "value": 1.0, "easing": "linear"})
	add(clip, {"time": dur, "property": "opacity", "value": 0.0, "easing": "linear"})


## clampKeyframeDragTime: inside the clip, `min_gap` short of the same-property neighbours (no reordering).
static func clamp_drag_time(keys: Array, idx: int, new_time: float, dur: float, min_gap := 1.0) -> float:
	var hi_bound := maxf(0.0, dur)
	if idx < 0 or idx >= keys.size():
		return maxf(0.0, minf(new_time, hi_bound))
	var kf: Dictionary = keys[idx]
	var lo := 0.0
	var hi := hi_bound
	for i in keys.size():
		if i == idx or str(keys[i].property) != str(kf.property):
			continue
		if float(keys[i].time) <= float(kf.time):
			lo = maxf(lo, float(keys[i].time) + min_gap)
		else:
			hi = minf(hi, float(keys[i].time) - min_gap)
	if hi < lo:
		return float(kf.time)
	return maxf(lo, minf(new_time, hi))


## updateKeyframeTime: move in place, then re-sort. → true when the time changed.
static func move(clip: Dictionary, kf: Dictionary, new_time: float) -> bool:
	var idx := -1  # by identity: Array.find compares Dictionaries by value
	for i in kfs(clip).size():
		if is_same(kfs(clip)[i], kf):
			idx = i
	var t := clamp_drag_time(kfs(clip), idx, new_time, float(clip.get("duration", 999999)))
	if t == float(kf.time):
		return false
	kf["time"] = t
	_resort(clip)
	return true


## _lerp / _interpProp: `def` before the first key, the last value after the last, linear between.
static func interp(clip: Dictionary, ms: float, prop: String, def: float) -> float:
	var ks := of(clip, prop)
	if ks.is_empty():
		return def
	if ms >= float(ks[-1].time):
		return float(ks[-1].value)
	if ms < float(ks[0].time):
		return def
	for i in ks.size() - 1:
		var a: Dictionary = ks[i]
		var b: Dictionary = ks[i + 1]
		if ms >= float(a.time) and ms <= float(b.time):
			if float(b.time) == float(a.time):
				return float(b.value)
			return float(a.value) + (float(b.value) - float(a.value)) * (ms - float(a.time)) / (float(b.time) - float(a.time))
	return def


## What Caspar plays while the timeline runs: each segment tweened with its end key's easing.
static func eased(clip: Dictionary, ms: float, prop: String, def: float) -> float:
	var ks := of(clip, prop)
	for i in ks.size() - 1:
		var a: Dictionary = ks[i]
		var b: Dictionary = ks[i + 1]
		if ms >= float(a.time) and ms < float(b.time):
			var u := (ms - float(a.time)) / (float(b.time) - float(a.time))
			return float(a.value) + (float(b.value) - float(a.value)) * ease_curve(str(b.get("easing", "linear")), u)
	return interp(clip, ms, prop, def)


## The Caspar token for an easing (caspar-tween.js toCasparTween, without its validity table).
static func caspar_token(name: String) -> String:
	var key := name.strip_edges().to_lower().split(":")[0].replace("-", "").replace("_", "").replace(" ", "")
	return _ALIASES.get(key, key if key != "" else "linear")


## Penner curves of Caspar's tweener for the power and sine families; any other family previews as linear.
static func ease_curve(name: String, u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	var tok := caspar_token(name)
	var mode := ""
	for m in ["easeinout", "easeoutin", "easein", "easeout"]:
		if tok.begins_with(m):
			mode = m
			break
	if mode == "":
		return u
	var fam := tok.substr(mode.length())
	var f_in: Callable
	if _POWERS.has(fam):
		var p: float = _POWERS[fam]
		f_in = func(x: float) -> float: return pow(x, p)
	elif fam == "sine":
		f_in = func(x: float) -> float: return 1.0 - cos(x * PI / 2.0)
	else:
		return u
	var f_out := func(x: float) -> float: return 1.0 - f_in.call(1.0 - x)
	match mode:
		"easein":
			return f_in.call(u)
		"easeout":
			return f_out.call(u)
		"easeinout":
			return f_in.call(2.0 * u) / 2.0 if u < 0.5 else 0.5 + f_out.call(2.0 * u - 1.0) / 2.0
	return f_out.call(2.0 * u) / 2.0 if u < 0.5 else 0.5 + f_in.call(2.0 * u - 1.0) / 2.0


## clipPixelRectAtLocalTime on top of the base rect (fillPx / content fit) the inspector already resolves.
static func rect_at(clip: Dictionary, ms: float, base: Dictionary, canvas: Vector2) -> Dictionary:
	var w := canvas.x if canvas.x > 0 else 1920.0
	var h := canvas.y if canvas.y > 0 else 1080.0
	return {"x": interp(clip, ms, "fill_x", float(base.x) / w) * w, "y": interp(clip, ms, "fill_y", float(base.y) / h) * h,
		"w": interp(clip, ms, "scale_x", float(base.w) / w) * w, "h": interp(clip, ms, "scale_y", float(base.h) / h) * h}


## keyframeMarkerOffsetY: opacity / volume at value height inside the row, the rest on the bottom lane.
static func marker_y(kf: Dictionary, row_h: float) -> float:
	if str(kf.get("property", "")) in PROPS:
		return row_h - ROW_PAD - clampf(float(kf.get("value", 0)), 0.0, 1.0) * maxf(0.0, row_h - ROW_PAD * 2.0)
	return row_h - ROW_PAD


static func value_y(v: float, row_h: float) -> float:
	return row_h - ROW_PAD - clampf(v, 0.0, 1.0) * maxf(0.0, row_h - ROW_PAD * 2.0)


## hitTestKeyframeIndex: the nearest diamond within ±8 px, or −1. `x_at` maps timeline ms → canvas x.
static func hit(clip: Dictionary, row_y: float, row_h: float, p: Vector2, x_at: Callable) -> int:
	var ks: Array = clip.get("keyframes", []) if clip.get("keyframes") is Array else []
	if ks.is_empty() or row_h < 8:
		return -1
	var best := -1
	var best_d := INF
	for i in ks.size():
		var d := p - Vector2(x_at.call(float(clip.startTime) + float(ks[i].time)), row_y + marker_y(ks[i], row_h))
		if absf(d.x) > HIT_PX or absf(d.y) > HIT_PX:
			continue
		if d.length_squared() < best_d:
			best_d = d.length_squared()
			best = i
	return best


## collectKeyframeSnapCandidates (absolute ms): bounds, playhead, flags, every clip edge (its own too) and every
## other keyframe; the dragged one is excluded by identity.
static func snap_candidates(tl: Dictionary, now_pointer: Variant, ex_kf: Variant = null) -> Array:
	var out: Array = [0.0, float(tl.get("duration", 0))]
	if now_pointer != null:
		out.append(float(now_pointer))
	for f in tl.get("flags", []):
		if f is Dictionary:
			out.append(float(f.get("timeMs", 0)))
	for l in tl.get("layers", []):
		for c in l.get("clips", []):
			out.append(float(c.startTime))
			out.append(float(c.startTime) + float(c.duration))
			for k in (c.keyframes if c.get("keyframes") is Array else []):
				if not is_same(k, ex_kf):
					out.append(float(c.startTime) + float(k.time))
	return out


## The web's clip keyframe keys (timeline-editor-inputs.js CLIP_KEYFRAME_KEYS) on `clip`: i / o fade in / out, and at
## the playhead (clip-local, clamped to the clip) p position, s scale, v volume, t opacity — each recording the value
## the clip has there now. `base` = the clip's base rect (px). → false when `key` is none of them.
static func shortcut(clip: Dictionary, key: String, playhead_ms: float, base: Dictionary, canvas: Vector2) -> bool:
	if key == "i":
		fade_in(clip)
		return true
	if key == "o":
		fade_out(clip)
		return true
	if not key in ["p", "s", "v", "t"]:
		return false
	var t := minf(maxf(0.0, roundf(playhead_ms - float(clip.get("startTime", 0)))), float(clip.get("duration", 0)))
	var cw := canvas.x if canvas.x > 0 else 1920.0
	var ch := canvas.y if canvas.y > 0 else 1080.0
	var cur := rect_at(clip, t, base, Vector2(cw, ch))
	match key:
		"p":
			add_position(clip, t, cur.x / cw, cur.y / ch)
		"s":
			add_scale(clip, t, cur.w / cw, cur.h / ch)
		"v":
			var vol := float(clip.volume) if clip.get("volume") != null else 1.0
			add(clip, {"time": t, "property": "volume", "value": interp(clip, t, "volume", vol), "easing": "linear"})
		"t":
			add(clip, {"time": t, "property": "opacity", "value": interp(clip, t, "opacity", 1.0), "easing": "linear"})
	return true
