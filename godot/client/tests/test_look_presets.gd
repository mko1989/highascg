extends RefCounted
## WO-601 look presets (web scene-state-preset-actions.js / inspector-panel-presets-modes.js): save captures each
## screen's bus, names stay unique, overwrite keeps the source kind, the card says what it covers and if it is on PRV.

const M := preload("res://features/live/look_preset_model.gd")
var t

const BUSES := {0: {"prv": "A", "pgm": "B"}, 1: {"prv": "", "pgm": "C"}}


func test_capture_and_make() -> void:
	t.eq(M.capture_items("prv", [0, 1], BUSES, ""), [{"mainIdx": 0, "sceneId": "A", "sourceKind": "prv"}], "screen 2 has no PRV look")
	t.eq(M.capture_items("pgm", [0, 1], BUSES, "").map(func(i: Dictionary) -> String: return i.sceneId), ["B", "C"], "both PGMs")
	t.eq(M.capture_items("editing", [1], BUSES, "E"), [{"mainIdx": 1, "sceneId": "E", "sourceKind": "editing"}], "open look on this screen")
	t.eq(M.capture_items("editing", [0], BUSES, ""), [], "no open look")
	var items := M.capture_items("pgm", [0, 1], BUSES, "")
	var p := M.make_preset([{"name": "Show"}], "show", items, "id1", 5)
	t.eq(p.name, "show (2)", "unique, case-insensitive (web uniqueLookPresetName)")
	t.eq([p.sceneId, p.sourceKind, p.targetMain, p.createdAt], ["B", "pgm", 0, 5], "legacy fields from the first item")
	t.eq(M.make_preset([], "  ", items, "x", 0), {}, "a blank name saves nothing")
	t.eq(M.make_preset([], "X", [], "x", 0), {}, "nothing on the bus saves nothing")
	t.eq(M.unique_name([], ""), "Look preset", "default name")


func test_overwrite_remove_and_card() -> void:
	var p := M.make_preset([], "P", M.capture_items("pgm", [0, 1], BUSES, ""), "id1", 1)
	t.ok(not M.overwrite(p, [], 9), "nothing to capture → unchanged")
	t.eq(p.createdAt, 1, "untouched")
	t.ok(M.overwrite(p, M.capture_items("prv", [0], BUSES, ""), 9), "overwrite")
	t.eq([p.sceneId, p.sourceKind, p.items.size(), p.createdAt], ["A", "prv", 1, 9], "new items")
	var list := [p, {"id": "other"}]
	t.ok(M.remove(list, "id1") and list.size() == 1, "removed")
	t.ok(not M.remove(list, "nope"), "unknown id")
	var two := M.make_preset([], "Both", M.capture_items("pgm", [0, 1], BUSES, ""), "id2", 1)
	t.eq(M.meta_line(two, true), "PGM · mains 1, 2", "multi-screen meta")
	t.eq(M.meta_line({"sourceKind": "editing", "targetMain": 0, "items": [{"mainIdx": 0}]}, false), "Open look · main 1 · look missing", "single + missing")
	t.eq(M.mains_of({"targetMain": 1}), [1], "legacy preset")


func test_loaded_on_prv() -> void:
	t.ok(M.loaded_on_prv({"items": [{"mainIdx": 0, "sceneId": "A"}]}, BUSES), "A is on PRV 1")
	t.ok(not M.loaded_on_prv({"items": [{"mainIdx": 0, "sceneId": "A"}, {"mainIdx": 1, "sceneId": "C"}]}, BUSES), "every item must be")
	t.ok(M.loaded_on_prv({"sceneId": "A", "targetMain": 0}, BUSES), "legacy single look")


## WO-781 — E2 destinations: an empty highlighted screen is saved (recall clears it), PRV = PGM still captures,
## the card names each destination, and the destination selection toggles / is replaced by a recall.
func test_e2_destinations() -> void:
	var items := M.capture_items("prv", [0, 1], BUSES, "", true)
	t.eq(items[1], {"mainIdx": 1, "sceneId": "", "sourceKind": "prv", "empty": true}, "empty destination kept")
	t.eq(M.capture_items("editing", [0], BUSES, "", true), [], "no open look is never an empty destination")
	var p := M.make_preset([], "E", [items[1], items[0]], "e1", 1)
	t.eq([p.sceneId, p.targetMain], ["A", 0], "legacy fields from the first destination with a look")
	t.eq(M.dest_line(p, {"A": "Look A"}), "2 — · 1 Look A", "card line: — = empty")
	t.eq(M.dest_line({"items": [{"mainIdx": 0, "sceneId": "gone"}]}, {}), "1 ?", "deleted look")
	var same := {0: {"prv": "", "pgm": "B"}}
	t.eq(M.capture_buses(same, {0: "B"})[0].prv, "B", "deck blanks PRV = PGM; a save still sees B")
	t.eq(M.capture_buses(BUSES, {})[0].prv, "A", "untouched otherwise")
	t.ok(M.loaded_on_bus({"items": [{"mainIdx": 0, "sceneId": "B"}, {"mainIdx": 1, "sceneId": "C"}]}, BUSES, "pgm"), "on PGM")
	t.ok(M.loaded_on_bus({"items": [{"mainIdx": 1, "sceneId": "", "empty": true}]}, BUSES, "prv"), "empty PRV matches an empty destination")
	var D := preload("res://features/live/destinations.gd")
	D.set_only([])
	D.toggle(1)
	D.toggle(0)
	t.eq(D.selected(), [0, 1], "sorted")
	D.toggle(1)
	t.eq(D.selected(), [0], "toggled off")
	D.set_only([2, 1])
	D.prune(2)
	t.eq(D.selected(), [1], "recall replaces, prune drops screens that went away")
	D.set_only([])
