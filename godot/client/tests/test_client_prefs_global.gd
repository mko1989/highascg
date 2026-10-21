extends RefCounted
## WO-598 D slice 2 — core/client_prefs.gd: the node's GPU rows / DeckLink order / hardware policy win over this
## machine's cfg copy, invalid values never enter the mirror, own echoes and per-multiviewer keys are not changes,
## and only what the node lacks is pushed up. (No test calls post(): that would write to the live node.)

const CP := preload("res://core/client_prefs.gd")
var t


func _reset() -> void:
	CP.node = {}
	CP._listeners.clear()


func test_valid() -> void:
	t.ok(CP.valid("gpuLayout", [{"id": "gpu_p1", "hidden": true}]), "gpu rows")
	t.ok(not CP.valid("gpuLayout", [{"hidden": true}]), "a gpu row needs an id")
	t.ok(CP.valid("decklinkRearOrder", ["dl_1", "dl_2"]), "port ids")
	t.ok(not CP.valid("decklinkRearOrder", [1, 2]), "ids are strings")
	t.ok(CP.valid("hardwarePolicy", "keep_live"), "policy")
	t.ok(not CP.valid("hardwarePolicy", "always"), "unknown policy")
	t.ok(not CP.valid("multiviewPresets", []), "per-multiviewer keys are not global")


func test_reply_value_and_fallback() -> void:
	_reset()
	t.eq(CP.value("hardwarePolicy", "ask"), "ask", "before the first GET: this machine's copy")
	var seen := []
	CP.listen(func(keys: Array) -> void: seen.append(keys))
	CP.from_reply({"prefs": {"gpuLayout": [{"id": "gpu_p2", "label": "Main"}], "decklinkRearOrder": null,
		"hardwarePolicy": "bogus", "multiviewPresets": {}}})
	t.eq(CP.node.keys(), ["gpuLayout"], "valid global values only")
	t.eq(seen, [["loaded"]], "listeners hear the load")
	var rows: Variant = CP.value("gpuLayout", [])
	t.eq(rows[0].label, "Main", "the node's copy wins")
	rows[0].label = "changed"
	t.eq(CP.node.gpuLayout[0].label, "Main", "value() hands out a copy")
	t.eq(CP.value("decklinkRearOrder", ["local"]), ["local"], "none on the node → local")
	CP.from_reply(null)
	t.eq(CP.node, {}, "no body → empty mirror")
	_reset()


func test_write_push_and_broadcast() -> void:
	_reset()
	var ids := ["dl_2", "dl_1"]
	t.eq(CP.write("decklinkRearOrder", ids), {"key": "decklinkRearOrder", "value": ids}, "POST body has no n")
	ids.append("dl_3")
	t.eq(CP.node.decklinkRearOrder, ["dl_2", "dl_1"], "the mirror keeps its own copy")
	var push := CP.to_push({"decklinkRearOrder": ["x"], "gpuLayout": [{"id": "gpu_p1"}], "hardwarePolicy": "nope"})
	t.eq(push, [{"key": "gpuLayout", "value": [{"id": "gpu_p1"}]}], "only valid values the node lacks")
	var seen := []
	CP.listen(func(keys: Array) -> void: seen.append(keys))
	t.ok(not CP.apply_broadcast({"key": "decklinkRearOrder", "value": ["dl_2", "dl_1"]}), "own echo")
	t.ok(not CP.apply_broadcast({"key": "multiviewPresets", "n": 2, "value": []}), "per-multiviewer key")
	t.ok(CP.apply_broadcast({"key": "hardwarePolicy", "value": "apply_saved"}), "another client's write")
	t.eq(CP.value("hardwarePolicy", "ask"), "apply_saved", "applied")
	t.ok(CP.apply_broadcast({"key": "hardwarePolicy", "value": null}), "a removal")
	t.eq(CP.value("hardwarePolicy", "ask"), "ask", "removed → local again")
	t.eq(seen, [["hardwarePolicy"], ["hardwarePolicy"]], "listeners hear real changes only")
	CP.write("decklinkRearOrder", null)
	t.ok(not CP.node.has("decklinkRearOrder"), "write null removes")
	_reset()
