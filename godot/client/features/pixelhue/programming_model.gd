extends RefCounted
## WO-1039 — Programming, pure (no autoloads): state helpers, source keys and lists, and every request body the
## Programming sub-tab POSTs to /api/pixelhue/studio/programming (= Studio PUT /api/programming), matching Studio's
## public/programming-ui.js, layer-tools.js, layer-inspector.js and lib/studio-programming.js. A body helper returns
## {body, message} (message = Studio's success line) or {error} when Studio's client would refuse it locally.

const G := preload("res://features/pixelhue/programming_geometry.gd")

const PGM := 2
const PVW := 4
## layer_2.xml AspectRatioType: [mode, label] and the fixed ratios.
const ASPECTS := [[8, "Source"], [3, "16:9"], [4, "16:10"], [1, "4:3"], [2, "3:2"], [7, "5:4"], [0, "1:1"], [5, "Custom"]]
const RATIOS := {0: 1.0, 1: 4.0 / 3.0, 2: 1.5, 3: 16.0 / 9.0, 4: 1.6, 7: 1.25}
const CURVES := [[3, "Linear"], [0, "S-curve"], [1, "Logarithmic"], [2, "Exponential"]]
const ALIGNS := [["left", "Left"], ["hcenter", "Centre H"], ["right", "Right"], ["top", "Top"], ["vcenter", "Centre V"], ["bottom", "Bottom"], ["center", "Centre"]]
const DRAG_KEY := "pixelhue_source"


## JSON numbers arrive as floats: whole floats → int, deep (ids, windows, flags), other floats unchanged.
static func ints(v: Variant) -> Variant:
	if v is float and is_finite(v) and is_equal_approx(v, roundf(v)) and absf(v) < 9.0e15:
		return int(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = ints(v[k])
		return o
	if v is Array:
		var a: Array = []
		for x in v:
			a.append(ints(x))
		return a
	return v


static func scene_name(scene: Variant) -> String:
	return "PGM" if int(scene) == PGM else "PVW"


static func arr(d: Variant, key: String) -> Array:
	return d.get(key, []) if d is Dictionary and d.get(key) is Array else []


static func screen_by_id(state: Dictionary, id: Variant) -> Dictionary:
	for s in arr(state, "screens"):
		if s.get("id") == id:
			return s
	return {}


static func layer_by_id(state: Dictionary, id: Variant) -> Dictionary:
	if id == null:
		return {}
	for l in arr(state, "layers"):
		if l.get("id") == id:
			return l
	return {}


## The layers of one stage (screen + scene).
static func layers_of(state: Dictionary, screen_id: Variant, scene: int) -> Array:
	return arr(state, "layers").filter(func(l: Dictionary) -> bool: return l.get("screenId") == screen_id and int(l.get("scene", 0)) == scene)


## A PGM layer of a screen whose PGM is locked is select-only.
static func locked(state: Dictionary, layer: Dictionary) -> bool:
	return int(layer.get("scene", 0)) == PGM and screen_by_id(state, layer.get("screenId")).get("pgmLocked") == true


## Shown screens: the remembered ones that still exist, else the enabled screens with outputs, else the first.
static func default_shown(state: Dictionary, saved: Array) -> Array:
	var ids: Array = arr(state, "screens").map(func(s: Dictionary) -> int: return int(s.id))
	var shown: Array = []
	for id in saved:
		if int(id) in ids and not (int(id) in shown):
			shown.append(int(id))
	if shown.is_empty():
		for s in arr(state, "screens"):
			if s.get("enabled") == true and not arr(s, "outputs").is_empty():
				shown.append(int(s.id))
	if shown.is_empty() and not ids.is_empty():
		shown.append(ids[0])
	return shown


## Chip click: toggle one screen, never none, kept in the device's screen order.
static func toggle_shown(state: Dictionary, shown: Array, id: int) -> Array:
	var next: Array = shown.duplicate()
	if id in next:
		next.erase(id)
	else:
		next.append(id)
	if next.is_empty():
		next = [id]
	var order: Array = arr(state, "screens").map(func(s: Dictionary) -> int: return int(s.id))
	next.sort_custom(func(a: int, b: int) -> bool: return order.find(a) < order.find(b))
	return next


## The screen the side panel lists layers of: the selected layer's (when shown), else the first shown.
static func active_screen(state: Dictionary, shown: Array, selected_id: Variant) -> Dictionary:
	var l := layer_by_id(state, selected_id)
	if not l.is_empty() and int(l.get("screenId", -1)) in shown:
		return screen_by_id(state, l.screenId)
	return screen_by_id(state, shown[0]) if not shown.is_empty() else {}


# ---- sources ----

static func source_key(type: Variant, id: Variant) -> String:
	return "%d:%d" % [int(type), int(id)]


## Drag keys: "<type>:<id>" input / screen, "g:<id>" group source, "b:<id>" background, "l:<id>" logo.
static func parse_key(key: String) -> Dictionary:
	var i := key.find(":")
	var kind := key.substr(0, i) if i >= 0 else key
	var rest := key.substr(i + 1) if i >= 0 else ""
	match kind:
		"g":
			return {"kind": "group", "id": rest}
		"b":
			return {"kind": "bkg", "id": int(rest)}
		"l":
			return {"kind": "logo", "id": int(rest)}
	return {"kind": "source", "type": int(kind), "id": int(rest)}


static func source_for(state: Dictionary, key: String) -> Dictionary:
	for s in arr(state, "sources"):
		if source_key(s.get("type"), s.get("id")) == key:
			return s
	return {}


## The 2-second input poll: polled inputs first, the screens' PGM/PVW entries kept.
static func merge_sources(current: Array, polled: Array) -> Array:
	var out: Array = polled.duplicate()
	for s in current:
		if int(s.get("type", 0)) != 2:
			out.append(s)
	return out


## A failed poll marks inputs unavailable instead of showing stale signal badges.
static func sources_unavailable(current: Array) -> Array:
	var out: Array = []
	for s in current:
		var c: Dictionary = s.duplicate()
		if int(c.get("type", 0)) == 2:
			c.connected = false
			c.signalLabel = "Status unavailable"
			c.signalHealth = "off"
		out.append(c)
	return out


static func search_text(s: Dictionary) -> String:
	return ("%s %s" % [str(s.get("mapping", "")) if s.get("mapping") != null else "", str(s.get("name", ""))]).to_lower()


## Inputs tab (type 2) or Screens tab (PGM / PVW of screens), filtered by the search text.
static func filter_sources(sources: Array, tab: String, filter: String) -> Array:
	var f := filter.strip_edges().to_lower()
	return sources.filter(func(s: Dictionary) -> bool:
		var input := int(s.get("type", 0)) == 2
		return (input if tab == "inputs" else not input) and (f == "" or search_text(s).contains(f)))


static func signal_label(s: Dictionary) -> String:
	if str(s.get("signalLabel", "")) != "":
		return str(s.signalLabel)
	return "Live" if s.get("connected") == true else "No signal"


## Badge colour class: live / warning / off (studio.css .source-signal).
static func signal_health(s: Dictionary) -> String:
	var h := str(s.get("signalHealth", ""))
	return h if h in ["live", "warning", "off"] else ("live" if s.get("connected") == true else "off")


static func size_text(s: Dictionary) -> String:
	var w := int(s.get("width", 0)) if s.get("width") != null else 0
	var h := int(s.get("height", 0)) if s.get("height") != null else 0
	return "%s × %s" % [str(w) if w > 0 else "?", str(h) if h > 0 else "?"]


## Source menu of a layer: inputs and OTHER screens' PGM/PVW; the current one is kept even when it is gone.
static func routing_options(state: Dictionary, layer: Dictionary) -> Array:
	var out: Array = []
	for s in arr(state, "sources"):
		if int(s.get("type", 0)) == 2 or s.get("id") != layer.get("screenId"):
			out.append([source_key(s.type, s.id), str(s.get("name", ""))])
	var current := source_key(layer.get("sourceType", 0), layer.get("sourceId", 0))
	if not out.any(func(o: Array) -> bool: return o[0] == current):
		out.push_front([current, str(layer.get("sourceName", "")) if str(layer.get("sourceName", "")) != "" else "Current source"])
	return out


static func layer_title(l: Dictionary) -> String:
	var src := str(l.get("sourceName", ""))
	return "%s · %s · %s" % [scene_name(l.get("scene", PVW)), str(l.get("name", "")), src if src != "" else "Source %s" % str(l.get("sourceId", ""))]


## Side-panel layer list of a screen: PGM then PVW, front-most first.
static func layer_list(state: Dictionary, screen_id: Variant) -> Array:
	var out: Array = []
	for scene in [PGM, PVW]:
		var ls := layers_of(state, screen_id, scene)
		ls.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.get("zorder", 0)) > int(b.get("zorder", 0)))
		out.append_array(ls)
	return out


# ---- request bodies ----

static func _ok(body: Dictionary, message: String) -> Dictionary:
	return {"body": body, "message": message}


static func _err(text: String) -> Dictionary:
	return {"error": text}


## Drop / double-click: a source, group source, background or logo onto a screen's PGM or PVW at `point` (local px;
## {} = the screen's centre). Studio addLayer().
static func drop_request(state: Dictionary, key: String, screen: Dictionary, scene: int, point := {}) -> Dictionary:
	if screen.is_empty():
		return _err("Show a screen first.")
	var at: Dictionary = point if not point.is_empty() else {"x": screen.width / 2.0, "y": screen.height / 2.0}
	var d := parse_key(key)
	var sname := "%s %s" % [str(screen.get("name", "")), scene_name(scene)]
	match d.kind:
		"bkg":
			return _ok({"action": "bkg", "screenId": int(screen.id), "scene": scene, "pictureId": d.id, "enable": true}, "Background set on %s." % sname)
		"logo":
			return _ok({"action": "logo", "screenId": int(screen.id), "scene": scene, "pictureId": d.id, "point": {"x": G.jr(float(at.x)), "y": G.jr(float(at.y))}}, "Logo placed.")
		"group":
			var g: Dictionary = {}
			for x in arr(state, "groupSources"):
				if str(x.get("id")) == str(d.id):
					g = x
			if g.is_empty():
				return _err("That group source is gone. Refresh.")
			if g.get("available") != true:
				return _err("A source of this group is no longer available.")
			var size := G.group_size(source_for(state, source_key(g.a.type, g.a.id)), source_for(state, source_key(g.b.type, g.b.id)), str(g.orient))
			var w := G.win(G.jr(float(at.x) - size.width / 2.0), G.jr(float(at.y) - size.height / 2.0), size.width, size.height)
			return _ok({"action": "group-create", "screenId": int(screen.id), "scene": scene, "orientation": str(g.orient),
				"sources": [{"id": int(g.a.id), "type": int(g.a.type)}, {"id": int(g.b.id), "type": int(g.b.type)}], "window": w}, "%s placed." % str(g.get("name", "Group")))
	var source := source_for(state, key)
	if source.is_empty():
		return _err("Choose a source first.")
	if int(source.type) in [3, 4] and source.id == screen.id:
		return _err("A screen cannot show its own PGM/PVW.")
	return _ok({"action": "create", "screenId": int(screen.id), "scene": scene, "source": {"id": int(source.id), "type": int(source.type)},
		"window": G.drop_window(source, at), "name": "Layer"}, "Layer created.")


## Drop onto an existing layer: an input / screen swaps that layer's source; anything else is placed at its centre.
static func replace_request(state: Dictionary, key: String, layer: Dictionary) -> Dictionary:
	var screen := screen_by_id(state, layer.get("screenId"))
	if parse_key(key).kind != "source":
		var w: Dictionary = layer.window
		return drop_request(state, key, screen, int(layer.scene), {"x": w.x + w.width / 2.0, "y": w.y + w.height / 2.0})
	var source := source_for(state, key)
	if source.is_empty():
		return _err("Choose a source first.")
	if int(source.type) in [3, 4] and source.id == screen.get("id"):
		return _err("A screen cannot show its own PGM/PVW.")
	return _ok(source_body(layer, int(source.type), int(source.id)), "%s now shows %s." % [str(layer.get("name", "Layer")), str(source.get("name", ""))])


static func source_body(layer: Dictionary, type: int, id: int) -> Dictionary:
	return {"action": "source", "screenId": int(layer.screenId), "id": int(layer.id), "source": {"id": id, "type": type}}


## Geometry change for the live queue (programming/geometry) or a command: a group member moves its pair.
static func window_change(state: Dictionary, layer: Dictionary, w: Dictionary) -> Dictionary:
	var grouped := not G.group_of(arr(state, "layers"), layer).is_empty()
	return {"action": "group-window" if grouped else "window", "screenId": int(layer.screenId), "id": int(layer.id), "window": G.copy(w)}


## Aspect menu: a fixed ratio resizes the height first (same request), Custom keeps the current lock.
static func aspect_mode_body(layer: Dictionary, mode: int) -> Dictionary:
	var b := {"action": "aspect", "screenId": int(layer.screenId), "id": int(layer.id), "mode": mode, "locked": mode != 5 or layer.get("aspectLocked") == true}
	if RATIOS.has(mode):
		var w: Dictionary = G.copy(layer.window)
		w.height = maxi(G.MIN, G.jr(w.width / float(RATIOS[mode])))
		b.window = w
	return b


static func aspect_label(mode: int) -> String:
	for a in ASPECTS:
		if a[0] == mode:
			return a[1]
	return "Custom"


static func aspect_lock_body(layer: Dictionary, on: bool) -> Dictionary:
	return {"action": "aspect", "screenId": int(layer.screenId), "id": int(layer.id), "locked": on}


static func zorder_body(layer: Dictionary, to: int) -> Dictionary:
	return {"action": "zorder", "screenId": int(layer.screenId), "id": int(layer.id), "to": to}


static func copy_body(layer: Dictionary, mirror: bool) -> Dictionary:
	var b := {"action": "copy", "screenId": int(layer.screenId), "id": int(layer.id)}
	if mirror:
		b.mirror = true
	return b


## Clear: a group member clears both (group-delete), else the layer.
static func clear_request(state: Dictionary, layer: Dictionary) -> Dictionary:
	var g := G.group_of(arr(state, "layers"), layer)
	if not g.is_empty():
		return _ok({"action": "group-delete", "screenId": int(layer.screenId), "id": int(layer.id)}, "Group %d cleared." % int(g.group))
	return _ok({"action": "delete", "screenId": int(layer.screenId), "id": int(layer.id)}, "Layer cleared.")


static func clear_question(state: Dictionary, layer: Dictionary) -> String:
	var g := G.group_of(arr(state, "layers"), layer)
	if not g.is_empty():
		return "Clear group %d (both layers) from %s?" % [int(g.group), scene_name(layer.get("scene"))]
	return "Clear %s (%s) from %s %s?" % [str(layer.get("name", "the layer")), str(layer.get("sourceName", "")),
		str(screen_name_of(state, layer)), scene_name(layer.get("scene"))]


static func screen_name_of(state: Dictionary, layer: Dictionary) -> String:
	return str(screen_by_id(state, layer.get("screenId")).get("name", ""))


static func ungroup_body(layer: Dictionary) -> Dictionary:
	return {"action": "group-ungroup", "screenId": int(layer.screenId), "id": int(layer.id)}


## KeyFrame: start / duration are tenths of a percent of the take on the device (0–999, 1–1000).
static func keyframe_body(layer: Dictionary, changes: Dictionary) -> Dictionary:
	return {"action": "keyframe", "screenId": int(layer.screenId), "id": int(layer.id), "keyFrame": changes}


static func percent_to_tenths(v: float, lo: int, hi: int) -> int:
	return clampi(G.jr(v * 10.0), lo, hi)


static func take_body(screen_ids: Array, time_ms: int, swap: bool) -> Dictionary:
	return {"action": "take", "screenIds": screen_ids.duplicate(), "time": clampi(time_ms, 0, 10000), "swap": swap}


static func cut_body(screen_ids: Array, swap: bool) -> Dictionary:
	return {"action": "cut", "screenIds": screen_ids.duplicate(), "swap": swap}


static func pgm_lock_request(screen: Dictionary) -> Dictionary:
	var on: bool = screen.get("pgmLocked") == true
	return _ok({"action": "pgm-lock", "screenId": int(screen.id), "locked": not on}, "%s PGM %s." % [str(screen.get("name", "")), "unlocked" if on else "locked"])


static func background_of(state: Dictionary, screen_id: Variant, scene: int) -> Dictionary:
	for b in arr(state, "backgrounds"):
		if b.get("screenId") == screen_id and int(b.get("scene", 0)) == scene:
			return b
	return {}


static func bkg_toggle_request(screen: Dictionary, scene: int, bkg: Dictionary) -> Dictionary:
	var on: bool = bkg.get("enabled") == true
	return _ok({"action": "bkg", "screenId": int(screen.id), "scene": scene, "enable": not on},
		"Background %s on %s %s." % ["off" if on else "on", str(screen.get("name", "")), scene_name(scene)])


static func effect_body(layer: Dictionary, effect: Dictionary) -> Dictionary:
	return {"action": "effect", "screenId": int(layer.screenId), "id": int(layer.id), "effect": effect}


## After a command: Studio's success line, plus the screens a preset save skipped.
static func success_text(next: Dictionary, success: String) -> String:
	var skipped := arr(next, "skipped")
	if skipped.is_empty():
		return success
	return "%s Skipped disabled %s." % [success, ", ".join(PackedStringArray(skipped.map(func(s: Variant) -> String: return str(s))))]


## Re-read the programming state after a transition / preset load (ms; -1 = no follow-up read).
static func refresh_delay(body: Dictionary) -> int:
	match str(body.get("action", "")):
		"take", "preset-autotake":
			return int(body.get("time", 500)) + 150
		"cut":
			return 150
		"preset-load":
			return 600
	return -1


## The id of the layer a create / copy / group-create added (selected afterwards), or null.
static func new_layer_id(before: Array, next: Dictionary) -> Variant:
	for l in arr(next, "layers"):
		if not (l.get("id") in before):
			return l.get("id")
	return null


## A geometry answer's layers: windows to adopt for the accepted changes (a group change covers both members).
static func accepted_ids(state: Dictionary, accepted: Array) -> Array:
	var ids: Array = []
	for c in accepted:
		var l := layer_by_id(state, c.get("id"))
		var g := G.group_of(arr(state, "layers"), l) if str(c.get("action")) == "group-window" else {}
		if not g.is_empty():
			ids.append_array([g.a.id, g.b.id])
		else:
			ids.append(c.get("id"))
	return ids
