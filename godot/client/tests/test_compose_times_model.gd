extends RefCounted
## WO-652 — the per-layer times on the Live 2D windows (port of template/multiview_overlay.js layer rows).

const M := preload("res://features/live/compose_times_model.gd")
var t

const LOOK := {"layers": [
	{"layerNumber": 10, "source": {"type": "media", "value": "PROJECTS/BG.mp4"}},
	{"layerNumber": 20, "source": {"type": "media", "value": "LOGO.mov"}},
	{"layerNumber": 30, "source": {"type": "route", "value": "route://5-2", "label": "DeckLink 2"}},
	{"layerNumber": 40, "source": {"type": "template", "value": "pip_border"}},
	{"layerNumber": 50, "source": {"type": "media", "value": ""}},
]}


static func _ch(layers: Dictionary) -> Dictionary:
	return {"layers": layers}


func test_rows_top_first_and_the_top_running_layer_is_big() -> void:
	var ch := _ch({"10": {"file": {"name": "BG.mp4", "elapsed": 37.0, "duration": 60.0}},
		"20": {"file": {"name": "LOGO.mov", "elapsed": 2.0, "duration": 8.0}}})
	var r := M.rows(LOOK, ch, "a", true, 0.0)
	t.eq(r.map(func(x: Dictionary) -> int: return x.num), [30, 20, 10], "top layer first; pip template and empty layer skipped")
	t.eq(r.map(func(x: Dictionary) -> bool: return x.top), [false, true, false], "the big row is the topmost RUNNING layer")
	t.eq(r[0].label, "L30  DeckLink 2", "a live source by its label")
	t.eq(r[2].label, "L10  BG", "media by the playing file, no extension")
	t.eq(M.time_text(r[2]), "0:37 / 1:00  (−0:23)", "elapsed / duration (−remaining)")
	t.eq(M.time_text(r[0]), "", "nothing running → no time")
	t.ok(absf(M.progress(r[1]) - 0.25) < 1e-6, "progress")


func test_pgm_bank_b_reads_the_upper_band_prv_never_does() -> void:
	var ch := _ch({"110": {"file": {"elapsed": 1.0, "duration": 10.0}}, "10": {"file": {"elapsed": 5.0, "duration": 10.0}}})
	var look := {"layers": [LOOK.layers[0]]}
	t.eq(M.rows(look, ch, "b", true, 0.0)[0].elapsed, 1.0, "PGM bank b → layer 110")
	t.eq(M.rows(look, ch, "b", false, 0.0)[0].elapsed, 5.0, "PRV is bank-less → layer 10")


func test_stale_osc_is_not_running() -> void:
	var ch := _ch({"10": {"_lastOscAt": 1000.0, "file": {"elapsed": 5.0, "duration": 10.0}}})
	var look := {"layers": [LOOK.layers[0]]}
	t.ok(M.rows(look, ch, null, true, 2000.0)[0].running, "fresh")
	var stale: Dictionary = M.rows(look, ch, null, true, 1000.0 + M.P.STALE_MS + 1.0)[0]
	t.ok(not stale.running and not stale.top, "stale → no time, not the big row")
	t.eq(M.rows({}, null, null, true, 0.0), [], "no look / no OSC → no rows")
