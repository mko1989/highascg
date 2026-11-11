extends RefCounted
## WO-1039 MVR — pure port of PixelHue Studio's public/mvr-geometry.js, the geometry half of public/editor.js
## (fit, dragWindow) and placeWindow from public/mvr-sources.js. No autoloads; every function is static.
## A window is {x, y, width, height} (ints, output pixels); a layer is a normalised Studio layer (mvr_model.gd).
## Where Studio throws, these return {"error": "<Studio's sentence>"}. "No limit" is an empty Dictionary.

const MIN := 64
## Owner rule (WO-028): on P10/P20 an MVR window showing an input (sourceType 2) must not exceed 512 × 480.
const INPUT_WINDOW_LIMIT := {"P10": {"width": 512, "height": 480}, "P20": {"width": 512, "height": 480}}


## JavaScript Math.round (halves go up, also for negatives).
static func jround(v: float) -> int:
	return int(floor(v + 0.5))


static func win(x: float, y: float, width: float, height: float) -> Dictionary:
	return {"x": int(x), "y": int(y), "width": int(width), "height": int(height)}


static func overlaps(a: Dictionary, b: Dictionary) -> bool:
	return int(a.x) < int(b.x) + int(b.width) and int(b.x) < int(a.x) + int(a.width) \
		and int(a.y) < int(b.y) + int(b.height) and int(b.y) < int(a.y) + int(a.height)


static func has_overlap(layers: Array) -> bool:
	for i in layers.size():
		for j in range(i + 1, layers.size()):
			var a: Dictionary = layers[i]
			var b: Dictionary = layers[j]
			if a.get("screenId") == b.get("screenId") and overlaps(a.window, b.window):
				return true
	return false


static func can_place(layer: Dictionary, window: Dictionary, layers: Array) -> bool:
	for o in layers:
		var other: Dictionary = o
		if other.get("id") != layer.get("id") and other.get("screenId") == layer.get("screenId") and overlaps(window, other.window):
			return false
	return true


## The signal (input timing or PGM/PVW screen size) a layer shows; {} when none. Input signals carry no sourceType (= 2).
static func source_signal(layer: Dictionary, signals: Array) -> Dictionary:
	for s in signals:
		var sig: Dictionary = s
		var st: Variant = sig.get("sourceType")
		if sig.get("id") == layer.get("sourceId") and (2 if st == null else st) == layer.get("sourceType"):
			return sig
	return {}


## Content ratio check: the video area (height minus the UMD strip) matches `ratio` within one pixel. Unknown UMD → false.
static func matches_ratio(window: Dictionary, ratio: float, umd: Variant = 0) -> bool:
	if umd == null:
		return false
	var u := float(umd)
	return float(window.height) > u and absf(float(window.height) - u - float(window.width) / ratio) <= 1.0


## Largest {width, height} with content ratio `ratio` (+ UMD strip) inside max; {} when impossible. desired < 0 = max.
static func ratio_size(ratio: float, max_w: float, max_h: float, desired: float = -1.0, umd: Variant = 0) -> Dictionary:
	if desired < 0:
		desired = max_w
	if is_nan(ratio) or is_inf(ratio) or ratio <= 0 or umd == null or max_h <= float(umd):
		return {}
	var u := float(umd)
	var width := float(mini(jround(desired), int(floor(max_w)) if not is_inf(max_w) else jround(desired)))
	var height := float(jround(width / ratio)) + u
	if height > max_h:
		height = floor(max_h)
		width = float(jround((height - u) * ratio))
	if width < MIN or height < MIN or width > max_w or height > max_h or height <= u:
		return {}
	return {"width": int(width), "height": int(height)}


static func _bound(v: float, lo: float, hi: float) -> int:
	return int(maxf(lo, minf(hi, float(jround(v)))))


## editor.js fit: at least 64 × 64, inside the output.
static func fit(window: Dictionary, screen: Dictionary) -> Dictionary:
	var sw := float(screen.width)
	var sh := float(screen.height)
	var width := _bound(float(window.width), MIN, sw)
	var height := _bound(float(window.height), MIN, sh)
	return win(_bound(float(window.x), 0, sw - width), _bound(float(window.y), 0, sh - height), width, height)


## editor.js dragWindow: handle "" moves; "nw"/"ne"/"sw"/"se" resizes from the opposite corner. lock = content ratio
## (0 = unlocked); umd may be null (unknown); max = per-window size cap ({} = none).
static func drag_window(original: Dictionary, dx: float, dy: float, screen: Dictionary, handle: String, snap: int = 1,
		lock: float = 0.0, umd: Variant = 0, max_size: Dictionary = {}) -> Dictionary:
	var s := float(maxi(snap, 1))
	var ox := float(original.x)
	var oy := float(original.y)
	var ow := float(original.width)
	var oh := float(original.height)
	if handle == "":
		return fit(win(jround((ox + dx) / s) * s, jround((oy + dy) / s) * s, ow, oh), screen)
	var left := handle.contains("w")
	var top := handle.contains("n")
	var ax := ox + ow if left else ox
	var ay := oy + oh if top else oy
	var limit_w := minf(ax if left else float(screen.width) - ax, float(max_size.get("width", INF)))
	var limit_h := minf(ay if top else float(screen.height) - ay, float(max_size.get("height", INF)))
	var width := float(_bound(jround((ow + (-dx if left else dx)) / s) * s, MIN, limit_w))
	var height := float(_bound(jround((oh + (-dy if top else dy)) / s) * s, MIN, limit_h))
	if lock > 0:
		var u := 0.0 if umd == null else float(umd)
		var desired := maxf(maxf(float(MIN), ceilf(maxf(1.0, MIN - u) * lock)), maxf(width, (height - u) * lock))
		var size := ratio_size(lock, limit_w, limit_h, desired, umd)
		if size.is_empty():
			return original.duplicate()
		width = float(size.width)
		height = float(size.height)
	return win(ax - width if left else ax, ay - height if top else ay, width, height)


static func _nearby_space(layer: Dictionary, size: Dictionary, layers: Array, screen: Dictionary) -> Dictionary:
	var w: Dictionary = layer.window
	var sw := float(size.width)
	var sh := float(size.height)
	var wanted_x := float(w.x) + (float(w.width) - sw) / 2.0
	var wanted_y := float(w.y) + (float(w.height) - sh) / 2.0
	var xs: Array = [wanted_x, 0.0, float(screen.width) - sw]
	var ys: Array = [wanted_y, 0.0, float(screen.height) - sh]
	for o in layers:
		var other: Dictionary = o
		if other.get("id") == layer.get("id") or other.get("screenId") != layer.get("screenId"):
			continue
		xs.append_array([float(other.window.x) - sw, float(other.window.x + other.window.width)])
		ys.append_array([float(other.window.y) - sh, float(other.window.y + other.window.height)])
	var best: Dictionary = {}
	var best_d := INF
	# Studio sorts every candidate by distance (stable) and takes the first free one: the first strictly nearer one wins.
	for x in xs:
		for y in ys:
			var c := win(maxf(0, minf(float(screen.width) - sw, float(jround(x)))), maxf(0, minf(float(screen.height) - sh, float(jround(y)))), sw, sh)
			var d := pow(float(c.x) - wanted_x, 2) + pow(float(c.y) - wanted_y, 2)
			if d < best_d and can_place(layer, c, layers):
				best = c
				best_d = d
	return best


## Order geometry writes so that no intermediate state overlaps → {"ordered": [...]} or {"error": …}.
static func order_geometry_changes(layers: Array, changes: Array) -> Dictionary:
	var current: Array = layers.duplicate(true)
	var pending: Array = changes.duplicate()
	var ordered: Array = []
	while not pending.is_empty():
		var index := -1
		for i in pending.size():
			var change: Dictionary = pending[i]
			var layer := _find(current, change.id)
			if not layer.is_empty() and can_place(layer, change.window, current):
				index = i
				break
		if index < 0:
			return {"error": "These moves would overlap during application. Move one window into free space and apply before swapping positions."}
		var next: Dictionary = pending.pop_at(index)
		_find(current, next.id).window = next.window
		ordered.append(next)
	return {"ordered": ordered}


static func _find(layers: Array, id: Variant) -> Dictionary:
	for l in layers:
		if (l as Dictionary).get("id") == id:
			return l
	return {}


static func _min_desired(ratio: float, offset: float) -> float:
	return maxf(MIN, ceilf(maxf(1.0, MIN - offset) * ratio))


## Fit every window's video area to its source ratio (UMD included), locked → {layers, fixed, skipped} or {error}.
static func fix_aspect_ratios(layers: Array, signals: Array, screen: Dictionary) -> Dictionary:
	if has_overlap(layers):
		return {"error": "Resolve the existing window overlaps before fixing aspect ratios."}
	var result: Array = layers.duplicate(true)
	var fixed: Array = []
	var skipped: Array = []
	var needs_space: Array = []
	for l in result:
		var layer: Dictionary = l
		var sig := source_signal(layer, signals)
		if sig.is_empty() or sig.get("connected") != true or not _positive(sig.get("width")) or not _positive(sig.get("height")):
			skipped.append({"id": layer.id, "reason": "No connected input or valid screen resolution"})
			continue
		if layer.get("umdHeight") == null:
			skipped.append({"id": layer.id, "reason": "UMD height unavailable from device configuration"})
			continue
		var offset := float(layer.umdHeight)
		var ratio := float(sig.width) / float(sig.height)
		var w: Dictionary = layer.window
		var size := ratio_size(ratio, float(w.width), float(w.height), float(w.width), offset)
		if size.is_empty():
			needs_space.append([layer, ratio])
			continue
		layer.window = win(int(w.x) + int(floor((float(w.width) - size.width) / 2.0)), int(w.y) + int(floor((float(w.height) - size.height) / 2.0)), size.width, size.height)
		layer.aspectLock = ratio
		layer.aspectMode = 5 if offset > 0 else 8
		fixed.append(layer.id)
	for item in needs_space:
		var layer: Dictionary = item[0]
		var ratio: float = item[1]
		var offset := float(layer.umdHeight)
		var size := {} if screen.is_empty() else ratio_size(ratio, float(screen.width), float(screen.height), _min_desired(ratio, offset), offset)
		var spot := {} if size.is_empty() else _nearby_space(layer, size, result, screen)
		if spot.is_empty():
			skipped.append({"id": layer.id, "reason": "No free space for this ratio at the 64 px minimum"})
			continue
		layer.window = spot
		layer.aspectLock = ratio
		layer.aspectMode = 5 if offset > 0 else 8
		fixed.append(layer.id)
	if has_overlap(result):
		return {"error": "A non-overlapping aspect correction could not be found."}
	return {"layers": result, "fixed": fixed, "skipped": skipped}


static func _positive(v: Variant) -> bool:
	return (v is int or v is float) and float(v) > 0


## WO-028 limit for a window showing `source_type` on `model`; {} = none (screens, Q8).
static func window_limit(model: Variant, source_type: Variant) -> Dictionary:
	if source_type != 2 or not INPUT_WINDOW_LIMIT.has(str(model)):
		return {}
	return (INPUT_WINDOW_LIMIT[str(model)] as Dictionary).duplicate()


static func within_limit(window: Dictionary, limit: Dictionary) -> bool:
	return limit.is_empty() or (int(window.width) <= int(limit.width) and int(window.height) <= int(limit.height))


## A change grows past the limit when a dimension exceeds it AND is larger than before (shrinking/moving stays allowed).
static func grows_past_limit(next: Dictionary, before: Dictionary, limit: Dictionary) -> bool:
	if limit.is_empty():
		return false
	var bw := int(before.get("width", 0))
	var bh := int(before.get("height", 0))
	return (int(next.width) > int(limit.width) and int(next.width) > bw) or (int(next.height) > int(limit.height) and int(next.height) > bh)


## Largest window inside the limit, top-left kept; a locked window keeps its content ratio (UMD included).
static func shrink_to_limit(window: Dictionary, limit: Dictionary, lock: float = 0.0, umd: Variant = 0) -> Dictionary:
	if within_limit(window, limit):
		return window
	if lock > 0:
		var size := ratio_size(lock, float(limit.width), float(limit.height), float(limit.width), 0 if umd == null else umd)
		if not size.is_empty():
			return win(window.x, window.y, size.width, size.height)
	return win(window.x, window.y, mini(int(window.width), int(limit.width)), mini(int(window.height), int(limit.height)))


## mvr-sources.js placeWindow: a free rectangle for a new source near `point` (Vector2 in output pixels, or null =
## the centre), a quarter of the output wide, shrinking 20 % per try; {} when the output has no room.
static func place_window(source: Dictionary, screen: Dictionary, layers: Array, point: Variant = null, limit: Dictionary = {}) -> Dictionary:
	var ratio := float(source.width) / float(source.height) if _positive(source.get("width")) and _positive(source.get("height")) else 16.0 / 9.0
	var offset: Variant = source.get("umdHeight", 0)
	var sw := float(screen.width)
	var sh := float(screen.height)
	var width := float(jround(sw / 4.0))
	if not limit.is_empty():
		width = minf(width, float(limit.width))
	var at: Vector2 = point if point is Vector2 else Vector2(sw / 2.0, sh / 2.0)
	var attempt := 0
	while attempt < 12 and width >= MIN:
		var size := ratio_size(ratio, minf(sw, float(limit.get("width", INF))), minf(sh, float(limit.get("height", INF))), width, offset)
		if not size.is_empty():
			width = float(size.width)
			var height := float(size.height)
			var first := win(maxf(0, minf(sw - width, float(jround(at.x - width / 2.0)))), maxf(0, minf(sh - height, float(jround(at.y - height / 2.0)))), width, height)
			if _free(first, layers):
				return first
			var best: Dictionary = {}
			var best_d := INF
			var y := 0
			while y + height <= sh:
				var x := 0
				while x + width <= sw:
					var c := win(x, y, width, height)
					var d := Vector2(float(x) - float(first.x), float(y) - float(first.y)).length()
					if d < best_d and _free(c, layers):
						best = c
						best_d = d
					x += 8
				y += 8
			if not best.is_empty():
				return best
		attempt += 1
		width = float(jround(width * 0.8))
	return {}


static func _free(w: Dictionary, layers: Array) -> bool:
	for l in layers:
		if overlaps(w, (l as Dictionary).window):
			return false
	return true
