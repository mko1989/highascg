extends Node3D
## WO-1086 — the "Avatars" style of the previs people layer (person_cards.gd): one person_avatar.gd per tracked world
## person, at their feet, as tall as they measure, wearing the look the sidecar derived (person_avatar_model.pick /
## look). Binds no camera video at all — the layer leases no surface in this style.
##
## A world person that vanishes leaves its avatar standing HOLD_S; a new world id that carries one of its camera keys
## ("cam:tid" — the tracker revives a remembered person under the same tid, WO-1080) takes that avatar over, so a
## brief loss or a fusion re-number does not pop the figure or change its look.
##
## WO-1103: a test puppet card with body "woman" / "man" gets a realistic human (person_human.gd) instead of the pebble;
## a body change swaps the node in place (same id, same look memo).

const Avatar := preload("res://features/previs/tracking/person_avatar.gd")
const Human := preload("res://features/previs/tracking/person_human.gd")  # WO-1103
const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")

const HOLD_S := 1.5

var _live := {}  # world id → {node, memo {key}, keys []}
var _gone := []  # [{node, memo, keys, at}] — waiting HOLD_S to be adopted
var _snap_now := 0.0  # WO-1106 B33: the `now` of the last snapshot …
var _snap_ticks := 0.0  # … and the engine clock (s) when it came: held avatars expire on that clock between snapshots


## One snapshot's cards (person_cards_model.cards / puppet_cards: id, feet, height, joints, keys, looks, tag?) at `now` s.
func show_cards(cards: Array, now: float) -> void:
	_snap_now = now
	_snap_ticks = Time.get_ticks_msec() / 1000.0
	var seen := {}
	for c in cards:
		seen[int(c.id)] = true
	for id in _live.keys():  # first, so a person re-numbered in this very snapshot finds their avatar held
		if not seen.has(id):
			var g: Dictionary = _live[id]
			g["at"] = now
			_gone.append(g)
			_live.erase(id)
	for c in cards:
		var id := int(c.id)
		var e: Variant = _live.get(id)
		if e == null:
			e = _adopt(c.get("keys", []))
			if e == null:
				e = {"node": null, "memo": {}, "body": ""}
			_live[id] = e
		var body := str(c.get("body", "")) if Human.wants(c.get("body", "")) else ""  # WO-1103: "" = the pebble
		if e.node == null or str(e.get("body", "")) != body:
			if e.node != null:
				_drop(e.node)
			e.node = Human.new(body) if body != "" else Avatar.new()
			e.body = body
			add_child(e.node)
		e.keys = c.get("keys", [])
		var look := AV.look(AV.pick(c.get("looks", []), e.memo))
		(e.node as Node3D).visible = true
		if e.node is Human:
			e.node.set_heading(c.get("heading"))
		e.node.set_target(C.psn_to_godot(c.feet), float(c.height), look, c.get("joints"), now)
		e.node.set_tag(str(c.get("tag", "")))  # WO-1087: test puppet people are labelled
	expire(now)


## Held avatars older than HOLD_S at `now` are dropped. WO-1106 B33: also from _process — they expired only inside
## show_cards(), so when the snapshots stopped (tracking off, a dead feed) the held figures stood forever.
func expire(now: float) -> void:
	for g in _gone.duplicate():
		if now - float(g.at) > HOLD_S:
			_drop(g.node)
			_gone.erase(g)


func _process(_delta: float) -> void:
	if not _gone.is_empty():
		expire(_snap_now + Time.get_ticks_msec() / 1000.0 - _snap_ticks)


## A held avatar that shares a camera key with `keys`, taken out of the held list; null when none.
func _adopt(keys: Array) -> Variant:
	for g in _gone:
		for k in keys:
			if (g.keys as Array).has(k):
				_gone.erase(g)
				return g
	return null


## Avatars drawn now (tests): live + held.
func count() -> int:
	return _live.size() + _gone.size()


## The avatar node of a world id (tests), or null.
func avatar(id: int) -> Node3D:
	return _live[id].node if _live.has(id) else null


func clear() -> void:
	for e in _live.values():
		_drop(e.node)
	for g in _gone:
		_drop(g.node)
	_live.clear()
	_gone.clear()


func _drop(n: Node) -> void:
	if n.is_inside_tree():
		n.queue_free()
	else:
		n.free()
