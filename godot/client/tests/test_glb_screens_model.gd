extends RefCounted

const M := preload("res://features/previs/glb_screens_model.gd")

var t


func test_saved_and_rule() -> void:
	t.eq(M.saved({}, "m1"), null, "no previs")
	t.eq(M.saved({"previs": {"stage": {}}}, "m1"), null, "no modelScreens")
	t.eq(M.is_screen("LED_Wall", null), true, "name rule led")
	t.eq(M.is_screen("Truss", null), false, "name rule other")
	var p := {"previs": {"stage": {"version": 1}}}
	M.store(p, "m1", ["b", "Truss"])
	t.eq(p.previs.stage, {"version": 1}, "stage kept")
	t.eq(M.saved(p, "m1"), ["Truss", "b"], "sorted names")
	t.eq(M.is_screen("Truss", M.saved(p, "m1")), true, "tag beats rule")
	t.eq(M.is_screen("LED_Wall", M.saved(p, "m1")), false, "untag beats rule")
	M.store(p, "m1", [])
	t.eq(M.saved(p, "m1"), [], "empty list = all untagged, not null")
