extends RefCounted
## WO-602 — timeline pure helpers, 1:1 ports (golden-tested): timecode (components/timeline-canvas-utils.js), track heights
## (lib/timeline-track-heights.js), view geometry + ruler ticks (timeline-canvas.js / -render.js / -wheel.js), the server
## tick clock (timeline-editor-playback.js) and the default model (lib/timeline-state-model.js). Same JSON as the web.

const RULER_H := 30
const HEADER_W := 112
const DEFAULT_LAYER_H := 54
const MIN_LAYER_H := 28
const MAX_LAYER_H := 120
const MIN_PX_MS := 0.0001
const MAX_PX_MS := 5.0
const ZOOM_FACTOR := 1.18
const NICE_INTERVALS := [50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000]
const CLIP_PALETTE := ["#1f6b36", "#0c5d8c", "#5a1e87", "#8c1a44", "#7a3100", "#005c54"]
const TICK_AHEAD_SNAP_MS := 80.0  # server ahead of the client by more → snap (seek / resume)
const TICK_LATENCY_MS := 35.0  # server this far behind the extrapolation → ignore (latency)


static func _frames(ms: float, fps: int) -> Array:
	var f := floori(ms * fps / 1000.0)
	return [f / (fps * 3600), (f % (fps * 3600)) / (fps * 60), (f % (fps * 60)) / fps, f % fps]


## fmtTimecode (ruler): drops leading zero groups
static func fmt_timecode(ms: float, fps := 25) -> String:
	var p := _frames(ms, fps if fps > 0 else 25)
	if p[0] > 0:
		return "%d:%02d:%02d:%02d" % p
	if p[1] > 0:
		return "%d:%02d:%02d" % [p[1], p[2], p[3]]
	return "%02d:%02d" % [p[2], p[3]]


## fmtSmpte (transport)
static func fmt_smpte(ms: float, fps := 25) -> String:
	return "%02d:%02d:%02d:%02d" % _frames(ms, fps if fps > 0 else 25)


## fmtHms: HH:MM:SS:mmm
static func fmt_hms(ms: float) -> String:
	var t := maxi(0, roundi(ms))
	return "%02d:%02d:%02d:%03d" % [t / 3600000, (t % 3600000) / 60000, (t % 60000) / 1000, t % 1000]


## Only 0-9 (after trimming) — String.is_valid_int() also takes a sign, which a timecode group never has.
static func is_digits(q: String) -> bool:
	var s := q.strip_edges()
	return RegEx.create_from_string("^\\d+$").search(s) != null


## parseTcInput: SMPTE (fewer groups allowed), ++N / --N offsets, plain ms; null when invalid.
static func parse_tc(s: String, current_ms: float, total_ms: Variant, fps := 25) -> Variant:
	var t := s.strip_edges()
	if t == "":
		return null
	var cap: float = float(total_ms) if total_ms != null else 999999999.0
	var off := RegEx.create_from_string("^([+-]{2})\\s*(\\d+)(?:ms)?$").search(t)
	if off != null:
		var sign := 1.0 if off.get_string(1) == "++" else -1.0
		return clampf(current_ms + sign * off.get_string(2).to_int(), 0.0, cap)
	var parts := t.split(":")
	for q in parts:
		if not is_digits(q):  # WO-839: digits only per group ("1:-5", "+3", "1e3" are gibberish → revert, never salvaged)
			return null
	var n: Array = Array(parts).map(func(q: String) -> int: return q.to_int())
	match n.size():
		4:
			return float((n[0] * 3600 + n[1] * 60 + n[2]) * fps + n[3]) * 1000.0 / fps
		3:
			return float((n[0] * 60 + n[1]) * fps + n[2]) * 1000.0 / fps
		2:
			return float(n[0] * fps + n[1]) * 1000.0 / fps
		1:
			return float(n[0]) if n[0] >= 0 else null
	return null


## ensureLayerHeights (mutates tl): missing / invalid / below-min → default; above max → max.
static func ensure_heights(tl: Dictionary) -> void:
	var n: int = (tl.get("layers", []) as Array).size() if tl.get("layers") is Array else 0
	var hs: Array = tl.get("layerHeights", []) if tl.get("layerHeights") is Array else []
	while hs.size() < n:
		hs.append(DEFAULT_LAYER_H)
	hs.resize(n)
	for i in n:
		var h: Variant = hs[i]
		var v := float(h) if h is float or h is int else NAN
		hs[i] = DEFAULT_LAYER_H if is_nan(v) or v < MIN_LAYER_H else mini(MAX_LAYER_H, maxi(MIN_LAYER_H, roundi(v)))
	tl["layerHeights"] = hs


static func layer_h(tl: Dictionary, li: int) -> int:
	ensure_heights(tl)
	return int(tl.layerHeights[li]) if li >= 0 and li < (tl.layerHeights as Array).size() else DEFAULT_LAYER_H


static func track_top(tl: Dictionary, li: int, scroll_y: float, ruler_h := RULER_H) -> float:
	ensure_heights(tl)
	var y := float(ruler_h)
	for i in li:
		y += layer_h(tl, i)
	return y - scroll_y


static func total_height(tl: Dictionary) -> int:
	ensure_heights(tl)
	var s := 0
	for h in tl.layerHeights:
		s += int(h)
	return s


## layerIndexAtCanvasY: below all tracks → n (the "+ drop here" row)
static func layer_at_y(tl: Dictionary, y: float, scroll_y: float, ruler_h := RULER_H) -> int:
	ensure_heights(tl)
	var n: int = (tl.layers as Array).size()
	var top := ruler_h - scroll_y
	for i in n:
		var th := layer_h(tl, i)
		if y >= top and y < top + th:
			return i
		top += th
	if n <= 0:
		return 0
	return n if y >= top else n - 1


## hitLayerDivider → divider index above layer i+1, or -1
static func hit_divider(tl: Dictionary, y: float, scroll_y: float, ruler_h := RULER_H, hit_px := 5.0) -> int:
	if y < ruler_h:
		return -1
	ensure_heights(tl)
	var n: int = (tl.layers as Array).size()
	if n < 2:
		return -1
	var top := ruler_h - scroll_y
	for i in n - 1:
		top += layer_h(tl, i)
		if absf(y - top) <= hit_px:
			return i
	return -1


## Ruler: the first "nice" interval ≥ 55 px.
static func ruler_interval(px_per_ms: float) -> int:
	var raw := 55.0 / px_per_ms
	for n in NICE_INTERVALS:
		if n >= raw:
			return n
	return 300000


static func x_at(ms: float, px_per_ms: float, scroll_x: float) -> float:
	return HEADER_W + (ms - scroll_x) * px_per_ms


static func ms_at(x: float, px_per_ms: float, scroll_x: float) -> float:
	return (x - HEADER_W) / px_per_ms + scroll_x


static func zoom(px_per_ms: float, dir: int) -> float:
	return clampf(px_per_ms * (ZOOM_FACTOR if dir > 0 else 1.0 / ZOOM_FACTOR), MIN_PX_MS, MAX_PX_MS)


## applyServerTick: clock = {pos, at} (server ms + local time of that position) → new clock.
static func apply_tick(clock: Dictionary, server_ms: float, now_ms: float) -> Dictionary:
	var extrapolated := float(clock.get("pos", 0.0)) + (now_ms - float(clock.get("at", now_ms)))
	var pos := extrapolated
	if server_ms - extrapolated > TICK_AHEAD_SNAP_MS or server_ms >= extrapolated - TICK_LATENCY_MS:
		pos = server_ms
	return {"pos": pos, "at": now_ms}


static func clock_ms(clock: Dictionary, now_ms: float) -> float:
	return float(clock.get("pos", 0.0)) + (now_ms - float(clock.get("at", now_ms)))


## hitClip
static func hit_clip(tl: Dictionary, li: int, ms: float) -> Dictionary:
	if li < 0 or li >= (tl.get("layers", []) as Array).size():
		return {}
	for c in tl.layers[li].get("clips", []):
		if ms >= float(c.startTime) and ms < float(c.startTime) + float(c.duration):
			return c
	return {}


## uid(): 't' + base36 ms + 3 random base36 chars
static func uid() -> String:
	var chars := "0123456789abcdefghijklmnopqrstuvwxyz"
	var n := int(Time.get_unix_time_from_system() * 1000.0)
	var s := ""
	while n > 0:
		s = chars[n % 36] + s
		n /= 36
	for i in 3:
		s += chars[randi() % 36]
	return "t" + s


## defaultTimeline (+ ensureLayerHeights, as createTimeline does)
static func default_timeline(name := "Timeline") -> Dictionary:
	var tl := {"id": uid(), "name": name, "duration": 30000, "fps": 25, "flags": [],
		"sendTo": {"preview": true, "program": false, "screenIdx": 0},
		"layers": [{"id": uid(), "name": "Layer 1", "clips": []}, {"id": uid(), "name": "Layer 2", "clips": []}, {"id": uid(), "name": "Layer 3", "clips": []}]}
	ensure_heights(tl)
	return tl
