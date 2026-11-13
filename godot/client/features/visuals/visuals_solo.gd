extends Node
## WO-1051 — Visuals layers as their own Live sources (owner 13.11: "pick layers from the live tab of the sources, when the shm
## visuals are on, give me layers to pick and stack them on look layers"). `project.visuals.output.solo` lists 1-based stack
## positions (visuals_model.gd solo_of): while the canvas is a Live source (output.ring, WO-883) each one is drawn into its own
## transparent composite instead of the canvas (visuals_deck.gd / visuals_mixer.gd set_solo) and published here as shm ring
## `<ring>-L<n>` (visuals_model.gd solo_ring) at the main ring's rate. Positions, not scenes: an APC pad that swaps what plays
## on a slot changes what that ring shows. Sources ▸ Live lists the positions under the `visuals` row
## (features/live/visuals_solo_rows.gd): a drag makes one solo, its route menu moves it.
## WO-1053 route groups: `output.groups` {name: positions} — several positions in ONE composite and ONE ring `<ring>-<name>`
## (L4 + L5 → `visuals-overlay`: one readback, one look layer). Every picked position has a route KEY (M.route_keys): its
## own `L<n>` or its group's name; decks, mixes, rings and drains are per key. Moving a layer between keys restarts nothing.
## A ring that stops being wanted (key gone, Live source off) keeps publishing transparent frames for `drain_s` before it
## closes — Caspar's shm producer holds the last frame (shm_producer.cpp), so a look playing it goes clear, not frozen.
## A key whose positions are past the stack keeps its ring, transparent: a look may still play it. Lives under the tab
## (visuals_tab.gd, 500-line limit): _sync_ring() calls sync(). GPU: one canvas-size readback per active key.

const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Publisher := preload("res://features/shm_out/viewport_publisher.gd")
const Preview := preload("res://features/visuals/visuals_route_preview.gd")

signal changed  # the routes or a ring's state changed

var tab: Node
var pubs := {}  # route key → its publisher (start(vp, ring, fps) -> "", stop(), sink)
var note := ""  # why a ring could not start ("" = fine)
var drain_s := 1.0  # seconds of transparent frames before a ring that is no longer wanted closes (tests: 0)
var make_publisher := func() -> Node: return Publisher.new()  # tests put a stand-in here
var publish_check := func() -> String: return tab.can_publish()  # "" when this client can write rings
var _draining := {}  # key → the drain's token (a newer sync() for the same key cancels it)
var _seq := 0
var _active := {}  # the routes of the last sync() (the previews read it every frame)


func _init(t: Node) -> void:
	tab = t
	name = "VisualsSolo"
	t.add_child(self)


## The page's Output edit (screen, layer, size, Live source) replaces `slice.output`: the routes ride along.
func keep(prev: Dictionary, o: Dictionary) -> Dictionary:
	for k in ["solo", "groups"]:
		if prev.has(k):
			o = o.duplicate()
			o[k] = prev[k]
	return o


func _out() -> Dictionary:
	var o: Variant = tab.slice.get("output")
	return o if o is Dictionary else {}


## {position: route key} as stored (whether or not the canvas is a Live source).
func routes() -> Dictionary:
	return M.route_keys(_out())


## The stored positions with their own ring (L<n>).
func positions() -> Array:
	var r := routes()
	return r.keys().filter(func(n: int) -> bool: return r[n] == M.own_key(n))


## WO-1053: the stored groups {name: positions}.
func groups() -> Dictionary:
	return M.groups_of(_out().get("groups"))


## Position `n`'s key: "" = in the main picture.
func route_of(n: int) -> String:
	return str(routes().get(n, ""))


## The canvas is a Live source (Visuals ▸ Output ▸ Live source).
func live_source() -> bool:
	return _out().get("ring") == true


## The routes in effect right now: only while a Live source (else every layer is in the canvas and the routes wait).
func active() -> Dictionary:
	return routes() if live_source() else {}


func ring(key: Variant) -> String:
	return M.key_ring(str(tab.ring_name), key if key is String else M.own_key(int(key)))


## The name the route menu's "New group…" gives.
func new_group() -> String:
	return M.new_group_name(groups())


## Position `n` own (L<n>) on / off (WO-1051): off puts it back into the main picture.
func set_solo(n: int, on: bool) -> void:
	if on or route_of(n) == M.own_key(n):
		set_route(n, M.own_key(n) if on else "")


## WO-1053: position `n` to `key` — "" main, `L<n>` own, a group name (a new name makes the group). Stored with the slice
## (autosave + undo) and the rings brought in line.
func set_route(n: int, key: String) -> void:
	if n < 1 or n > L.MAX or route_of(n) == key or (key != "" and key != M.own_key(n) and not M.group_name_ok(key)):
		return
	var o := _out()
	var own := positions().filter(func(p: int) -> bool: return p != n)
	var gs := groups()
	for g in gs:
		gs[g] = (gs[g] as Array).filter(func(p: int) -> bool: return p != n)
	if key == M.own_key(n):
		own.append(n)
	elif key != "":
		gs[key] = gs.get(key, []) + [n]
	o.solo = own
	o.groups = gs
	var norm: Dictionary = M.slice_of({"visuals": {"output": o}}).output
	for k in ["solo", "groups"]:
		if norm.has(k):
			o[k] = norm[k]
		else:
			o.erase(k)
	tab._store()
	sync()


## The layer stack of the bank on the canvas, bottom → top (A/B: the crossfader's side; else the one stack).
func air_layers() -> Array:
	var dj: Variant = tab.get("dj")
	var other: bool = dj != null and bool(dj.get("on")) and tab.slice.get("dj") is Dictionary \
		and tab.slice.dj.get("other") is Dictionary and tab.mixer.air() != tab.mixer.live
	var ls: Variant = tab.slice.dj.other.get("layers") if other else tab.slice.get("layers")
	return ls if ls is Array else []


## Decks, mixes and rings in line with active(); safe to call any time.
func sync() -> void:
	_active = active()
	var want: Array = _active.values().reduce(func(a: Array, k: String) -> Array: return a if k in a else a + [k], [])
	for k in want:
		_draining.erase(k)  # wanted again before its drain ended: the same ring keeps going
	for k in pubs.keys():
		if not k in want and not _draining.has(k):
			_drain(k)
	tab.mixer.set_solo(_active, _draining.keys())
	note = ""
	for k in want:
		if pubs.has(k):
			continue
		var why: String = publish_check.call()
		if why == "":
			var p: Node = make_publisher.call()
			add_child(p)
			why = p.start(tab.mixer.solo_out[k], ring(k), int(tab._fps()))
			if why == "":
				pubs[k] = p
			else:
				remove_child(p)
				p.queue_free()
		if why != "":
			note = why
	_badges(_active)
	previews()
	changed.emit()


func _drain(k: String) -> void:
	_seq += 1
	var token := _seq
	_draining[k] = token
	if drain_s > 0.0 and is_inside_tree():
		await get_tree().create_timer(drain_s).timeout
	if _draining.get(k) != token:
		return  # wanted again (or a newer drain)
	_draining.erase(k)
	var p: Node = pubs.get(k)
	pubs.erase(k)
	if p != null:
		p.stop()
		remove_child(p)
		p.queue_free()
	tab.mixer.set_solo(active(), _draining.keys())
	changed.emit()


## WO-1053: the picked layers back in the tab's views (visuals_route_preview.gd): PGM / canvas = the mix's key composites,
## PRV (A/B) = the off-air deck's. Called by sync() and every A/B frame (visuals_dj.gd _show_x); rebuilt only on change.
func previews() -> void:
	var ks := Preview.order(_active)
	var m: Node = tab.mixer
	var canvas: Variant = tab.get("_canvas")
	if canvas is TextureRect:
		Preview.show(canvas, ks.filter(func(k: String) -> bool: return m.solo_out.has(k)).map(
			func(k: String) -> Texture2D: return m.solo_out[k].get_texture()))
	var dj: Variant = tab.get("dj")
	var prv: Variant = dj.get("_prv") if dj != null else null
	if prv is TextureRect:
		var d: Node = m.deck_of(1 - m.air())
		Preview.show(prv, ks.filter(func(k: String) -> bool: return d.solo.has(k)).map(
			func(k: String) -> Texture2D: return d.solo[k].get_texture()) if bool(dj.get("on")) else [])


## The Visuals layer list's key badges (why a layer is missing from the canvas).
func _badges(want: Dictionary) -> void:
	var page: Variant = tab.get("page")
	if page != null and page.get("layer_list") != null:
		page.layer_list.set_solo(want)
