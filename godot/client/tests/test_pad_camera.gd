extends RefCounted
## WO-1067 — game controllers: never the GUI (pad_guard.gd), the Previs camera's stick maths (pad_camera.gd).

const P := preload("res://features/previs/pad_camera.gd")
const Guard := preload("res://app/pad_guard.gd")
var t


func test_no_action_keeps_a_gamepad_binding() -> void:
	var ev := InputEventJoypadButton.new()
	ev.button_index = JOY_BUTTON_A
	if not InputMap.has_action("ui_accept"):
		InputMap.add_action("ui_accept")
	InputMap.action_add_event("ui_accept", ev)
	t.ok(Guard.strip() >= 1, "the pad binding was there and is removed")
	var left := 0
	for a in InputMap.get_actions():
		for e in InputMap.action_get_events(a):
			if e is InputEventJoypadButton or e is InputEventJoypadMotion:
				left += 1
	t.eq(left, 0, "no action answers a gamepad")
	var keys := 0
	for e in InputMap.action_get_events("ui_accept"):
		if e is InputEventKey:
			keys += 1
	t.ok(keys > 0, "the keyboard bindings stay")
	t.eq(Guard.strip(), 0, "a second pass finds nothing")


func test_axis_dead_zone() -> void:
	t.eq(P.axis(0.1), 0.0, "stick drift is nothing")
	t.eq(P.axis(-0.18), 0.0)
	t.ok(absf(P.axis(1.0) - 1.0) < 0.0001, "full is full")
	t.ok(P.axis(-1.0) < -0.999)
	t.ok(P.axis(0.6) < 0.6 and P.axis(0.6) > 0.0, "soft near the centre")


func test_intent_and_rest() -> void:
	t.ok(P.at_rest(P.intent({})), "nothing held")
	t.ok(P.at_rest(P.intent({"lx": 0.05, "ry": -0.1})), "drift is rest")
	var i := P.intent({"ly": -1.0, "rx": 1.0, "rt": 1.0, "r1": true})
	t.ok(i.forward > 0.99, "stick up = forward")
	t.ok(i.yaw < -0.99, "stick right turns the view right")
	t.eq(i.zoom, -1.0, "R2 = closer")
	t.eq(i.lift, 1.0, "R1 = up")
	t.ok(not P.at_rest(i))


func test_orbit_limits_and_move() -> void:
	var o := P.orbit(0.0, 1.49, 2.1, {"yaw": 1.0, "pitch": 1.0, "zoom": -1.0}, 1.0, 2.0)
	t.eq(o.pitch, 1.5, "pitch stops at the stage's limit")
	t.eq(o.dist, 2.0, "never closer than the orbit minimum")
	t.ok(absf(o.yaw - P.ORBIT_RAD_S) < 0.0001)
	t.eq(P.orbit(0.0, 0.0, 70.0, {"yaw": 0.0, "pitch": 0.0, "zoom": 1.0}, 1.0, 2.0).dist, 80.0, "nor further than 80 m")
	var near := P.move(2.0, {"forward": 1.0, "strafe": 0.0, "lift": 0.0}, 1.0)
	t.eq(near.forward, P.MIN_MOVE, "close in: still a usable speed")
	var far := P.move(40.0, {"forward": 1.0, "strafe": -1.0, "lift": 1.0}, 0.5)
	t.ok(absf(far.forward - 16.0) < 0.0001, "far out: faster")
	t.ok(far.strafe < 0.0 and far.lift > 0.0)
