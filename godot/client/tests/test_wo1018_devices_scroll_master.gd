extends RefCounted
## WO-1018 — Devices tab: separate scroll areas (devices_scroll.gd) and the master marker (cluster_model.gd).

const M := preload("res://features/devices/cluster_model.gd")
const S := preload("res://features/devices/devices_scroll.gd")
var t

const MASTER_SELF := {"epoch": 1, "master_id": "self", "is_master": true}
const MASTER_PEER := {"epoch": 2, "master_id": "highascg5867", "is_master": false}


func test_role_badge_marks_the_master_and_the_followers() -> void:
	t.eq(M.role_badge(MASTER_SELF, "self"), "MASTER", "this server is master")
	t.eq(M.role_badge(MASTER_SELF, "highascg5867"), "FOLLOWER", "the peer follows")
	t.eq(M.role_badge(MASTER_PEER, "self"), "FOLLOWER", "this server follows the peer")
	t.eq(M.role_badge(MASTER_PEER, "highascg5867"), "MASTER", "the peer is master")
	t.eq(M.role_badge({"epoch": 0, "master_id": ""}, "self"), "", "no master chosen yet: no badge")
	t.eq(M.role_badge({}, "self"), "", "no data")


func test_make_master_names_the_server_and_hides_on_the_master() -> void:
	t.eq(M.make_text("highascg5867"), "Make highascg5867 master", "names it")
	t.eq(M.make_text(""), "Make this server master", "fallback")
	t.ok(not M.can_make(MASTER_SELF, "self"), "not on the master itself")
	t.ok(M.can_make(MASTER_PEER, "self"), "on this server when a peer is master")
	var online := {"online": true, "identity": true}
	t.ok(M.can_make(MASTER_SELF, "highascg5867", online), "on an online, identified follower")
	t.ok(not M.can_make(MASTER_SELF, "highascg5867", {"online": false, "identity": true}), "not on an offline peer")
	t.ok(not M.can_make(MASTER_SELF, "highascg5867", {"online": true}), "not on an unidentified peer")
	t.ok(not M.can_make(MASTER_PEER, "highascg5867", online), "not on the peer that is master")


func test_clipped_point_is_outside_any_holding_scroll_area() -> void:
	var rects := [Rect2(0, 100, 400, 300), Rect2(0, 0, 400, 1000)]
	t.ok(not S.clipped(Vector2(50, 150), rects), "inside both")
	t.ok(S.clipped(Vector2(50, 50), rects), "scrolled above the inner area")
	t.ok(S.clipped(Vector2(50, 450), rects), "scrolled below it")
	t.ok(not S.clipped(Vector2(50, 50), []), "no scroll area: never clipped")


func test_cable_end_is_held_at_the_edge_of_its_scroll_area() -> void:
	var rects := [Rect2(0, 100, 400, 300), Rect2(0, 0, 400, 1000)]
	t.eq(S.clamped(Vector2(50, 150), rects), Vector2(50, 150), "in view: unchanged")
	t.eq(S.clamped(Vector2(50, 50), rects), Vector2(50, 100), "scrolled above: held at the top edge")
	t.eq(S.clamped(Vector2(50, 450), rects), Vector2(50, 400), "scrolled below: held at the bottom edge")
	t.eq(S.clamped(Vector2(50, 50), []), Vector2(50, 50), "no scroll area: unchanged")


func test_wheel_delta_and_clamp() -> void:
	t.eq(S.wheel_delta(MOUSE_BUTTON_WHEEL_DOWN, 1.0), S.STEP, "down scrolls forward")
	t.eq(S.wheel_delta(MOUSE_BUTTON_WHEEL_UP, 1.0), -S.STEP, "up scrolls back")
	t.eq(S.wheel_delta(MOUSE_BUTTON_WHEEL_DOWN, 0.0), S.STEP, "a zero factor still moves one notch")
	t.eq(S.wheel_delta(MOUSE_BUTTON_LEFT, 1.0), 0.0, "other buttons are not the wheel")
	t.eq(S.scrolled(10.0, -64.0, 500.0), 0.0, "never above the top")
	t.eq(S.scrolled(480.0, 64.0, 500.0), 500.0, "never past the end")
	t.eq(S.scrolled(10.0, 64.0, -5.0), 0.0, "nothing to scroll")


func test_wheel_ignores_other_events_and_empty_areas() -> void:
	t.ok(not S.wheel([], InputEventKey.new()), "a key is not the wheel")
	var mb := InputEventMouseButton.new()
	mb.button_index = MOUSE_BUTTON_WHEEL_DOWN
	mb.pressed = true
	t.ok(not S.wheel([], mb), "no area under the pointer")
