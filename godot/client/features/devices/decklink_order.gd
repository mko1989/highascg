extends RefCounted
## WO-605 slice 9a — the DeckLink rear-panel port order (web lib/device-view-decklink-order.js, the markers' default
## order in device-view-caspar-render-markers.js, the rear-order editor device-view-inspector-decklink-rear-order.js).
## The order is shared by every client on the node (WO-598 D: core/client_prefs.gd `decklinkRearOrder`, the web's
## too); user://devices.cfg keeps this machine's copy as the fallback. One deliberate difference: the web's panel shows the 4·2·3·1 default while its editor, Save,
## Export and swaps work on the unsorted id order, so the first edit reshuffles the panel. Here the panel order IS
## the edited / saved / exported order. The order functions are pure (tests preload them).

const CP := preload("res://core/client_prefs.gd")
const PREFS := "user://devices.cfg"
const EDIT_TIP := "Edit DeckLink port order — drag markers on the rear panel, or use Save / Export / Load in the inspector (same as GPU layout)."
const HEADING := "DeckLink rear order (drag to reorder)"
const RESET_TIP := "Clear the saved DeckLink rear order (shared by every client)"
const RESET_CONFIRM := "Clear saved DeckLink rear panel order?"
const EXPORT_NAME := "decklink_rear_panel_order.json"
const CASPAR := "caspar_host"

## The rear panel's DeckLink edit mode (web: a module-level flag that survives re-renders).
static var edit := false


## decklinkMergedConnectors: suggested decklink_io then decklink_out of the Caspar host, first of each id.
static func merged(payload: Dictionary) -> Array:
	var sug: Variant = payload.get("suggested")
	var list: Array = sug.get("connectors") if sug is Dictionary and sug.get("connectors") is Array else []
	var out := []
	var seen := {}
	for kind in ["decklink_io", "decklink_out"]:
		for c in list:
			if c is Dictionary and c.get("deviceId") == CASPAR and c.get("kind") == kind and not seen.has(str(c.get("id"))):
				seen[str(c.get("id"))] = true
				out.append(c)
	return out


## orderDecklinkConnectors: the saved ids that exist, in saved order, then the rest in their own order.
static func order(items: Array, saved: Array) -> Array:
	var by := {}
	for c in items:
		if not by.has(str(c.id)):
			by[str(c.id)] = c
	var out := []
	for id in saved:
		if by.has(str(id)):
			out.append(by[str(id)])
			by.erase(str(id))
	for c in items:
		if by.has(str(c.id)):
			out.append(by[str(c.id)])
			by.erase(str(c.id))
	return out


## The markers' default order with nothing saved and 4+ ports: the ports whose label holds 4, 2, 3, 1 (or whose
## index is 3, 1, 2, 0) first, then the rest. The web can pick one port twice ("Port 12" holds 1 and 2) and then draws
## it twice; here a port is placed once.
static func display(items: Array, persisted: bool) -> Array:
	if persisted or items.size() < 4:
		return items
	var p := []
	for n in 4:
		var hit: Variant = null
		for it in items:
			if str(it.get("label")).contains(str(n + 1)) or (it.get("index") != null and int(it.index) == n):
				hit = it
				break
		if hit == null:
			return items
		p.append(hit)
	var out := []
	for it in [p[3], p[1], p[2], p[0]] + items:
		if not out.has(it):
			out.append(it)
	return out


## What the panel and the editor show: the saved order when one is saved, else the default.
static func current(items: Array, saved: Array) -> Array:
	return order(items, saved) if not saved.is_empty() else display(order(items, []), false)


static func ids(items: Array) -> Array:
	return items.map(func(c: Variant) -> String: return str(c.id))


## Move ids[from] before (after = false) or after row `to` (the GPU editor's half-of-row drop, which the web's
## DeckLink list lacks: there, dragging a row one down lands it back where it was).
static func move(list: Array, from: int, to: int, after: bool) -> Array:
	var out := list.duplicate()
	var at := to + (1 if after else 0)
	if from < at:
		at -= 1
	if from == at or from < 0 or from >= out.size():
		return out
	var x: Variant = out.pop_at(from)
	out.insert(at, x)
	return out


## A rear-panel drop: the dragged and the dropped-on port trade places.
static func swap(list: Array, a: String, b: String) -> Array:
	var out := list.duplicate()
	var i := out.find(a)
	var j := out.find(b)
	if i >= 0 and j >= 0:
		out[i] = b
		out[j] = a
	return out


## A loaded order file → {ok, ids} (array, {decklinkRearOrder} or {connectorIds}; anything else = no order, i.e. the
## ports' own order) or {ok: false, error}.
static func parse_file(text: String, items: Array) -> Dictionary:
	var j := JSON.new()
	if j.parse(text) != OK:
		return {"ok": false, "error": "Invalid DeckLink order file: %s (line %d)" % [j.get_error_message(), j.get_error_line() + 1]}
	var p: Variant = j.data
	var raw: Array = []
	if p is Array:
		raw = p
	elif p is Dictionary and p.get("decklinkRearOrder") is Array:
		raw = p.decklinkRearOrder
	elif p is Dictionary and p.get("connectorIds") is Array:
		raw = p.connectorIds
	var strs := raw.map(func(x: Variant) -> String: return _js(x)).filter(func(s: String) -> bool: return s != "")
	return {"ok": true, "ids": ids(order(items, strs))}


static func export_text(list: Array) -> String:
	return JSON.stringify({"version": 1, "decklinkRearOrder": list}, "  ", false)


static func _js(x: Variant) -> String:
	if x is float and x == floorf(x) and absf(x) < 1e15:
		return str(int(x))
	return "null" if x == null else str(x)


## This machine's own copy (null = none).
static func local() -> Variant:
	var cfg := ConfigFile.new()
	return cfg.get_value("decklink", "rear_order") if cfg.load(PREFS) == OK and cfg.has_section_key("decklink", "rear_order") else null


static func saved() -> Array:
	var v: Variant = CP.value("decklinkRearOrder", local())
	return (v as Array).map(func(x: Variant) -> String: return str(x)) if v is Array else []


static func save(list: Array) -> void:
	var ids := list.map(func(x: Variant) -> String: return str(x))
	var cfg := ConfigFile.new()
	cfg.load(PREFS)
	cfg.set_value("decklink", "rear_order", ids)
	cfg.save(PREFS)
	CP.post("decklinkRearOrder", ids)


static func clear() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PREFS) == OK and cfg.has_section_key("decklink", "rear_order"):
		cfg.erase_section_key("decklink", "rear_order")
		cfg.save(PREFS)
	CP.post("decklinkRearOrder", null)
