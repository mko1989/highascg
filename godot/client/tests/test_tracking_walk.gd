extends RefCounted
## WO-616 T10d — verification walk: walk_model.gd lines() (grid edges and centre lines) and describe() (status text)

const W := preload("res://features/previs/tracking/walk_model.gd")
const IDLE := "Walk the line shown in the camera view, at a steady pace, end to end."
var t


func _grid(x_offset: float, z_offset: float) -> Dictionary:
	return {"width": 12.0, "depth": 6.0, "x_offset": x_offset, "y_offset": 3.0, "z_offset": z_offset}


func test_lines_names_and_order() -> void:
	var ls := W.lines(_grid(0.0, 0.0))
	t.eq(ls.size(), 6, "six walkable lines")
	var names := []
	for l in ls:
		names.append(l.name)
	t.eq(names, ["Downstage edge", "Centre line, across", "Upstage edge", "Centre line, up and down",
		"Stage-left edge", "Stage-right edge"], "line names in order")


func test_lines_endpoints_centred_grid() -> void:
	var ls := W.lines(_grid(0.0, 0.0))
	t.eq(ls[0].a, [-6.0, 0.0], "downstage edge starts at stage left")
	t.eq(ls[0].b, [6.0, 0.0], "downstage edge ends at stage right")
	t.eq(ls[2].a, [-6.0, 6.0], "upstage edge starts at stage left")
	t.eq(ls[2].b, [6.0, 6.0], "upstage edge ends at stage right")
	t.eq(ls[3].a, [0.0, 0.0], "centre up/down starts downstage")
	t.eq(ls[3].b, [0.0, 6.0], "centre up/down ends upstage")
	t.eq(ls[4].a[0], 6.0, "stage-left edge sits at x = +6")
	t.eq(ls[5].a[0], -6.0, "stage-right edge sits at x = -6")
	t.eq(ls[1].a[1], 3.0, "centre line across sits at y = 3 (the centre)")


func test_lines_carry_z_offset() -> void:
	for l in W.lines(_grid(0.0, 0.0)):
		t.eq(l.z, 0.0, "z is the grid z_offset (zero case)")
	for l in W.lines(_grid(0.0, 0.5)):
		t.eq(l.z, 0.5, "z is the grid z_offset (0.5 case)")


func test_lines_offset_grid_shifts() -> void:
	var ls := W.lines(_grid(2.0, 0.5))
	t.eq(ls[0].a, [-4.0, 0.0], "offset downstage edge starts at x = 2 - 6")
	t.eq(ls[0].b, [8.0, 0.0], "offset downstage edge ends at x = 2 + 6")
	t.eq(ls[2].a, [-4.0, 6.0], "offset upstage edge starts at x = -4")
	t.eq(ls[3].a, [2.0, 0.0], "offset centre up/down sits at x = 2")
	t.eq(ls[3].b, [2.0, 6.0], "offset centre up/down ends at x = 2")
	t.eq(ls[4].a[0], 8.0, "offset stage-left edge sits at x = 8")
	t.eq(ls[5].a[0], -4.0, "offset stage-right edge sits at x = -4")
	t.eq(ls[0].z, 0.5, "offset grid keeps z_offset on every line")


func test_describe_idle() -> void:
	t.eq(W.describe({}), IDLE, "empty status gives the idle help text")
	t.eq(W.describe({"running": false, "live": null, "result": null}), IDLE, "stopped with no result gives the idle help text")


func test_describe_running_waiting_for_person() -> void:
	var s := W.describe({"running": true, "live": {"person": null}})
	t.ok(s.begins_with("Walking — step onto the line"), "running without a person asks to step onto the line, got '%s'" % s)


func test_describe_running_live() -> void:
	var s := W.describe({"running": true, "live": {"person": 2.0, "samples": 58.0, "elapsed_s": 4.0,
		"world": {"mean_cm": 24.3}, "covered": 0.05}})
	t.ok(s.contains("P2"), "live line names the person")
	t.ok(s.contains("58 samples"), "live line has the sample count")
	t.ok(s.contains("4.0 s"), "live line has the elapsed seconds")
	t.ok(s.contains("mean 24.3 cm"), "live line has the mean off-line distance")
	t.ok(s.contains("5 %"), "live line has the walked percentage")


func test_describe_result_too_few_samples() -> void:
	var s := W.describe({"running": false, "result": {"ok": false, "samples": 3.0}})
	t.ok(s.contains("Too few samples (3)"), "failed walk reports the sample count, got '%s'" % s)


func test_describe_result_ok_multiline() -> void:
	var s := W.describe({"running": false, "result": {
		"ok": true, "person": 2.0, "samples": 304.0, "duration_s": 20.8, "covered": 0.05,
		"world": {"mean_cm": 24.3, "rms_cm": 24.3, "max_cm": 24.3},
		"cameras": {"cam_1": {"n": 304.0, "rms_cm": 24.3, "max_cm": 24.3}},
		"sources": {"cam_1": 304.0}}})
	t.ok(s.contains("\n"), "ok result spans several lines")
	t.ok(s.contains("P2"), "ok result names the person")
	t.ok(s.contains("20.8 s"), "ok result has the duration")
	t.ok(s.contains("Tracked position off the line: mean 24.3 · RMS 24.3 · max 24.3 cm"), "fused world line, got '%s'" % s)
	t.ok(s.contains("cam_1 alone: RMS 24.3 · max 24.3 cm (304 samples)"), "per-camera line, got '%s'" % s)
	t.ok(s.contains("Source: cam_1 100 %"), "source share line, got '%s'" % s)


func test_describe_null_cm_renders_dash() -> void:
	var s := W.describe({"running": false, "result": {
		"ok": true, "person": 2.0, "samples": 10.0, "duration_s": 2.0, "covered": 0.0,
		"world": {"mean_cm": null, "rms_cm": null, "max_cm": null},
		"cameras": {}, "sources": {}}})
	t.ok(s.contains("mean – · RMS – · max – cm"), "null cm values render as an en dash, got '%s'" % s)
