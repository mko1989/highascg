extends RefCounted
## WO-615 T8 — look_fixtures_model.gd: fixture states per look in project.fixtures.looks (store / count / clear,
## normalize twin of fixture-looks.js) and that the fixtures slice keeps them.

const LF := preload("res://features/previs/fixtures/look_fixtures_model.gd")
const FM := preload("res://features/previs/tracking/follow_model.gd")
var t


func test_store_count_clear() -> void:
	var looks := LF.store({}, "L1", {"fx1": {"Dimmer": 1}, "fx2": {"Color1": {"set": "Red"}}, "fx3": {}})
	t.eq(looks, {"L1": {"values": {"fx1": {"Dimmer": 1}, "fx2": {"Color1": {"set": "Red"}}}}}, "empty fixture maps dropped")
	t.eq(LF.count(looks, "L1"), 2)
	t.eq(LF.count(looks, "nope"), 0)
	looks = LF.store(looks, "L2", {"fx1": {"Dimmer": 0.5}})
	t.eq(LF.store(looks, "L1", {"fx9": {"Pan": 10}})["L1"], {"values": {"fx9": {"Pan": 10}}}, "re-store replaces")
	t.eq(LF.store(looks, "L1", {}).has("L1"), false, "an empty programmer clears the entry")
	t.eq(LF.clear(looks, "L1").keys(), ["L2"])
	t.eq(LF.count(looks, "L1"), 2, "inputs are not mutated")


func test_normalize_and_slice() -> void:
	t.eq(LF.normalize_looks({"L1": {"values": {"a": {"Dimmer": 1}, "b": 5}}, "L2": "junk", "L3": {"values": []}}),
		{"L1": {"values": {"a": {"Dimmer": 1}}}})
	t.eq(LF.normalize_looks([1, 2]), {})
	var slice := FM.normalize({"looks": {"L1": {"values": {"fx1": {"Dimmer": 1}}}}})
	t.eq(slice.looks, {"L1": {"values": {"fx1": {"Dimmer": 1}}}}, "the fixtures slice keeps its looks")
	t.eq(FM.normalize(slice), slice, "and stays idempotent")
	t.eq(FM.normalize({}).looks, {})
