extends RefCounted
## WO-1029 — the operator prefs that describe ONE server's hardware (`gpuLayout`, `decklinkRearOrder`) belong to that
## server, not to this client's node. client_prefs.gd (CP) stays the static mirror of THIS node's /api/client-prefs; a
## linked server being edited (or drawn frozen on the Servers card) has its own copy here, fetched through the relay
## (/api/cluster/peers/:id/relay/api/client-prefs, cluster-relay.js carries any /api/ path). `server` = "" is this box
## (CP + the box's cfg key), otherwise the peer's id as this node lists it. A peer with nothing saved has NO layout:
## never this box's. The devices.cfg fallback copy is keyed by server (`layout@this`, `layout@<peer>`); the old
## un-keyed `layout` / `rear_order` entry is moved to this box's key once (migrate()).
## Writes: the peer's prefs go to the peer through the api the caller names, the same api the topology POST uses.

const CP := preload("res://core/client_prefs.gd")
const PREFS := "user://devices.cfg"
const BOX := "this"
const LEGACY := [["gpu", "layout"], ["decklink", "rear_order"]]
const GLOBAL_KEYS := ["gpuLayout", "decklinkRearOrder"]

static var path_override := ""  ## tests: a throwaway cfg instead of the real user://devices.cfg
static var peers := {}  ## server id → {key: value}, a peer's own /api/client-prefs (absent key = none saved)


static func _p(path: String) -> String:
	return path if path != "" else (path_override if path_override != "" else PREFS)


static func cfg_key(base: String, server: String) -> String:
	return "%s@%s" % [base, BOX if server == "" else server.uri_encode()]


## The legacy un-keyed entries → this box's key, once. → true when something moved.
static func migrate(path := "") -> bool:
	var cfg := ConfigFile.new()
	if cfg.load(_p(path)) != OK:
		return false
	return _migrate_cfg(cfg, _p(path))


static func _migrate_cfg(cfg: ConfigFile, path: String) -> bool:
	var moved := false
	for l in LEGACY:
		if not cfg.has_section_key(l[0], l[1]):
			continue
		if not cfg.has_section_key(l[0], cfg_key(l[1], "")):
			cfg.set_value(l[0], cfg_key(l[1], ""), cfg.get_value(l[0], l[1]))
		cfg.erase_section_key(l[0], l[1])
		moved = true
	if moved:
		cfg.save(path)
	return moved


## This client's own copy for `server` (null = none).
static func local(sec: String, base: String, server: String, path := "") -> Variant:
	var cfg := ConfigFile.new()
	if cfg.load(_p(path)) != OK:
		return null
	_migrate_cfg(cfg, _p(path))
	var k := cfg_key(base, server)
	return cfg.get_value(sec, k) if cfg.has_section_key(sec, k) else null


## The saved value of `key` for `server`; this box: the node's, else its cfg copy. A peer: its own prefs, else the cfg
## copy kept for it, else null. Never this box's value for a peer.
static func value(server: String, key: String, sec: String, base: String, path := "") -> Variant:
	var loc: Variant = local(sec, base, server, path)
	if server == "":
		return CP.value(key, loc)
	var mine: Dictionary = peers.get(server, {})
	var v: Variant = mine.get(key)
	return (v.duplicate(true) if v is Array else v) if v != null else loc


## Save (`v` = null clears) for `server`: the cfg copy, then the server itself — this node's mirror + POST for the box,
## else the peer's mirror + a POST through `api` (the relay the topology POST uses).
static func save(server: String, api: Variant, key: String, sec: String, base: String, v: Variant, path := "") -> void:
	var cfg := ConfigFile.new()
	cfg.load(_p(path))
	var k := cfg_key(base, server)
	if v == null:
		if cfg.has_section_key(sec, k):
			cfg.erase_section_key(sec, k)
	else:
		cfg.set_value(sec, k, v)
	cfg.save(_p(path))
	if server == "":
		CP.post(key, v)
		return
	var mine: Dictionary = peers.get(server, {})
	if v == null:
		mine.erase(key)
	else:
		mine[key] = v.duplicate(true) if v is Array else v
	peers[server] = mine
	if api != null:
		api.post_json("/api/client-prefs", {"key": key, "value": v})


## GET reply of a peer's /api/client-prefs → its entry (only valid global values).
static func from_reply(server: String, data: Variant) -> void:
	var out := {}
	var prefs: Variant = data.get("prefs") if data is Dictionary else null
	if prefs is Dictionary:
		for k in GLOBAL_KEYS:
			if CP.valid(k, prefs.get(k)):
				out[k] = prefs[k]
	peers[server] = out


## Fetch a peer's prefs through `api` (the relayed one). Failure → no saved layout for it (not this box's).
static func load_peer(server: String, api: Variant, path := "/api/client-prefs") -> void:
	if server == "" or api == null:
		return
	var res: Dictionary = await api.get_json(path)
	if res.get("ok", false):
		from_reply(server, res.get("data"))
	else:
		peers.erase(server)
