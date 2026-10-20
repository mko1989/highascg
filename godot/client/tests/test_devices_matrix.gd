extends RefCounted
## WO-605 slice 10 — matrix_model.gd against the web Matrix view (device-view-matrix-ports.js extractMatrixPorts +
## device-view-matrix.js renderMatrix) run under Node on a fake DOM: tests/golden/devices_matrix.json. Each case =
## a payload (the live box, a rich one with split / pinned / virtual destinations, pixel maps with unsorted outs,
## every suggested kind and ghost edge ends, no graph at all, and the seven host-channel payloads), its rows /
## columns, the header-click targets, the crosspoint grid, then crosspoint clicks: the deviceGraph each POSTs (a
## failed POST leaves the graph) and the grid after the reload.

const M := preload("res://features/devices/matrix_model.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_matrix.json"))
	return _g


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


static func _grid(payload: Dictionary, ports: Dictionary) -> Array:
	return ports.sources.map(func(s: Dictionary) -> Array:
		return ports.sinks.map(func(k: Dictionary) -> bool: return M.active(payload, s, k)))


func test_matrix_replay() -> void:
	for c in _golden().cases:
		var p: Dictionary = c.payload.duplicate(true)
		var ports := M.ports(p)
		t.eq(_norm(ports), _norm(c.ports), c.name + ": rows / columns")
		t.eq(ports.sinks.map(func(k: Dictionary) -> bool: return M.single_input_sink(p, k.id)), c.single, c.name + ": single-input sinks")
		var heads := {"sinks": [], "sources": []}
		for side in heads:
			for x in ports[side]:
				var h := M.header_target(x.id)
				heads[side].append(["DEST", h[1]] if h[0] == "dest" else ["SELECT", "conn:" + h[1]])
		t.eq(heads, c.heads, c.name + ": header clicks")
		t.eq(_grid(p, ports), c.init, c.name + ": grid")
		for st in c.steps:
			var what := "%s: click %d,%d" % [c.name, st.row, st.col]
			var g := M.toggle(p, ports.sources[st.row], ports.sinks[st.col], st.id)
			t.eq(_norm(g), _norm(st.calls[0][2].deviceGraph), what + ": posted graph")
			if st.errors == 0:
				p.graph = g
			ports = M.ports(p)
			t.eq(_norm(ports), _norm(st.ports), what + ": rows / columns after")
			t.eq(_grid(p, ports), st.grid, what + ": grid after")


func test_edge_id_shape() -> void:
	t.ok(RegEx.create_from_string("^edge_\\d{13}_\\d{1,3}$").search(M.new_edge_id()) != null, "edge_<ms>_<0..999>")
