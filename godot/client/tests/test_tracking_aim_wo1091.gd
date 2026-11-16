extends RefCounted
## WO-1091 — aim_model.gd: a new tracking camera's default pose sees the stage (several placements / orientations,
## tiny and huge grids, inside a known room), the rough-aim maths, the Camera view's zoom limits, stage names for a
## turned stage, and "never overwrite a solved camera".

const A := preload("res://features/previs/tracking/aim_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
const T := preload("res://features/previs/tracking/tracking_model.gd")
const S := preload("res://features/previs/stage_objects.gd")
var t


func _grid(w: float, d: float, x: float, y: float, z := 0.0) -> Dictionary:
	return {"width": w, "depth": d, "spacing": 1.0, "x_offset": x, "y_offset": y, "z_offset": z}


func _wall(pos: Array, yaw: float, panels := [30, 3]) -> Dictionary:  # a Godot-frame stage object, as the project holds it
	return {"id": "w", "type": "led_wall", "name": "W", "panel_mm": [500, 1000], "panel_px": [128, 128], "panels": panels,
		"position": pos, "rotation": [0, yaw, 0], "visible": true}


func _corners(g: Dictionary) -> Array:
	var out := []
	for z in [g.z_offset, g.z_offset + A.HEAD]:
		for p in T.grid_corners(g):
			out.append([p[0], p[1], z])
	return out


## The whole grid (feet and heads) in the frame with margin, the camera on the audience side, above the floor.
func _sees(g: Dictionary, objs: Array, aud: Vector2, label: String, room := AABB()) -> Dictionary:
	var r := A.stage_pose(g, objs, room)
	var cam: Dictionary = r.cam
	t.ok(A.frames(cam, _corners(g), 1920.0, 1080.0, A.MARGIN * 0.99), label + ": every grid corner (feet + head) inside the frame with margin")
	var off := Vector2(cam.pos_x - g.x_offset, cam.pos_y - g.y_offset)
	t.ok(off.normalized().dot(aud) > 0.99, label + ": camera on the audience side %s (offset %s)" % [aud, off])
	t.ok(cam.pos_z >= g.z_offset + A.MIN_HEIGHT - 1e-6, label + ": at least %.1f m above the stage floor (z %.2f)" % [A.MIN_HEIGHT, cam.pos_z])
	var centre: Variant = C.project(cam, [[g.x_offset, g.y_offset, g.z_offset]], 1920.0, 1080.0)[0]
	t.ok(centre != null and Vector2(centre[0], centre[1]).distance_to(Vector2(960, 540)) < 1.0, label + ": looks at the stage centre")
	return r


func test_origin_stage_facing_minus_y() -> void:
	var g := _grid(10, 6, 0, 3)
	var r := _sees(g, [], Vector2(0, -1), "default grid, no objects")
	t.eq(r.from, "grid", "no objects, no room → the grid / PSN convention decides")
	r = _sees(g, [_wall([0, 0, -6], 0.0, [20, 3])], Vector2(0, -1), "LED wall facing −Y")
	t.eq(r.from, "objects", "the wall's facing decides")


func test_owner_stage_against_a_long_side_wall() -> void:
	# projects/90c_pgrp_hilton_wawer.json: grid 3 × 15 at (11.05, −3.5, 0.639), the 15 × 3 m wall turned −90° at X 12.7
	var g := _grid(3, 15, 11.05, -3.5, 0.639)
	var wall := _wall([12.7, 1.239, 3.5], -90.0)
	var r := _sees(g, [wall], Vector2(-1, 0), "owner's stage")
	t.ok(r.cam.pos_x < 9.55, "in front of the stage edge (X %.2f)" % r.cam.pos_x)
	t.ok(absf(r.cam.yaw - 90.0) < 1e-3, "looks +X (yaw 90), got %.2f" % r.cam.yaw)
	var old: Dictionary = T.new_camera([]).cam  # the constant the owner got: the stage is not in its frame
	t.ok(not A.frames(old, _corners(g), 1920.0, 1080.0, 0.0), "the old constant default does not frame this stage")
	# no wall: the grid alone (deeper than wide, off to +X) still points the audience at −X
	t.eq(A.audience(g, []).dir, Vector2(-1, 0), "grid fallback: long side, towards the venue origin")


func test_stage_turned_45_degrees() -> void:
	var g := _grid(8, 8, 4, 4)
	var wall := _wall([6, 0, -6], 45.0, [16, 3])  # faces +Z turned 45° → Godot (0.707, 0, 0.707) → PSN (0.707, −0.707)
	var aud := Vector2(1, -1).normalized()
	t.ok(A.audience(g, [wall]).dir.distance_to(aud) < 1e-4, "audience along the wall's facing")
	_sees(g, [wall], aud, "45° stage")


func test_tiny_and_huge_grids() -> void:
	var tiny := _grid(0.5, 0.5, 2, 2)
	var r := _sees(tiny, [], Vector2(0, -1), "tiny grid")
	var d := Vector2(r.cam.pos_x - 2.0, r.cam.pos_y - 2.0).length()
	t.ok(d < 10.0 and r.cam.pos_z < 5.0, "a tiny stage gets a close camera (%.1f m back, %.1f m up)" % [d, r.cam.pos_z])
	var huge := _grid(120, 60, 0, 30)
	r = _sees(huge, [], Vector2(0, -1), "huge grid")
	t.eq(r.cam.fov, A.FOV, "huge grid framed by distance at the default fov")


func test_room_keeps_the_camera_inside_and_picks_the_free_side() -> void:
	var g := _grid(3, 15, 11.05, -3.5, 0.0)
	# room X −20…13, Y −15…8, 0…8 m high (Godot AABB: x, height, −y)
	var room := AABB(Vector3(-20, 0, -8), Vector3(33, 8, 23))
	t.eq(A.audience(g, [], room).from, "room", "no objects → the room decides")
	t.eq(A.audience(g, [], room).dir, Vector2(-1, 0), "the free side is −X")
	var r := _sees(g, [], Vector2(-1, 0), "roomy hall", room)
	var b := A.room_psn(room)
	t.ok(b.grow(-A.ROOM_INSET + 1e-6).has_point(Vector3(r.cam.pos_x, r.cam.pos_y, r.cam.pos_z)), "inside the room")
	t.eq(r.cam.fov, A.FOV, "enough room: default fov")
	# a shallow hall: only 9 m in front of the stage → the fov widens instead of leaving the room
	var shallow := AABB(Vector3(0.5, 0, -8), Vector3(12.5, 8, 23))
	r = A.stage_pose(g, [_wall([12.7, 1, 3.5], -90.0)], shallow)
	var bs := A.room_psn(shallow)
	t.ok(bs.grow(-A.ROOM_INSET + 1e-6).has_point(Vector3(r.cam.pos_x, r.cam.pos_y, r.cam.pos_z)), "shallow hall: still inside")
	t.ok(r.cam.fov > A.FOV and r.fits, "shallow hall: framed with a wider fov (%.1f°)" % r.cam.fov)
	t.ok(not A.room_like(AABB(Vector3(9, 0, -1), Vector3(4, 6, 2)), g), "a box smaller than the grid is no room")


func test_rough_aim_maths() -> void:
	var cam := C.camera(0.0, -10.0, 5.0, -20.0, 0.0, 0.0, 60.0)
	var l := A.look(cam, Vector2(100, 0), 600.0)
	t.ok(absf(l.yaw - (-10.0)) < 1e-6, "drag right 1/6 of the frame → the picture follows: yaw −10°")
	t.ok(absf(A.look(cam, Vector2(0, 60), 600.0).pitch - (-14.0)) < 1e-6, "drag down → tilt up")
	t.eq(A.look(cam, Vector2(0, 99999), 600.0).pitch, 89.0, "pitch clamped")
	t.ok(absf(A.look(C.camera(0, 0, 5, 0, 175, 0, 60), Vector2(-60, 0), 600.0).yaw - (-179.0)) < 1e-6, "yaw wraps past 180")
	var dist := A.focus_distance(cam, 0.0)
	t.ok(absf(dist - 5.0 / sin(deg_to_rad(20.0))) < 1e-3, "focus distance to the floor along the axis")
	var hit := func(c: Dictionary) -> Vector2:
		var p: Variant = C.project(c, [[0.0, -10.0 + 5.0 / tan(deg_to_rad(20.0)), 0.0]], 1920.0, 1080.0)[0]
		return Vector2(p[0], p[1])
	var before: Vector2 = hit.call(cam)
	var moved: Vector2 = hit.call(A.move(cam, Vector2(50, 0), 1920.0, dist))
	t.ok(absf(moved.x - before.x - 50.0) < 0.5 and absf(moved.y - before.y) < 0.5, "shift+drag: the floor point follows the pointer (%s → %s)" % [before, moved])
	var fwd := A.dolly(cam, 1.0, dist)
	t.ok(fwd.pos_y > cam.pos_y and fwd.pos_z < cam.pos_z, "dolly forward goes along the view")
	t.ok(absf(Vector3(fwd.pos_x - cam.pos_x, fwd.pos_y - cam.pos_y, fwd.pos_z - cam.pos_z).length() - dist * 0.1) < 1e-6, "a tenth of the distance per step")
	t.ok(A.zoom_fov(cam, 1.0).fov < 60.0 and A.zoom_fov(cam, -1.0).fov > 60.0, "ctrl+wheel up narrows the fov")
	t.eq(A.zoom_fov(cam, -100.0).fov, A.FOV_MAX, "fov clamped")


func test_zoom_limits_and_wide_overlay() -> void:
	t.eq(A.clamp_zoom(0.01), A.ZOOM_MIN, "zoom out stops at %.2f" % A.ZOOM_MIN)
	t.ok(A.ZOOM_MIN < 1.0, "zoom out below 1× is allowed")
	t.eq(A.clamp_zoom(1.0 / 1.2 * 1.2), 1.0, "back to exactly 1×")
	t.eq(A.clamp_zoom(1000.0), A.ZOOM_MAX, "zoom in capped")
	t.eq(A.wide(Vector2(1920, 1080), Rect2(0, 0, 1920, 1080)), 1.0, "frame fills the view → no wide render")
	t.ok(absf(A.wide(Vector2(1920, 1080), Rect2(480, 270, 960, 540)) - 2.0) < 1e-6, "half-size frame → 2× wide")
	t.eq(A.wide(Vector2(1920, 1080), Rect2(900, 520, 60, 30)), A.WIDE_MAX, "capped")


func test_never_overwrite_a_solved_camera() -> void:
	var e := T.new_camera([])
	var cam := C.camera(1, 2, 3, -10, 5, 0, 50)
	t.ok(A.can_aim(e, false), "uncalibrated → aim by hand")
	t.eq(A.with_pose(e, cam, false).cam, cam, "uncalibrated: the hand pose lands")
	e["rms"] = 0.4
	t.ok(not A.can_aim(e, false), "solved → locked")
	t.eq(A.with_pose(e, cam, false), {}, "solved and locked: refused")
	var u := A.with_pose(e, cam, true)
	t.eq(u.cam, cam, "unlocked: lands")
	t.eq(u.rms, -1.0, "a hand pose is no solve: rms −1")
	t.ok(not A.can_aim({}, true), "no camera, no aim")


func test_stage_names_follow_the_audience() -> void:
	t.eq(A.stage_name(Vector2(-1, -1), Vector2(0, -1)), "DSR", "PSN convention: (−x, −y) is DSR")
	t.eq(A.stage_name(Vector2(-1, -1), Vector2(-1, 0)), "DSL", "audience −X: (−x, −y) is down-stage LEFT")
	t.eq(A.stage_name(Vector2(1, 0), Vector2(-1, 0)), "USC", "audience −X: +x is upstage")
	t.eq(A.stage_name(Vector2.ZERO, Vector2(1, 0)), "Centre")
	var g := _grid(3, 15, 11.05, -3.5)
	t.ok(A.stage_spot(g, Vector2(-1, 0), 1, -1).is_equal_approx(Vector2(9.55, 4.0)), "audience −X: DSR is (9.55, 4)")
	var cands := T.candidate_points({"grid": g}, [S.normalize(_wall([12.7, 1.239, 3.5], -90.0))])
	t.eq(cands[0].id, "grid:DSR", "ids stay (stored points keep matching)")
	t.eq(cands[0].label, "Grid corner DSL", "the label names the corner as this stage's audience sees it")


func test_preset_marks_and_ptz_follow_the_stage() -> void:
	var F := preload("res://features/previs/tracking/follow_model.gd")
	var P := preload("res://features/previs/tracking/ptz_model.gd")
	var g := _grid(3, 15, 11.05, -3.5, 0.639)
	var m := F.preset_marks(g, [], Vector2(-1, 0))
	var by := {}
	for x in m:
		by[x.name] = Vector2(x.x, x.y)
	t.ok(by.DSC.is_equal_approx(Vector2(9.55, -3.5)), "audience −X: DSC on the −X edge's middle (%s)" % by.DSC)
	t.ok(by.SL.is_equal_approx(Vector2(11.05, -11.0)), "audience −X: stage left is −Y (%s)" % by.SL)
	t.ok(by.Centre.is_equal_approx(Vector2(11.05, -3.5)), "centre")
	var proj := {"previs": {"tracking": {"grid": g}, "stage": {"objects": [S.normalize(_wall([12.7, 1.239, 3.5], -90.0))]}}}
	t.eq(A.project_audience(proj).round(), Vector2(-1, 0), "project audience from its LED wall")
	var ptz := P.new_camera([], A.ptz_pose(proj))
	t.ok(ptz.pose.x < 9.55 and absf(ptz.pose.yaw - 90.0) < 0.1 and ptz.pose.pitch == 0.0, "a new PTZ stands on the audience side facing the stage: %s" % ptz.pose)
	t.eq(P.new_camera([]).pose.y, -8.0, "no pose given: the normalize default (server twin unchanged)")
