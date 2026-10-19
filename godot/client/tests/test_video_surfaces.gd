extends RefCounted
## WO-617 T1 — surface holders: a role is read/leased only while ≥ 1 owner holds it.

const H := preload("res://video/surface_holders.gd")
var t


func test_hold_drop() -> void:
	var h := H.new()
	var a := RefCounted.new()
	var b := RefCounted.new()
	t.ok(not h.is_held("pgm1"), "nothing held initially")
	t.ok(h.hold("pgm1", a), "first holder reported (lease immediately)")
	t.ok(not h.hold("pgm1", b), "second holder is not first")
	t.ok(not h.hold("pgm1", a), "re-hold by the same owner is idempotent")
	h.drop("pgm1", a)
	t.ok(h.is_held("pgm1"), "still held by b")
	h.drop("pgm1", b)
	t.ok(not h.is_held("pgm1"), "released when the last holder drops")
	h.drop("pgm1", b)
	t.ok(not h.is_held("pgm1"), "dropping twice is harmless")


func test_drop_all() -> void:
	var h := H.new()
	var a := RefCounted.new()
	var b := RefCounted.new()
	h.hold("pgm1", a)
	h.hold("prv1", a)
	h.hold("prv1", b)
	h.drop_all(a)
	t.eq(h.roles(), ["prv1"], "only the role b still holds remains")


func test_runtime_roles() -> void:
	for r in ["pgm1", "prv4", "in1", "in16", "ch1", "ch99"]:
		t.ok(H.is_runtime_role(r), r)
	for r in ["opgui", "pgm5", "in0", "in17", "ch0", "ch01", "ch100", "in1x", ""]:
		t.ok(not H.is_runtime_role(r), "not leased: " + r)
