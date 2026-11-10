extends RefCounted
## WO-1029 — the destination cards are compact: a two-dot card (PGM/PRV, Operator GUI 1 / 2) has its dots at the top
## right inside the title + subtitle block, and is not taller than ~ title + subtitle + padding.

const Body := preload("res://features/devices/destination_card_body.gd")
var t


func _dest(mode: String, halves: Array, tags: Array) -> Dictionary:
	return {"id": "d1", "label": "Dest", "sub": "X · 1920x1080@50", "mode": mode, "host": false, "connector": "d1",
		"halves": halves, "half_tags": tags, "links": [], "dest": {}, "intent": null}


## Force a layout pass without a frame: sort containers top-down at the card's minimum size.
func _layout(c: Control) -> void:
	c.size = c.get_combined_minimum_size()
	if c is Container:
		c.notification(Container.NOTIFICATION_SORT_CHILDREN)
	for ch in c.get_children():
		if ch is Control:
			_layout(ch)


## Position inside `card` by summing local offsets (global_position is meaningless off the tree).
func _rel(n: Control, card: Control) -> Rect2:
	var p := Vector2.ZERO
	var c: Control = n
	while c != card:
		p += c.position
		c = c.get_parent()
	return Rect2(p, n.size)


func _check(d: Dictionary, keys: Array, label: String) -> void:
	var card := PanelContainer.new()
	t.root.add_child(card)
	var anchors := {}
	card.add_child(Body.build(d, anchors))
	await t.process_frame
	await t.process_frame
	_layout(card)
	var body: Control = card.get_child(0).get_node("text")  # the title + subtitle column
	var block_h: float = body.get_combined_minimum_size().y
	t.ok(card.size.y <= block_h + 20.0, "%s: card %.0f px <= text block %.0f + 20" % [label, card.size.y, block_h])
	t.ok(card.size.y <= 64.0, "%s: two-dot card no taller than 64 px (was ~109)" % label)
	for k in keys:
		var dot: Control = anchors[k]
		var r := _rel(dot, card)
		t.ok(Rect2(Vector2.ZERO, card.size).encloses(r), "%s: dot %s inside the card" % [label, k])
		t.ok(r.size.x >= 14 and r.size.y >= 14, "%s: dot %s keeps its 14 px hit area" % [label, k])
		t.ok(r.end.y <= body.position.y + block_h + 6.0 + _rel(body, card).position.y, "%s: dot %s within the title/subtitle block" % [label, k])
	var r1 := _rel(anchors[keys[0]], card)
	var r2 := _rel(anchors[keys[1]], card)
	t.ok(r1.end.y <= r2.position.y, "%s: dots stacked, not overlapping" % label)
	t.ok(r1.position.y <= 12.0, "%s: first dot starts at the top" % label)
	t.root.remove_child(card)
	card.free()


func test_two_dot_cards() -> void:
	await _check(_dest("pgm_prv", ["pgm", "prv"], ["PGM", "PRV"]), ["d1#pgm", "d1#prv"], "pgm_prv")
	await _check(_dest("operator_gui", ["pgm", "prv"], ["1", "2"]), ["d1#pgm", "d1#prv"], "operator_gui")
