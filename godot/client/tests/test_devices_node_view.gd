extends RefCounted
## WO-605 slice 10b — node_view_model.gd and cable_model.gd's Node view curves against the web (device-view-caspar-
## render-simple.js renderCasparBandSimple on a fake DOM; buildSmoothSimpleMap / buildSmoothSimpleCable lifted from
## device-view-cables.js) run under Node: tests/golden/devices_node_view.json. Cases: the live box, a rich payload
## (IN / OUT / faulted / inherited DeckLink, USB video, active stream / record / virtual cam, audio outputs, a tagged
## label), a saved DeckLink order, an empty payload and the ten GPU-layout fixtures (with their saved prefs).

const NV := preload("res://features/devices/node_view_model.gd")
const Model := preload("res://features/devices/devices_model.gd")
const CM := preload("res://features/devices/cable_model.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_node_view.json"))
	return _g


func test_sections() -> void:
	for c in _golden().cases:
		var p: Dictionary = c.payload
		var m := Model.build(p, null, null, c.deck if c.deck is Array else [], c.prefs if c.prefs is Array else [])
		var got := NV.sections(m.slots, p)
		t.eq(got.map(func(s: Dictionary) -> String: return s.title), c.sections.map(func(s: Dictionary) -> String: return s.title),
			c.name + ": sections")
		for i in mini(got.size(), c.sections.size()):
			var g: Dictionary = got[i]
			var w: Dictionary = c.sections[i]
			var what := "%s: %s" % [c.name, w.title]
			t.eq(g.add != "", w.add, what + ": +")
			if w.add:
				t.eq("Add new %s output" % g.title.to_lower(), w.plusTitle, what + ": + tooltip")
			t.eq(g.note, w.note, what + ": none-yet note")
			t.eq(g.nodes.size(), w.nodes.size(), what + ": node count")
			for k in mini(g.nodes.size(), w.nodes.size()):
				var n: Dictionary = g.nodes[k]
				var x: Dictionary = w.nodes[k]
				# a connected GPU: the web's "Connected" vs the monitor · resolution · rate it means (node_view_model.gd)
				var sub: String = x.sub if x.intended == null else x.intended
				t.eq([n.id, n.label, n.sub, n.dim, n.input, n.icon], [x.id, x.label, sub, x.dim, x.input, x.icon],
					"%s: node %d" % [what, k])
				t.ok(str(x.aria).ends_with(" — " + NV.kind_title(n.kind)), "%s: node %d kind title" % [what, k])


static func _d(p: Array) -> Array:
	var out := []
	for v in p:
		out.append_array([v.x, v.y])
	return out


static func _parse(d: String) -> Array:
	var out := []
	for tok in d.replace(",", " ").split(" ", false):
		if tok.is_valid_float():
			out.append(float(tok))
	return out


func _near(got: Array, want: Array, what: String) -> void:
	var ok := got.size() == want.size()
	for i in mini(got.size(), want.size()):
		ok = ok and absf(got[i] - want[i]) <= 0.051
	t.ok(ok, "%s: %s vs %s" % [what, str(got), str(want)])


func test_simple_cables() -> void:
	for set in _golden().cables:
		var fans := CM.simple_fans(set.edges)
		var at := func(id: String) -> Vector2: return Vector2(set.pos[id][0], set.pos[id][1])
		for e in set.edges:
			if not set.d.has(str(e.get("id"))):
				continue
			_near(_d(CM.simple_curve(e, at.call(e.sourceId), at.call(e.sinkId), fans)), _parse(set.d[e.id]), "cable " + str(e.id))
		for g in set.ghosts:
			_near(_d(CM.simple_curve({"id": "ghost", "sourceId": g[0], "sinkId": "ghost-sink"}, at.call(g[0]), Vector2(333.3, 444.4), fans)),
				_parse(g[1]), "ghost from " + str(g[0]))
	var pts := CM.bezier([Vector2(0, 0), Vector2(10, 0), Vector2(20, 10), Vector2(30, 10)], 4)
	t.eq(pts.size(), 5, "n segments → n + 1 points")
	t.eq([pts[0], pts[4]], [Vector2(0, 0), Vector2(30, 10)], "ends on the anchors")
