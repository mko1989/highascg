extends RefCounted
## WO-1029 — compose_reconcile.gd: the Live windows follow the screen list (box B, 10.11).

const RC := preload("res://features/live/compose_reconcile.gd")
var t

const R := {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.2}


func _cell(role: String, i: int, extra := {}) -> Dictionary:
	var c := {"id": "%s_%d" % [role, i + 1], "role": role, "mainIndex": i, "rect": R.duplicate(), "surface": "compose"}
	c.merge(extra, true)
	return c


func _ids(cells: Array) -> Array:
	return cells.map(func(c: Dictionary) -> String: return str(c.id))


## Box B: index 0 is cabled on the other server, index 1 is here, PGM only.
func _box_b() -> Dictionary:
	return {"screenCount": 2, "channelsWhereCabled": true, "programChannels": [null, 2], "previewChannels": [null, null],
		"screenLabels": ["PGM/PRV 1", "PGM/PRV 3"], "previewEnabledByMain": [true, false],
		"screenHosts": [{"idx": 0, "destId": "dA", "here": false}, {"idx": 1, "destId": "dB", "here": true}]}


func test_box_b_saved_four_screens() -> void:
	var saved := [_cell("pgm", 0), _cell("prv", 0), _cell("pgm", 1), _cell("pgm", 2), _cell("prv", 2), _cell("pgm", 3), _cell("prv", 3)]
	var r := RC.reconcile(saved, _box_b())
	t.ok(r.changed, "changed")
	t.eq(_ids(r.cells), ["pgm_1", "prv_1", "pgm_2"], "remote placeholders for 0, the wall at 1, nothing for 2 and 3")
	t.eq(r.cells[2].destId, "dB", "the destination id is stored next to the index")
	t.eq(RC.screen_label(r.cells[2], _box_b()), "PGM/PRV 3", "label from the destination, not S3")


func test_pgm_only_has_no_prv() -> void:
	var r := RC.reconcile([_cell("pgm", 1), _cell("prv", 1)], _box_b(), true)
	t.eq(_ids(r.cells), ["pgm_2"], "PRV of a PGM-only screen dropped, none added")


func test_deleted_destination_re_resolves_by_id() -> void:
	var cm := {"screenCount": 2, "programChannels": [1, 3], "previewChannels": [2, 4],
		"screenHosts": [{"idx": 0, "destId": "dA"}, {"idx": 1, "destId": "dC"}]}
	var saved := [_cell("pgm", 0, {"destId": "dA"}), _cell("pgm", 1, {"destId": "dB"}), _cell("pgm", 2, {"destId": "dC"}), _cell("prv", 2, {"destId": "dC"})]
	var r := RC.reconcile(saved, cm)
	t.eq(_ids(r.cells), ["pgm_1", "pgm_2", "prv_2"], "dB gone, dC moved from 2 to 1")
	t.eq(r.cells[1].mainIndex, 1, "mainIndex follows")


func test_add_missing_and_passthrough() -> void:
	var cm := {"screenCount": 2, "programChannels": [1, 3], "previewChannels": [2, 4]}
	var src := {"id": "src_x", "role": "mvcell", "mainIndex": 0, "rect": R.duplicate()}
	var r := RC.reconcile([_cell("pgm", 0), _cell("prv", 0), src], cm, true)
	t.eq(_ids(r.cells), ["pgm_1", "prv_1", "src_x", "pgm_2", "prv_2"], "screen 2 gets PGM + PRV")
	var same := RC.reconcile([_cell("pgm", 0), _cell("pgm", 1)], cm)
	t.ok(not same.changed, "an unchanged list stays untouched (no ids anywhere)")
	t.ok(RC.signature(cm) != RC.signature(_box_b()), "the signature tells a changed screen list")
