extends RefCounted
## WO-859 — VR: the left trigger held adds to the selection (ctrl / cmd), the right stick flies up / down.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
var t


func test_fly() -> void:
	t.eq(Walk.fly(0.0, Vector2(0, 1), 1.0), Walk.FLY_SPEED, "a full push up rises FLY_SPEED a second")
	t.eq(Walk.fly(2.0, Vector2(0, -1), 1.0), 2.0 - Walk.FLY_SPEED, "down lowers")
	t.eq(Walk.fly(0.5, Vector2(0, -1), 1.0), 0.0, "never below the floor")
	t.eq(Walk.fly(1.0, Vector2(0, 0.1), 1.0), 1.0, "a resting stick drifts nothing")
	t.eq(Walk.fly(1.0, Vector2(0.9, 0.5), 1.0), 1.0, "x outweighs y: a turn, not a flight")


func test_turn_x() -> void:
	t.eq(Walk.turn_x(Vector2(0.5, 0.25)), 0.5, "sideways turns")
	t.eq(Walk.turn_x(Vector2(0.75, 0.8)), 0.0, "a diagonal flight never snaps a turn")


func test_add_held() -> void:
	t.ok(Walk.add_held(true, false), "left trigger held = ctrl / cmd")
	t.ok(Walk.add_held(false, true), "the left grip still adds")
	t.ok(not Walk.add_held(false, false), "neither: a plain pick replaces")
