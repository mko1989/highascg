extends RefCounted
## WO-616 T12 — camera_overlay.gd: set_camera lens overscan / fov / size / pose, active mode and opacity. Headless,
## no tree (CameraOverlay._init builds its Camera3D child).

const CO := preload("res://features/previs/tracking/camera_overlay.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")
var t


func _entry(k1: float, k2: float) -> Dictionary:
	return {"raster": [1920, 1080], "cam": {"pos_x": 0.0, "pos_y": -11.0, "pos_z": 6.0, "pitch": -22.0,
		"yaw": 0.0, "roll": 0.0, "fov": 60.0, "lens_k1": k1, "lens_k2": k2}}


func test_empty_entry_is_rejected() -> void:
	var o = CO.new()
	t.eq(o.set_camera({}), false, "empty dict is not a camera")
	o.free()


func test_no_lens_is_pinhole() -> void:
	var o = CO.new()
	t.ok(o.set_camera(_entry(0.0, 0.0)), "valid pinhole camera accepted")
	t.ok(absf(o.overscan - 1.0) < 1e-3, "no lens → overscan 1")
	var vfov := C.hfov_to_vfov(60.0, 1920.0 / 1080.0)
	t.ok(absf(o.cam.fov - vfov) < 1e-3, "cam.fov is the vertical fov of the 60° horizontal")
	t.eq(o.size, Vector2i(1920, 1080), "render at the raster size")
	t.ok(absf(float(o.material.get_shader_parameter("overscan")) - 1.0) < 1e-3, "shader overscan 1")
	o.free()


func test_barrel_lens_overscans_and_caps_width() -> void:
	var o = CO.new()
	var vfov := C.hfov_to_vfov(60.0, 1920.0 / 1080.0)
	t.ok(o.set_camera(_entry(-0.2, 0.0)), "barrel camera accepted")
	var want := clampf(C.invert_radius(1.0, -0.2, 0.0), 1.0, 2.0)
	t.ok(o.overscan > 1.0, "barrel → overscan above 1")
	t.ok(absf(o.overscan - want) < 1e-3, "overscan = inverse radius at the corner (clamped)")
	var want_fov := rad_to_deg(2.0 * atan(want * tan(deg_to_rad(vfov) / 2.0)))
	t.ok(o.cam.fov > vfov, "overscanned fov is wider than the pinhole one")
	t.ok(absf(o.cam.fov - want_fov) < 1e-3, "cam.fov widened by the overscan")
	t.ok(o.size.x <= CO.MAX_W, "width capped at MAX_W")
	var aspect := float(o.size.x) / float(o.size.y)
	t.ok(absf(aspect - 1920.0 / 1080.0) < 0.01, "aspect kept through the cap")
	o.free()


func test_pincushion_lens_clamps_overscan_to_one() -> void:
	var o = CO.new()
	t.ok(o.set_camera(_entry(0.3, 0.0)), "pincushion camera accepted")
	t.ok(absf(o.overscan - 1.0) < 1e-3, "pincushion → overscan clamped at 1")
	o.free()


func test_pose_follows_the_solved_transform() -> void:
	var e := _entry(0.0, 0.0)
	var o = CO.new()
	o.set_camera(e)
	var want: Transform3D = C.godot_transform(e.cam)
	t.ok(o.cam.transform.origin.is_equal_approx(want.origin), "origin = solved position in Godot axes")
	t.ok(o.cam.transform.basis.is_equal_approx(want.basis), "rotation = solved pitch/yaw/roll")
	o.free()


func test_active_switches_render_updates_and_opacity_clamps() -> void:
	var o = CO.new()
	o.set_active(true)
	t.eq(o.render_target_update_mode, SubViewport.UPDATE_ALWAYS, "active → render every frame")
	o.set_active(false)
	t.eq(o.render_target_update_mode, SubViewport.UPDATE_DISABLED, "inactive → rendering disabled")
	o.set_opacity(2.0)
	t.ok(absf(float(o.material.get_shader_parameter("opacity")) - 1.0) < 1e-3, "opacity clamped to 1")
	o.free()
