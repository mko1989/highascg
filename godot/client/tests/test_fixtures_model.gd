extends RefCounted
## WO-615 T3 — fixtures_model.gd: footprints from GDTF summaries, free addresses, add-from-type, usage, dmx list.

const M := preload("res://features/previs/fixtures/fixtures_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
var t

const TYPES := [{"id": "0123456789ab", "name": "Robin LedPOINTE", "shortName": "LedPOINTE",
	"modes": [{"name": "Std", "footprint": 39, "channels": 33}, {"name": "Zero", "footprint": 0}]}]


func test_footprints_and_free_addresses() -> void:
	var gen := F.normalize_fixture({"id": "g", "address": 1}, 0)
	t.eq(M.fixture_footprint(gen, TYPES), 4, "generic profile: highest offset")
	var typed := F.normalize_fixture({"id": "s", "typeId": "0123456789ab", "mode": "Std", "address": 10}, 1)
	t.eq(M.fixture_footprint(typed, TYPES), 39, "typed: the mode footprint")
	var occ := M.occupied([gen, typed], "artnet", 0, F.DEFAULT_DEST, TYPES)
	t.eq([occ[0], occ[3], occ[4], occ[9], occ[47], occ[48]], [true, true, false, true, true, false])
	t.eq(M.first_free(occ, 5), 5, "the 5-channel gap between them")
	t.eq(M.first_free(occ, 6), 49, "too narrow → after the typed head")
	var full := []
	full.resize(512)
	full.fill(true)
	t.eq(M.first_free(full, 1), 0)
	t.eq(M.occupied([gen], "sacn", 0, "", TYPES).count(true), 0, "other protocol / universe / dest is free")


func test_add_typed_packs_after_the_patch() -> void:
	var gen := F.normalize_fixture({"id": "fx1", "address": 1}, 0)
	var add := M.add_typed([gen], TYPES, "0123456789ab", "Std", 3, "artnet", 0)
	t.eq(add.map(func(f: Dictionary) -> Array: return [f.id, f.name, f.address]),
		[["fx2", "LedPOINTE 1", 5], ["fx3", "LedPOINTE 2", 44], ["fx4", "LedPOINTE 3", 83]])
	t.eq([add[0].typeId, add[0].mode, add[0].follow, add[0].dest], ["0123456789ab", "Std", 0, F.DEFAULT_DEST])
	t.eq([add[0].pose.x, add[2].pose.x], [-1.0, 1.0], "spread along X")
	var many := M.add_typed([], TYPES, "0123456789ab", "Std", 20, "sacn", 2)
	t.eq(many.size(), 13, "a universe holds 13 × 39 ch")
	t.eq([many[0].protocol, many[0].universe, many[0].dest], ["sacn", 2, ""])
	t.eq(M.add_typed([], TYPES, "0123456789ab", "Zero", 1, "artnet", 0), [], "no footprint → nothing")
	t.eq(M.add_typed([], TYPES, "ffffffffffff", "Std", 1, "artnet", 0), [])


func test_usage_lines_and_universe_toggle() -> void:
	var lines := M.usage_lines([{"protocol": "sacn", "universe": 1, "dest": "239.255.0.1:5568", "used": 78, "live": true,
		"fixtures": [{"problem": null}, {"problem": "x"}]}, "junk"])
	t.eq(lines, PackedStringArray(["sACN 1 → 239.255.0.1:5568 · 78 / 512 ch · 2 fixtures (1 not output) · sending"]))
	var d := M.toggle_universe({"universes": ["artnet:0"]}, "sacn:1", true)
	t.eq(d.universes, ["artnet:0", "sacn:1"])
	t.eq(M.toggle_universe(d, "artnet:0", false).universes, ["sacn:1"])
	t.eq(M.toggle_universe(d, "sacn:1", true).universes, ["artnet:0", "sacn:1"], "no duplicates")
