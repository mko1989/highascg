extends RefCounted
## WO-695 — re-patching selected heads (patch_edit_model.gd) and MVR re-patch keeping the operator's patch.

const P := preload("res://features/previs/fixtures/patch_edit_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const MV := preload("res://features/previs/mvr_model.gd")
var t

const TYPES := [{"id": "cb73a616bb97", "name": "Focus Profile", "modes": [{"name": "Standard Mode 40ch", "footprint": 40},
	{"name": "Basic Mode 36ch", "footprint": 36}]}]


func _head(id: String, address: int, mode := "Standard Mode 40ch") -> Dictionary:
	return F.normalize_fixture({"id": id, "name": id, "universe": 0, "address": address, "typeId": "cb73a616bb97",
		"mode": mode}, 0)


func test_owner_case_two_mvr_heads_to_36ch() -> void:
	var patch := [_head("mvr-b", 41), _head("mvr-a", 1), _head("fx1", 81, "Basic Mode 36ch")]
	var r := P.repatch(patch, TYPES, ["mvr-a", "mvr-b"], "Basic Mode 36ch", "artnet", 1, 1)
	t.ok(not r.has("error"), "fits: %s" % r.get("error", ""))
	var by := {}
	for f in r.patch:
		by[f.id] = f
	t.eq([by["mvr-a"].address, by["mvr-b"].address], [1, 37], "address order kept, packed by the 36-ch footprint")
	t.eq([by["mvr-a"].mode, by["mvr-a"].universe, by["mvr-a"].manual_patch], ["Basic Mode 36ch", 1, true], "mode + universe")
	t.eq(by["fx1"].universe, 0, "an unselected head is untouched")
	t.eq(r.next, 73, "next free address")


func test_overlap_and_past_512_refused() -> void:
	var patch := [_head("a", 1), _head("b", 41)]
	var r := P.repatch(patch, TYPES, ["b"], "", "artnet", 0, 20)
	t.ok(str(r.get("error", "")).contains("overlap a on channel 20"), "overlap: %s" % r.get("error", ""))
	r = P.repatch(patch, TYPES, ["b"], "", "artnet", 0, 480)
	t.ok(str(r.get("error", "")).contains("past 512"), "past 512")
	r = P.repatch(patch, TYPES, ["b"], "Nope", "artnet", 0, 100)
	t.ok(str(r.get("error", "")).contains("no mode"), "unknown mode")
	r = P.repatch(patch, TYPES, [], "", "artnet", 0, 1)
	t.ok(r.has("error"), "nothing selected")


func test_sacn_dest_and_self_overlap_ok() -> void:
	var patch := [_head("a", 1)]
	var r := P.repatch(patch, TYPES, ["a"], "", "sacn", 3, 5)
	t.eq([r.patch[0].protocol, r.patch[0].dest, r.patch[0].universe, r.patch[0].address], ["sacn", "", 3, 5], "sACN")
	r = P.repatch(patch, TYPES, ["a"], "", "artnet", 0, 2)
	t.ok(not r.has("error"), "moving onto its own old channels is fine")


func test_manual_patch_survives_normalize_and_mvr_repatch() -> void:
	var edited := _head("mvr-a", 1)
	edited["manual_patch"] = true
	edited["mode"] = "Basic Mode 36ch"
	edited["universe"] = 1
	t.eq(F.normalize_fixture(edited, 0).get("manual_patch"), true, "normalize keeps the flag")
	t.ok(not F.normalize_fixture(_head("x", 1), 0).has("manual_patch"), "absent unless set (no golden churn)")
	var incoming := [_head("mvr-a", 1), _head("mvr-b", 41)]
	var out := MV.merge_patch([F.normalize_fixture(edited, 0), _head("mvr-b", 300, "Basic Mode 36ch")], incoming)
	t.eq([out[0].mode, out[0].universe], ["Basic Mode 36ch", 1], "the operator's re-patch wins over the file")
	t.eq([out[1].mode, out[1].address], ["Standard Mode 40ch", 41], "an untouched head still takes the file's patch")
