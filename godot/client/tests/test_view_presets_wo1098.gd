extends RefCounted
## WO-1098 — view_presets.gd: the Previs View presets (Front / Top / ISO) frame the stage from its audience side —
## an origin stage facing +Z keeps the old directions, the Hilton stage (against a long side wall, facing −X), a stage
## turned 45°, and no stage at all (the old fixed poses, around the venue box when there is one).

const V := preload("res://features/previs/view_presets.gd")
var t


func _wall(pos: Array, yaw: float, panels := [30, 3]) -> Dictionary:
	return {"id": "w", "type": "led_wall", "name": "W", "panel_mm": [500, 1000], "panel_px": [128, 128], "panels": panels,
		"position": pos, "rotation": [0, yaw, 0], "visible": true}


func _project(objects: Array, grid: Variant = null) -> Dictionary:
	var pv := {"stage": {"objects": objects}}
	if grid != null:
		pv["tracking"] = {"grid": grid}
	return {"previs": pv}


## The orbit camera of a pose (previs_stage.gd `_update_camera`).
func _cam(p: Dictionary) -> Transform3D:
	var off := Vector3(sin(p.yaw) * cos(p.pitch), sin(p.pitch), cos(p.yaw) * cos(p.pitch)) * float(p.dist)
	var target: Vector3 = p.target
	return Transform3D(Basis.IDENTITY, target + off).looking_at(target, Vector3.UP)


## Every corner of `box` inside the view (vertical FOV, aspect), in front of the camera.
func _frames(p: Dictionary, box: AABB, aspect: float) -> bool:
	var inv := _cam(p).affine_inverse()
	var tv := tan(deg_to_rad(V.FOV) / 2.0)
	for i in 8:
		var q := inv * box.get_endpoint(i)
		if q.z >= -0.1 or absf(q.x / -q.z) > tv * aspect + 1e-4 or absf(q.y / -q.z) > tv + 1e-4:
			return false
	return true


func test_origin_stage_facing_z_keeps_the_old_directions() -> void:
	var pr := _project([_wall([0, 0, 0], 0.0, [20, 4])], {"width": 10, "depth": 6, "x_offset": 0, "y_offset": 3, "z_offset": 0})
	for n in ["Front", "Top", "ISO"]:
		var p := V.pose(n, pr, 16.0 / 9.0)
		t.ok(is_equal_approx(p.yaw, V.LEGACY[n].x) and is_equal_approx(p.pitch, V.LEGACY[n].y), "%s: yaw / pitch as before" % n)
		t.ok(_frames(p, V.stage_box(pr), 16.0 / 9.0), "%s: the stage in frame" % n)
	t.eq(V.audience(pr).from, "objects", "the wall's facing decides")


func test_hilton_front_looks_from_the_audience_at_the_stage() -> void:
	# 90C PGRP Hilton Wawer: a 15 × 3 m wall against the +X long wall, facing −X; the grid on the 3 × 15 m stage
	var pr := _project([_wall([12.7, 1.239, 3.5], -90.0)], {"width": 3, "depth": 15, "x_offset": 11.05, "y_offset": -3.5, "z_offset": 0.639})
	var room := AABB(Vector3(-15.257, 0.24, -27.732), Vector3(30.284, 6.75, 62.226))
	var box := V.stage_box(pr)
	t.ok(box.position.x < 9.6 and box.end.x > 12.6 and is_equal_approx(box.size.z, 15.0), "stage box: grid + wall")
	var f := V.pose("Front", pr, 1.19, room)
	t.ok(absf(f.yaw + PI / 2.0) < 1e-4, "Front: from −X (the audience), not along the room")
	var c := _cam(f).origin
	t.ok(c.x < box.position.x - 5.0 and c.x > room.position.x, "Front: in the room, in front of the stage (x %.1f)" % c.x)
	t.ok(absf(c.z - box.get_center().z) < 0.01, "Front: centred on the stage")
	t.ok(_frames(f, box, 1.19), "Front: wall + grid + heads in frame")
	t.ok(f.dist < 25.0, "Front: not further than needed (%.1f m)" % f.dist)
	var top := V.pose("Top", pr, 1.19, room)
	t.ok(absf(top.yaw + PI / 2.0) < 1e-4 and top.pitch > 1.4, "Top: from above, the audience at the bottom (upstage up)")
	t.ok(_frames(top, box, 1.19), "Top: the stage plan in frame")
	var iso := V.pose("ISO", pr, 1.19, room)
	t.ok(absf(wrapf(iso.yaw - (-PI / 2.0 - 0.75), -PI, PI)) < 1e-4, "ISO: three-quarter from the audience side")
	t.ok(_frames(iso, box, 1.19), "ISO: the stage in frame")
	var ic := _cam(iso).origin
	t.ok(absf(ic.y - (room.position.y + room.size.y - 1.0)) < 0.02 and room.has_point(ic), "ISO: in the room, a metre under its ceiling (y %.2f)" % ic.y)
	t.ok(is_equal_approx(V.pose("ISO", pr, 1.19).pitch, 0.45), "ISO without a venue: the old pitch")


func test_stage_turned_45() -> void:
	var pr := _project([_wall([5, 0, 5], 45.0, [16, 4])])
	var f := V.pose("Front", pr, 16.0 / 9.0)
	t.ok(absf(f.yaw - PI / 4.0) < 1e-4, "Front from the wall's facing (45°)")
	var c := _cam(f).origin
	t.ok(c.x > 5.0 and c.z > 5.0, "in front of the turned wall")
	t.ok(_frames(f, V.stage_box(pr), 16.0 / 9.0), "the turned wall in frame")


func test_no_stage_keeps_the_fixed_poses() -> void:
	var p := V.pose("Front", {})
	t.ok(p.target == null and is_equal_approx(p.yaw, 0.0) and is_equal_approx(p.dist, 12.0), "no stage, no venue: today's pose")
	var room := AABB(Vector3(-10, 0, -20), Vector3(20, 6, 40))
	var q := V.pose("Top", {"previs": {"stage": {"objects": []}}}, 1.5, room)
	t.ok(q.target == room.get_center() and q.dist >= 14.0 and is_equal_approx(q.pitch, 1.45), "no stage, a venue: its centre")
	var hidden := _wall([0, 0, 0], 0.0)
	hidden.visible = false
	t.eq(V.pose("ISO", _project([hidden])).from, "fixed", "a hidden wall is no stage")


func test_near_yaw_turns_the_short_way() -> void:
	t.ok(is_equal_approx(V.near_yaw(3.0, -3.0), 3.0 + (2.0 * PI - 6.0)), "across ±π: the short way")
