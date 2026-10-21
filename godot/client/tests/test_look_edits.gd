extends RefCounted
## WO-600 I — transition edits behave like the web SceneState.

const E := preload("res://features/live/look_edits.gd")
var t


func _root() -> Dictionary:
	return {"activeScreenIndex": 0, "globalDefaultTransition": {"type": "MIX", "duration": 12, "tween": "linear"},
		"scenes": [{"id": "a", "mainScope": "0"}, {"id": "b", "mainScope": "1", "defaultTransition": {"type": "CUT", "duration": 0, "tween": "linear"}}, {"id": "c", "mainScope": "all"}]}


func test_global_default_merges() -> void:
	var r := _root()
	var g := E.set_global_default(r, {"type": "WIPE"})
	t.eq(g, {"type": "WIPE", "duration": 12, "tween": "linear"}, "type changed, rest kept")
	t.eq(r.globalDefaultTransition.type, "WIPE", "stored in the envelope")


func test_look_transition() -> void:
	var r := _root()
	t.ok(E.set_look_transition(r, "b", {"duration": 30, "type": "MIX"}), "known look")
	t.eq(r.scenes[1].defaultTransition, {"type": "MIX", "duration": 30, "tween": "linear"}, "merged onto the look")
	t.ok(not E.set_look_transition(r, "zzz", {}), "unknown look refused")
	E.set_look_transition(r, "a", {"type": "PUSH"})
	t.eq(r.scenes[0].defaultTransition.duration, 12, "look without one starts from defaultTransition() (auto 12)")


func test_apply_to_all_follows_web_rule() -> void:
	var r := _root()
	E.set_global_default(r, {"type": "SLIDE", "duration": 20})
	t.eq(E.apply_default_to_all(r, 1), 3, "single main: every look")
	r = _root()
	t.eq(E.apply_default_to_all(r, 2), 2, "two mains: active main 0's deck = look a + global look c")
	t.eq(r.scenes[1].defaultTransition.type, "CUT", "main-1 look untouched")


func test_short_label() -> void:
	t.eq(E.short_label({"type": "MIX", "duration": 12}, 50.0), "MIX auto 25 fr", "auto sentinel")
	t.eq(E.short_label({"type": "WIPE + ANIMATE", "duration": 30}, 50.0), "Wipe + Animate 30 fr", "label")
	t.eq(E.short_label({"type": "CUT", "duration": 0}, 50.0), "CUT", "cut")
	t.eq(E.short_label(null, 50.0), "", "none")


func test_reorder_layers_like_web() -> void:
	var ls := [{"layerNumber": 12, "n": "c"}, {"layerNumber": 10, "n": "a"}, {"layerNumber": 11, "n": "b"}]
	var out: Variant = E.reorder_layers(ls, 0, 2)
	t.eq((out as Array).map(func(l: Dictionary) -> String: return l.n), ["b", "c", "a"], "a moved to the top of the stack (visual order by layerNumber)")
	t.eq((out as Array).map(func(l: Dictionary) -> int: return int(l.layerNumber)), [10, 11, 12], "renumbered from 10")
	t.ok(E.reorder_layers(ls, 1, 1) == null, "same index → null")
	t.ok(E.reorder_layers(ls, 0, 5) == null, "out of range → null")


func test_remove_look() -> void:  # WO-623 B — web sceneState.removeScene
	var root := {"scenes": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
		"lookPresets": [{"id": "p1", "sceneId": "b"}, {"id": "p2", "sceneId": "c"}, "junk"]}
	t.ok(E.remove_look(root, "b"), "found")
	t.eq(root.scenes.map(func(s: Dictionary) -> String: return s.id), ["a", "c"], "order kept")
	t.eq(root.lookPresets.size(), 2, "the preset of b went; others (and junk) stay")
	t.eq(root.lookPresets[0].id, "p2", "c's preset kept")
	t.ok(not E.remove_look(root, "zz"), "unknown id → false")
	t.ok(not E.remove_look({}, "a"), "no scenes")


func test_duplicate_look_wo656() -> void:
	var root := {"scenes": [{"id": "a", "name": "Intro", "mainScope": "0", "layers": [{"layerNumber": 10, "fill": {"x": 0.1}}]},
		{"id": "b", "name": "Intro (copy)"}]}
	var d := E.duplicate_look(root, "a", "z")
	t.eq(root.scenes.map(func(s: Dictionary) -> String: return s.id), ["a", "z", "b"], "the copy sits right after the original")
	t.eq([d.id, d.name, d.mainScope], ["z", "Intro (copy 2)", "0"], "fresh id, next free copy name, same scope")
	d.layers[0].fill.x = 0.9
	t.eq(root.scenes[0].layers[0].fill.x, 0.1, "deep copy: editing the copy leaves the original")
	t.eq(E.duplicate_look(root, "nope", "y"), {}, "unknown look → nothing")
	t.eq(E.copy_name([], "  "), "Look (copy)", "blank name → Look (copy)")
