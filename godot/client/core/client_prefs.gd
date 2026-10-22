extends RefCounted
## WO-598 D slice 2 — the operator setup every client shares, kept on the node (GET / POST /api/client-prefs,
## WS `client_prefs`; web lib/client-prefs.js): `gpuLayout` (Device View GPU rows: hidden flags + labels),
## `decklinkRearOrder` (DeckLink rear-panel port ids), `hardwarePolicy` (ask / apply_saved / keep_live).
## A static mirror so the synchronous readers (gpu_layout.gd / decklink_order.gd saved(), hardware_reconcile.gd
## policy()) stay synchronous: the node's value wins; this machine's cfg copy is the fallback until the first GET
## answers or while the node is unreachable. attach() (main.gd) loads on every connect and takes the broadcasts.
## Multiview presets / layouts are the per-multiviewer keys (multiview_tab.gd + mv_prefs.gd).

const KEYS := ["gpuLayout", "decklinkRearOrder", "hardwarePolicy"]
const POLICIES := ["ask", "apply_saved", "keep_live"]

static var node := {}  ## key → the node's value (absent = none saved)
static var _listeners: Array[Callable] = []


static func valid(key: String, v: Variant) -> bool:
	match key:
		"gpuLayout":
			return v is Array and (v as Array).all(func(i: Variant) -> bool: return i is Dictionary and i.get("id") is String)
		"decklinkRearOrder":
			return v is Array and (v as Array).all(func(x: Variant) -> bool: return x is String)
		"hardwarePolicy":
			return v is String and POLICIES.has(v)
	return false


## The node's value, else `local` (this machine's own copy).
static func value(key: String, local: Variant) -> Variant:
	return (node[key] as Variant).duplicate(true) if node.has(key) and node[key] is Array else node.get(key, local)


## Mirror a write; returns the POST body (`value` null = remove).
static func write(key: String, v: Variant) -> Dictionary:
	if v == null:
		node.erase(key)
	else:
		node[key] = v.duplicate(true) if v is Array else v
	return {"key": key, "value": v}


## Autoloads by name at runtime: the pure tests (and the decklink_order / gpu_layout tests preloading this) run without
## them, and then nothing reaches the live node.
static func _autoload(name: String) -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	return tree.root.get_node_or_null(name) if tree != null else null


static func post(key: String, v: Variant) -> void:
	var body := write(key, v)
	var api := _autoload("Api")
	if api != null:
		api.post_json("/api/client-prefs", body)


## GET /api/client-prefs reply → mirror (only valid values).
static func from_reply(data: Variant) -> void:
	node = {}
	var prefs: Variant = data.get("prefs") if data is Dictionary else null
	if prefs is Dictionary:
		for k in KEYS:
			if valid(k, prefs.get(k)):
				node[k] = prefs[k]
	_emit(["loaded"])


## POST bodies for what only this machine has (`local`: key → value or null), the node having none.
static func to_push(local: Dictionary) -> Array:
	var out := []
	for k in KEYS:
		if not node.has(k) and valid(k, local.get(k)):
			out.append({"key": k, "value": local[k]})
	return out


## WS `client_prefs` for a global key → true when it changed the mirror (false: per-multiviewer key or own echo).
static func apply_broadcast(d: Variant) -> bool:
	if not (d is Dictionary) or not KEYS.has(str(d.get("key"))) or d.has("n"):
		return false
	var k := str(d.key)
	var v: Variant = d.get("value")
	if var_to_str(node.get(k)) == var_to_str(v):
		return false
	if v == null or not valid(k, v):
		node.erase(k)
	else:
		node[k] = v
	_emit([k])
	return true


## fn(keys: Array) after a load (["loaded"]) or another client's change ([key]). A listener bound to a node must
## unlisten() when that node leaves the tree: a lambda left in this static array outlives its node at quit and the
## engine aborted with glibc "corrupted size vs. prev_size in fastbins" on EVERY client exit (WO-676).
static func listen(fn: Callable) -> void:
	_listeners.append(fn)


static func unlisten(fn: Callable) -> void:
	_listeners.erase(fn)


static func _emit(keys: Array) -> void:
	for fn in _listeners.duplicate():
		if fn.is_valid():
			fn.call(keys)


## main.gd, once before Ws.start(): load on every (re)connect, push up local-only values, take other clients'
## writes. `locals` returns this machine's own copies (key → value or null).
static func attach(locals: Callable) -> void:
	var ws := _autoload("Ws")
	ws.on("client_prefs", func(d: Variant) -> void: apply_broadcast(d))
	ws.connected.connect(func() -> void: sync(locals))


static func sync(locals: Callable) -> void:
	var res: Dictionary = await _autoload("Api").get_json("/api/client-prefs")
	if not res.ok:
		return
	from_reply(res.get("data"))
	for body in to_push(locals.call()):
		post(body.key, body.value)
