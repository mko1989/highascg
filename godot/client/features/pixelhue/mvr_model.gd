extends RefCounted
## WO-1039 MVR — pure logic of PixelHue Studio's MVR tab (public/app.js MVR parts, editor.js, mvr-reconcile.js,
## mvr-sources.js, mvr-templates.js): state normalising, pending changes, readback reconcile, undo stack, edit
## validation, request bodies (PUT /api/windows, /api/mvr-layers, /api/mvr-templates — lib/pixelhue.js validateChanges,
## lib/mvr-layers.js, lib/mvr-templates.js) and labels. No autoloads; static functions; Studio's sentences verbatim.

const G := preload("res://features/pixelhue/mvr_geometry.gd")
const KEYS := ["x", "y", "width", "height"]
const UNDO_MAX := 100


# ---- state -------------------------------------------------------------------------------------------------------

static func _int_or_null(v: Variant) -> Variant:
	return int(v) if (v is int or v is float) else null


## Studio's GET /api/state (or a write's readback) → the same shape with ints where Studio has integers.
static func normalize_state(data: Dictionary) -> Dictionary:
	var out: Dictionary = data.duplicate(true)
	var screens: Array = []
	for s in data.get("screens", []) if data.get("screens") is Array else []:
		if s is Dictionary:
			screens.append({"id": int(s.get("id", 0)), "name": str(s.get("name", "Multiviewer")), "width": int(s.get("width", 1920)),
				"height": int(s.get("height", 1080)), "dimensionsAssumed": s.get("dimensionsAssumed") == true})
	out.screens = screens
	var layers: Array = []
	for l in data.get("layers", []) if data.get("layers") is Array else []:
		if l is Dictionary and l.get("window") is Dictionary:
			var w: Dictionary = l.window
			var lock: Variant = l.get("aspectLock")
			layers.append({"id": int(l.get("id", 0)), "screenId": int(l.get("screenId", 0)), "name": str(l.get("name", "")),
				"source": str(l.get("source", "")), "window": G.win(int(w.get("x", 0)), int(w.get("y", 0)), int(w.get("width", 0)), int(w.get("height", 0))),
				"sourceId": _int_or_null(l.get("sourceId")), "sourceType": _int_or_null(l.get("sourceType")),
				"umdHeight": _int_or_null(l.get("umdHeight")), "aspectMode": int(l.get("aspectMode", 5)),
				"aspectLock": float(lock) if (lock is int or lock is float) else null})
	out.layers = layers
	var signals: Array = []
	for s in data.get("signals", []) if data.get("signals") is Array else []:
		if s is Dictionary:
			var sig := {"id": _int_or_null(s.get("id")), "connected": s.get("connected") == true,
				"width": _int_or_null(s.get("width")), "height": _int_or_null(s.get("height"))}
			if s.get("sourceType") != null:
				sig.sourceType = _int_or_null(s.get("sourceType"))
			signals.append(sig)
	out.signals = signals
	var sources: Array = []
	for s in data.get("sources", []) if data.get("sources") is Array else []:
		if s is Dictionary:
			sources.append({"type": int(s.get("type", 0)), "id": int(s.get("id", 0)), "name": str(s.get("name", "")),
				"width": _int_or_null(s.get("width")), "height": _int_or_null(s.get("height")),
				"umdHeight": _int_or_null(s.get("umdHeight")), "usedBy": _int_or_null(s.get("usedBy"))})
	out.sources = sources
	return out


static func screen_of(state: Dictionary, screen_id: int) -> Dictionary:
	for s in state.get("screens", []):
		if int(s.id) == screen_id:
			return s
	return {}


static func layer_of(state: Dictionary, id: int) -> Dictionary:
	for l in state.get("layers", []):
		if int(l.id) == id:
			return l
	return {}


static func windows_of(state: Dictionary, screen_id: int) -> Array:
	return state.get("layers", []).filter(func(l: Dictionary) -> bool: return int(l.screenId) == screen_id)


static func same_window(a: Dictionary, b: Dictionary) -> bool:
	if a.is_empty() or b.is_empty():
		return false
	for k in KEYS:
		if int(a.get(k, -1)) != int(b.get(k, -2)):
			return false
	return true


static func _same_lock(a: Variant, b: Variant) -> bool:
	if a == null or b == null:
		return a == null and b == null
	return float(a) == float(b)


## mvr-reconcile.js sameEdit: same rectangle, lock and mode.
static func same_edit(a: Dictionary, b: Dictionary) -> bool:
	return not a.is_empty() and not b.is_empty() and same_window(a.window, b.window) \
		and _same_lock(a.get("aspectLock"), b.get("aspectLock")) and int(a.get("aspectMode", 5)) == int(b.get("aspectMode", 5))


## The pending edits: every layer whose geometry or lock differs from the last confirmed device state.
static func changes(state: Dictionary, base: Dictionary) -> Array:
	var out: Array = []
	if state.is_empty():
		return out
	for l in state.get("layers", []):
		if not same_edit(l, layer_of(base, int(l.id))):
			out.append({"id": int(l.id), "window": (l.window as Dictionary).duplicate(), "aspectLock": l.get("aspectLock"), "aspectMode": int(l.get("aspectMode", 5))})
	return out


## mvr-reconcile.js: take the device's readback, but keep local edits made after `sent` left (newer than what was sent).
static func reconcile(local: Dictionary, base: Dictionary, next: Dictionary, sent: Array) -> Dictionary:
	var merged: Dictionary = next.duplicate(true)
	var submitted := {}
	for s in sent:
		submitted[int(s.id)] = s
	for actual in merged.get("layers", []):
		var current := layer_of(local, int(actual.id))
		var previous: Dictionary = submitted.get(int(actual.id), layer_of(base, int(actual.id)))
		if not current.is_empty() and not same_edit(current, previous):
			actual.window = (current.window as Dictionary).duplicate()
			actual.aspectLock = current.get("aspectLock")
			actual.aspectMode = current.get("aspectMode", 5)
	return merged


## Undo snapshot: every layer's geometry and lock.
static func geometry(state: Dictionary) -> Array:
	var out: Array = []
	for l in state.get("layers", []):
		out.append({"id": int(l.id), "window": (l.window as Dictionary).duplicate(), "aspectLock": l.get("aspectLock"), "aspectMode": int(l.get("aspectMode", 5))})
	return out


static func restore(state: Dictionary, layout: Array) -> void:
	for item in layout:
		var layer := layer_of(state, int(item.id))
		if not layer.is_empty():
			layer.window = (item.window as Dictionary).duplicate()
			layer.aspectLock = item.get("aspectLock")
			layer.aspectMode = int(item.get("aspectMode", 5)) if item.get("aspectMode") != null else 5


# ---- undo / redo (app.js remember / undo / redo; 100 steps) -------------------------------------------------------

static func new_stack() -> Dictionary:
	return {"undo": [], "redo": []}


static func remember(stack: Dictionary, before: Array) -> void:
	stack.undo.append(before)
	if stack.undo.size() > UNDO_MAX:
		stack.undo.pop_front()
	stack.redo = []


## Undo (redo = false) or redo: pushes `current` on the other stack and returns the layout to restore ([] = nothing).
static func step(stack: Dictionary, current: Array, redo := false) -> Array:
	var from: Array = stack.redo if redo else stack.undo
	if from.is_empty():
		return []
	(stack.undo if redo else stack.redo).append(current)
	return from.pop_back()


# ---- edits --------------------------------------------------------------------------------------------------------

static func lock_of(layer: Dictionary) -> float:
	var v: Variant = layer.get("aspectLock")
	return float(v) if v != null else 0.0


## app.js edit(): fit, input-window limit, no overlap, locked ratio → {} (no change), {error}, or {window[, notice]}.
static func edit(state: Dictionary, layer: Dictionary, screen: Dictionary, window: Dictionary) -> Dictionary:
	if layer.is_empty() or screen.is_empty() or same_window(window, layer.window):
		return {}
	var limit := G.window_limit(state.get("device", {}).get("model"), layer.get("sourceType"))
	var next := G.fit(window, screen)
	var out := {}
	if G.grows_past_limit(next, layer.window, limit):
		next = G.shrink_to_limit(next, limit, lock_of(layer), layer.get("umdHeight"))
		out.notice = "Input windows are limited to %d × %d on %s (glitch-free size). Resized to %d × %d." % [limit.width, limit.height, str(state.device.model), next.width, next.height]
	if not G.can_place(layer, next, state.get("layers", [])):
		return {"error": "MVR windows cannot overlap. Choose a smaller size or a free position."}
	var resized: bool = next.width != layer.window.width or next.height != layer.window.height
	if resized and lock_of(layer) > 0 and not G.matches_ratio(next, lock_of(layer), layer.get("umdHeight")):
		return {"error": "This size cannot fit while keeping the locked aspect ratio."}
	out.window = next
	return out


## A typed X / Y / Width / Height → the requested window (before edit()), {error} when it cannot be.
static func numeric(state: Dictionary, layer: Dictionary, screen: Dictionary, key: String, text: String) -> Dictionary:
	var t := text.strip_edges()
	if t == "" or not t.is_valid_int():
		return {"error": "Enter a whole number of pixels."}
	var value := t.to_int()
	var next: Dictionary = (layer.window as Dictionary).duplicate()
	next[key] = value
	var ratio := lock_of(layer)
	if ratio > 0 and (key == "width" or key == "height"):
		var offset: Variant = layer.get("umdHeight")
		var off := 0.0 if offset == null else float(offset)
		var desired := float(value) if key == "width" else (value - off) * ratio
		var limit := G.window_limit(state.get("device", {}).get("model"), layer.get("sourceType"))
		var size := G.ratio_size(ratio, minf(float(screen.width - next.x), float(limit.get("width", INF))),
			minf(float(screen.height - next.y), float(limit.get("height", INF))), maxf(maxf(64.0, ceilf(maxf(1.0, 64.0 - off) * ratio)), desired), offset)
		if size.is_empty():
			return {"error": "No room for this locked aspect ratio at the minimum window size."}
		next.width = size.width
		next.height = size.height
	return {"window": next}


static func center_x(window: Dictionary, screen: Dictionary) -> Dictionary:
	var w := window.duplicate()
	w.x = G.jround((float(screen.width) - float(window.width)) / 2.0)
	return w


static func center_y(window: Dictionary, screen: Dictionary) -> Dictionary:
	var w := window.duplicate()
	w.y = G.jround((float(screen.height) - float(window.height)) / 2.0)
	return w


## Arrow keys: 1 px, Shift 10 px.
static func nudge(window: Dictionary, dir: Vector2i, shift: bool) -> Dictionary:
	var amount := 10 if shift else 1
	var w := window.duplicate()
	w.x = int(w.x) + dir.x * amount
	w.y = int(w.y) + dir.y * amount
	return w


## While resizing, never grow past the limit; a window already larger can only shrink (cap = its start size).
static func drag_limit(limit: Dictionary, start: Dictionary) -> Dictionary:
	if limit.is_empty():
		return {}
	return {"width": maxi(int(limit.width), int(start.width)), "height": maxi(int(limit.height), int(start.height))}


## Keep aspect ratio checkbox → {aspectLock, aspectMode} or {error}. The lock is the content ratio (UMD excluded).
static func aspect_toggle(layer: Dictionary, on: bool) -> Dictionary:
	if on and layer.get("umdHeight") == null:
		return {"error": "UMD height is unavailable. Reconnect to read device configuration before locking the content ratio."}
	var off := 0.0 if layer.get("umdHeight") == null else float(layer.umdHeight)
	return {"aspectLock": float(layer.window.width) / (float(layer.window.height) - off) if on else null, "aspectMode": 5}


# ---- request bodies (the server adds `session`) -------------------------------------------------------------------

## PUT /api/windows.
static func windows_body(pending: Array) -> Dictionary:
	var list: Array = []
	for c in pending:
		list.append({"id": int(c.id), "window": G.win(c.window.x, c.window.y, c.window.width, c.window.height),
			"aspectLock": c.get("aspectLock"), "aspectMode": int(c.get("aspectMode", 5))})
	return {"changes": list}


static func create_body(screen_id: int, source: Dictionary, window: Dictionary) -> Dictionary:
	return {"screenId": screen_id, "action": "create", "source": {"type": int(source.type), "id": int(source.id)}, "window": window}


static func source_body(screen_id: int, layer_id: int, key: String) -> Dictionary:
	return {"screenId": screen_id, "action": "source", "layerId": layer_id, "source": parse_key(key)}


static func delete_body(screen_id: int, layer_id: int) -> Dictionary:
	return {"screenId": screen_id, "action": "delete", "layerId": layer_id}


## PUT /api/mvr-templates: applying replaces every window of the output (asked first).
static func template_body(screen_id: int, key: String) -> Dictionary:
	var k := parse_key(key)
	return {"screenId": screen_id, "templateId": k.id, "type": k.type, "confirmReplace": true}


static func source_key(type: Variant, id: Variant) -> String:
	return "%d:%d" % [int(type), int(id)]


static func parse_key(key: String) -> Dictionary:
	var parts := key.split(":")
	return {"type": parts[0].to_int() if parts.size() > 0 else 0, "id": parts[1].to_int() if parts.size() > 1 else 0}


static func find_source(state: Dictionary, key: String) -> Dictionary:
	for s in state.get("sources", []):
		if source_key(s.type, s.id) == key:
			return s
	return {}


## Drop or double-click of an unused source → {body, success} for PUT /api/mvr-layers, or {error}.
static func add_source(state: Dictionary, screen_id: int, source: Dictionary, point: Variant = null) -> Dictionary:
	if source.get("umdHeight") == null:
		return {"error": "UMD height is unavailable. Reconnect to read device configuration before dropping this source."}
	var screen := screen_of(state, screen_id)
	if screen.is_empty():
		return {"error": "Choose a current MVR output."}
	var window := G.place_window(source, screen, windows_of(state, screen_id), point, G.window_limit(state.get("device", {}).get("model"), source.type))
	if window.is_empty():
		return {"error": "No free space in this MVR output. Shrink or delete a window first."}
	return {"body": create_body(screen_id, source, window), "success": "%s added to the MVR." % str(source.name)}


# ---- labels -------------------------------------------------------------------------------------------------------

static func source_label(layer: Dictionary) -> String:
	var t: Variant = layer.get("sourceType")
	return (str(layer.get("source", "")) + (" PGM" if t == 3 else " PVW" if t == 4 else "")).strip_edges()


static func row_label(layer: Dictionary) -> String:
	var s := source_label(layer)
	return s if s != "" else str(layer.get("name", ""))


static func size_label(w: Dictionary) -> String:
	return "%d × %d" % [int(w.width), int(w.height)]


static func source_meta(source: Dictionary) -> String:
	if source.get("usedBy") != null:
		return "In MVR"
	if source.get("width") != null and int(source.width) > 0:
		return "%d × %d" % [int(source.width), int(source.height)]
	return "No signal"


## The selected window's Source menu: [[label, key]…] (sources in use elsewhere left out) and the selected index;
## a current source missing from the list shows as the first entry with key "".
static func source_options(sources: Array, layer: Dictionary) -> Dictionary:
	var items: Array = []
	var want := source_key(layer.get("sourceType", 0) if layer.get("sourceType") != null else 0, layer.get("sourceId", 0) if layer.get("sourceId") != null else 0)
	var index := -1
	for s in sources:
		if s.get("usedBy") != null and int(s.usedBy) != int(layer.id):
			continue
		if source_key(s.type, s.id) == want:
			index = items.size()
		items.append([str(s.name), source_key(s.type, s.id)])
	if index < 0:
		var label := str(layer.get("source", ""))
		items.push_front([label if label != "" else "Current source", ""])
		index = 0
	return {"items": items, "index": index}


static func aspect_info(layer: Dictionary, signals: Array) -> String:
	var parts: Array = []
	var sig := G.source_signal(layer, signals)
	if sig.get("connected") == true:
		parts.append("%s %d × %d" % ["Input" if layer.get("sourceType") == 2 else "Screen", int(sig.width), int(sig.height)])
	if layer.get("umdHeight") == null:
		parts.append("UMD height unavailable")
	elif int(layer.umdHeight) > 0:
		parts.append("UMD %d px" % int(layer.umdHeight))
	if lock_of(layer) > 0:
		parts.append("Content ratio locked")
	return " · ".join(parts)


static func dirty_label(error: bool, saving: bool, dirty: int) -> String:
	if error:
		return "Not saved"
	if saving:
		return "Saving…"
	return "Waiting to save…" if dirty > 0 else "Saved · changes send automatically"


## GET /api/mvr-templates → [[label, "type:id"]…].
static func template_items(data: Dictionary) -> Array:
	var out: Array = []
	for t in data.get("templates", []) if data.get("templates") is Array else []:
		if t is Dictionary:
			out.append([str(t.get("label", "Layout %s" % str(t.get("id")))), source_key(t.get("type", 1), t.get("id", 0))])
	return out


# ---- Fix aspect ratios ---------------------------------------------------------------------------------------------

## True when the device changed under the editor since `base` (connection, output size, windows, sources, UMD).
static func fix_stale(fresh: Dictionary, state: Dictionary, base: Dictionary, screen_id: int) -> bool:
	var output := screen_of(fresh, screen_id)
	var screen := screen_of(state, screen_id)
	if str(fresh.get("session", "")) != str(state.get("session", "")) or output.is_empty() or screen.is_empty() \
			or output.width != screen.width or output.height != screen.height:
		return true
	var mine := windows_of(state, screen_id)
	if windows_of(fresh, screen_id).size() != mine.size():
		return true
	for l in mine:
		var actual := layer_of(fresh, int(l.id))
		var original := layer_of(base, int(l.id))
		if actual.is_empty() or original.is_empty() or not same_window(actual.window, original.window) or actual.sourceId != l.sourceId \
				or actual.sourceType != l.sourceType or actual.umdHeight != l.umdHeight:
			return true
	return false


static func fix_notice(result: Dictionary) -> String:
	var fixed: Array = result.get("fixed", [])
	var skipped: Array = result.get("skipped", [])
	var too_small := skipped.filter(func(s: Dictionary) -> bool: return str(s.reason).contains("64 px")).size()
	var umd := skipped.any(func(s: Dictionary) -> bool: return str(s.reason).contains("UMD"))
	if not fixed.is_empty():
		return "Fixed and locked %d input/screen windows; %d other windows unchanged.%s Saving these changes automatically.%s" % [fixed.size(), skipped.size(),
			(" %d cannot fit the 64 px minimum." % too_small) if too_small > 0 else "", " Some windows were skipped because the device UMD height is unavailable." if umd else ""]
	if too_small > 0:
		return "Source ratios cannot fit at the 64 px minimum. Make room first."
	return "No connected inputs or screen sources with usable resolution and UMD height were found."
