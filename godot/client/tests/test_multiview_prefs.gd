extends RefCounted
## WO-598 D — mv_prefs.gd: the node copy wins, ui.cfg is the fallback, multiviewer 1's layout is never a pref,
## own echoes do not count as changes, and only entries the node lacks are pushed up.

const P := preload("res://features/multiview/mv_prefs.gd")
var t


func _snap(x: float) -> Dictionary:
	return {"cells": [{"id": "cell_a", "x": x}], "canvasWidth": 1920, "canvasHeight": 1080}


func test_keys() -> void:
	t.eq(P.pref_key("presets", 1), "multiviewPresets", "presets of multiviewer 1 are a node pref")
	t.eq(P.pref_key("layout", 1), "", "multiviewer 1's layout is the project slice")
	t.eq(P.pref_key("layout", 2), "multiviewLayouts", "multiviewer 2 layout")
	t.eq(P.cfg_key("presets", 3), "presets_3", "ui.cfg key")
	t.eq(P.cfg_key("layout", 2), "layout_2", "ui.cfg key")


func test_from_reply_and_stored() -> void:
	var prefs := P.from_reply({"prefs": {"multiviewPresets": {"2": [_snap(7), null, null, null]}, "junk": {}, "multiviewLayouts": 3}})
	t.eq(prefs.keys(), ["multiviewPresets", "multiviewLayouts"], "known keys only")
	t.eq(prefs.multiviewLayouts, {}, "malformed → empty")
	t.eq(P.from_reply(null), P.empty(), "no body → empty")
	var got: Variant = P.stored(prefs, "presets", 2, [])
	t.eq(got[0].cells[0].x, 7.0, "node copy wins")
	got[0].cells[0].x = 99
	t.eq(prefs.multiviewPresets["2"][0].cells[0].x, 7.0, "stored() hands out a copy")
	t.eq(P.stored(prefs, "presets", 3, ["local"]), ["local"], "fallback to ui.cfg")
	t.eq(P.stored(prefs, "layout", 1, {"x": 1}), {"x": 1}, "multiviewer 1 layout never read from prefs")


func test_write_and_broadcast() -> void:
	var prefs := P.empty()
	var body: Variant = P.write(prefs, "layout", 2, _snap(3))
	t.eq(body, {"key": "multiviewLayouts", "n": 2, "value": _snap(3)}, "POST body")
	t.eq(P.write(prefs, "layout", 1, _snap(3)), null, "multiviewer 1 layout: no POST")
	t.ok(not P.apply_broadcast(prefs, {"key": "multiviewLayouts", "n": 2, "value": _snap(3)}), "own echo is not a change")
	t.ok(P.apply_broadcast(prefs, {"key": "multiviewLayouts", "n": 2, "value": _snap(4)}), "another client's write is")
	t.eq(prefs.multiviewLayouts["2"].cells[0].x, 4.0, "mirror updated")
	t.ok(P.apply_broadcast(prefs, {"key": "multiviewLayouts", "n": 2, "value": null}), "removal")
	t.ok(not prefs.multiviewLayouts.has("2"), "removed")
	t.ok(not P.apply_broadcast(prefs, {"key": "other", "n": 2, "value": 1}), "unknown key ignored")
	t.ok(not P.apply_broadcast(prefs, "x"), "junk ignored")


func test_to_push() -> void:
	var prefs := P.from_reply({"prefs": {"multiviewPresets": {"2": [null, null, null, null]}}})
	var local := {"presets_1": [_snap(1), null, null, null], "presets_2": [_snap(2), null, null, null], "layout_1": _snap(9),
		"layout_3": _snap(3), "layout_4": {}, "presets_4": [], "presets_3": [null, null, null, null]}
	var push := P.to_push(prefs, local)
	t.eq(push.map(func(b: Dictionary) -> Array: return [b.key, b.n]), [["multiviewPresets", 1], ["multiviewLayouts", 3]],
		"only what the node lacks; never multiviewer 1's layout; empty entries skipped")
