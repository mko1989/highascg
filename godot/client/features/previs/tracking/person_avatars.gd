extends Node3D
## WO-1086 — the "Avatars" style of the previs people layer (person_cards.gd): one person_avatar.gd per tracked world
## person, at their feet, as tall as they measure, wearing the look the sidecar derived (person_avatar_model.pick /
## look). Binds no camera video at all — the layer leases no surface in this style.
##
## A world person that vanishes leaves its avatar standing HOLD_S; a new world id that carries one of its camera keys
## ("cam:tid" — the tracker revives a remembered person under the same tid, WO-1080) takes that avatar over, so a
## brief loss or a fusion re-number does not pop the figure or change its look.

const Avatar := preload("res://features/previs/tracking/person_avatar.gd")
const AV := preload("res://features/previs/tracking/person_avatar_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")

const HOLD_S := 1.5

var _live := {}  # world id → {node, memo {key}, keys []}
var _gone := []  # [{node, memo, keys, at}] — waiting HOLD_S to be adopted


## One snapshot's cards (person_cards_model.cards: id, feet, height, joints, keys, looks) at `now` seconds.
func show_cards(cards: Array, now: float) -> void:
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
				var n := Avatar.new()
				add_child(n)
				e = {"node": n, "memo": {}}
			_live[id] = e
		e.keys = c.get("keys", [])
		var look := AV.look(AV.pick(c.get("looks", []), e.memo))
		(e.node as Node3D).visible = true
		e.node.set_target(C.psn_to_godot(c.feet), float(c.height), look, c.get("joints"), now)
	for g in _gone.duplicate():
		if now - float(g.at) > HOLD_S:
			_drop(g.node)
			_gone.erase(g)


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
