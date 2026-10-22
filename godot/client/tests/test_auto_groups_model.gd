extends RefCounted
## WO-680 — auto_groups_model.gd on a cut of the owner's Pabianice patch: rows per type (truss / floor / a ladder of
## Pixel Lines / a gapped FOH line), stage-right → stage-left order, SR / SL halves, one group per universe.

const A := preload("res://features/previs/fixtures/auto_groups_model.gd")
var t


func _fx(name: String, type: String, uni: int, addr: int, x: float, y: float, z: float, hang := "truss") -> Dictionary:
	return {"id": name, "name": name, "typeId": type, "protocol": "artnet", "universe": uni, "address": addr,
		"pose": {"x": x, "y": y, "z": z, "hang": hang}}


func _patch() -> Array:
	var p: Array = [
		_fx("Sharpy Plus 102", "sh", 1, 32, -3.94, 10.05, 6.19), _fx("Sharpy Plus 101", "sh", 1, 1, -5.57, 10.06, 6.19),
		_fx("Sharpy Plus 103", "sh", 1, 63, -2.33, 10.05, 6.19),
		_fx("Sharpy Plus 111", "sh", 3, 1, -4.32, 9.22, 0.7, "floor"), _fx("Sharpy Plus 112", "sh", 3, 32, -2.62, 9.21, 0.7, "floor"),
	]
	for i in 4:
		p.append(_fx("Pixel Line IP %d" % (1021 + i), "pl", 8, 1 + 68 * i, -5.9, 9.83, 4.25 - 1.03 * i))
		p.append(_fx("Pixel Line IP %d" % (1025 + i), "pl", 9, 1 + 68 * i, 4.22, 9.83, 4.28 - 1.03 * i))
	var xs := [-9.04, -8.14, -3.39, -2.49, 2.26, 3.16, 8.67, 9.57]
	for i in 8:
		p.append(_fx("Focus Profile %d" % (401 + i), "fp", 5, 1 + 40 * i, xs[i], -9.79 + (0.3 if i >= 6 else 0.0), 4.07))
	return p


func _named(groups: Array) -> Dictionary:
	var out := {}
	for g in groups:
		out[g.name] = g.ids
	return out


func test_rows_per_type_ordered_with_halves() -> void:
	var g := _named(A.by_position(_patch()))
	t.eq(g.keys(), ["Focus Profile", "Focus Profile SR", "Focus Profile SL", "Pixel Line IP", "Pixel Line IP SR",
		"Pixel Line IP SL", "Sharpy Plus · all", "Sharpy Plus · 6.2 m", "Sharpy Plus · floor"], "names, types A–Z, highest row first")
	t.eq(g["Sharpy Plus · 6.2 m"], ["Sharpy Plus 101", "Sharpy Plus 102", "Sharpy Plus 103"], "stage right → stage left")
	t.eq(g["Sharpy Plus · floor"], ["Sharpy Plus 111", "Sharpy Plus 112"], "floor mount is its own row; 2 → no halves")
	t.eq(g["Sharpy Plus · all"], ["Sharpy Plus 101", "Sharpy Plus 102", "Sharpy Plus 103", "Sharpy Plus 111",
		"Sharpy Plus 112"], "a type in several rows gets an 'all', row after row")
	t.eq((g["Focus Profile"] as Array).size(), 8, "a gapped FOH line stays one row")
	t.eq(g["Focus Profile SR"], ["Focus Profile 401", "Focus Profile 402", "Focus Profile 403", "Focus Profile 404"])
	t.eq(g["Pixel Line IP SR"], ["Pixel Line IP 1021", "Pixel Line IP 1022", "Pixel Line IP 1023", "Pixel Line IP 1024"],
		"a ladder is one row; top first within a column")


func test_by_address_one_group_per_universe() -> void:
	var g := A.by_address(_patch())
	t.eq(g.map(func(x: Dictionary) -> String: return x.name), ["Art-Net 1", "Art-Net 3", "Art-Net 5", "Art-Net 8", "Art-Net 9"])
	t.eq(g[0].ids, ["Sharpy Plus 101", "Sharpy Plus 102", "Sharpy Plus 103"], "address order")
	var sacn := _fx("Wash 1", "w", 12, 1, 0, 0, 6)
	sacn.protocol = "sacn"
	t.eq(A.by_address([sacn]).map(func(x: Dictionary) -> String: return x.name), ["sACN 12"])
	t.eq(A.by_position([]), [], "no patch → nothing")
