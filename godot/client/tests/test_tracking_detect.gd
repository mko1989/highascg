extends RefCounted
## WO-616 T9b — person detection on the client: detect_model.gd (mirror of src/tracking/detect-model.js normalizeDetection) and the marker driver's adoption of assist anchors / replace-driven markers.

const D := preload("res://features/previs/tracking/detect_model.gd")
var t


func test_normalize_null_gives_defaults() -> void:
	var d := D.normalize(null)
	t.eq(d.enabled, false, "detection starts off")
	t.eq(d.model, "yolo26n.onnx", "default model")
	t.eq(d.pin_mode, "assist", "default pin mode")
	t.eq(d.pin_point, "top", "default pin point")
	t.eq(d.pin_marker_id, 1, "default pin marker")
	t.eq(d.smoothing, 0.15, "default smoothing")
	t.eq(d.cameras, {}, "no per-camera entries")
	t.eq(d.confidence, 0.2, "default confidence")
	t.eq(d.max_persons, 10, "default max persons")


func test_normalize_clamps_numbers() -> void:
	var n := D.normalize({"confidence": 5, "interval_ms": 1, "max_persons": 7.6, "pin_marker_id": 0, "assist_strength": -1})
	t.eq(n.confidence, 0.95, "confidence clamped to the top of its range")
	t.eq(n.interval_ms, 20, "interval clamped up to 20")
	t.eq(n.max_persons, 8, "max persons rounded to an int")
	t.eq(typeof(n.max_persons), TYPE_INT, "max persons is an int")
	t.eq(n.pin_marker_id, 1, "marker id clamped up to 1")
	t.eq(n.assist_strength, 0.0, "assist strength clamped to 0")
	var s := D.normalize({"confidence": "x"})
	t.eq(s.confidence, 0.2, "a string confidence falls back to the default")


func test_normalize_rejects_bad_models() -> void:
	t.eq(D.normalize({"model": "../evil.onnx"}).model, "yolo26n.onnx", "path traversal rejected")
	t.eq(D.normalize({"model": "a/b.onnx"}).model, "yolo26n.onnx", "slash rejected")
	t.eq(D.normalize({"model": "model.pt"}).model, "yolo26n.onnx", "non-onnx rejected")
	t.eq(D.normalize({"model": "yolo26s.onnx"}).model, "yolo26s.onnx", "valid model kept")


func test_normalize_pin_mode_and_point() -> void:
	t.eq(D.normalize({"pin_mode": "bogus"}).pin_mode, "assist", "unknown pin mode falls back to assist")
	t.eq(D.normalize({"pin_mode": "replace"}).pin_mode, "replace", "replace kept")
	t.eq(D.normalize({"pin_point": "bottom"}).pin_point, "bottom", "bottom kept")
	t.eq(D.normalize({"pin_point": "side"}).pin_point, "top", "unknown pin point falls back to top")


func test_normalize_keeps_unknown_keys_and_does_not_mutate() -> void:
	var f := D.normalize({"future_key": 3})
	t.eq(f.future_key, 3, "unknown key survives normalize")
	var src := {"confidence": 5}
	var n := D.normalize(src)
	t.eq(n.confidence, 0.95, "the copy is clamped")
	t.eq(src.confidence, 5, "the input dictionary is not mutated")


func test_camera_on_and_with_camera() -> void:
	t.ok(D.camera_on({}, "cam_1"), "no entry means watched")
	t.ok(D.camera_on({}, "anything_else"), "no entry means watched for any id")
	var d := {"cameras": {"cam_1": {"masks": [[1]]}}}
	var off := D.with_camera(d, "cam_1", false)
	t.eq(D.camera_on(off, "cam_1"), false, "switched off")
	t.eq(off.cameras.cam_1.masks, [[1]], "masks kept when switching off")
	var on := D.with_camera(off, "cam_1", true)
	t.eq(D.camera_on(on, "cam_1"), true, "switched back on")
	t.eq(d.cameras.cam_1.has("enabled"), false, "with_camera does not mutate its input")


func test_status_line_states() -> void:
	t.ok(D.status_line({}, "cam_1").contains("No detection data"), "empty snapshot")
	t.eq(D.status_line({"enabled": false}, "cam_1"), "Detection off", "master off")
	var err := D.status_line({"enabled": true, "running": false, "error": "no model"}, "cam_1")
	t.ok(err.contains("no model"), "detector error is shown")
	var cams := [{"id": "cam_1", "role": "ch1", "stale": false, "persons": [{"tid": 1}, {"tid": 2, "marker": 1}]}]
	var run := D.status_line({"enabled": true, "running": true, "cameras": cams}, "cam_1")
	t.ok(run.contains("2 persons"), "person count shown")
	t.ok(run.contains("1 pinned"), "pinned count shown")
	var stale := D.status_line({"enabled": true, "running": true, "cameras": [{"id": "cam_1", "role": "ch1", "stale": true, "persons": []}]}, "cam_1")
	t.ok(stale.contains("no frames"), "stale camera reports no frames")
	var other := D.status_line({"enabled": true, "running": true, "cameras": cams}, "cam_9")
	t.ok(other.contains("not watched"), "camera missing from the list is not watched")


func test_position_of_assist_steers_the_anchor() -> void:
	var p := D.position_of({"id": 1, "x": 5.0, "y": 6.0, "z": 0.0, "source": "detect", "anchor": {"x": 1.0, "y": 2.0, "z": 0.5}})
	t.eq([p.x, p.y, p.z], [1.0, 2.0, 0.5], "the anchor is what the operator steers")
	t.eq(p.out, [5.0, 6.0, 0.0], "the AI-corrected output is kept for drawing")
	t.eq(p.driven, false, "assisted is not driven")


func test_position_of_replace_driven_and_operator() -> void:
	var r := D.position_of({"id": 1, "x": 5.0, "y": 6.0, "z": 1.0, "source": "detect", "driven": true, "status": 0.0, "stale": false})
	t.eq([r.x, r.y, r.out, r.driven, r.status], [5.0, 6.0, null, true, 0.0], "replace: the hub position, driven, status read")
	var o := D.position_of({"id": 2, "x": 1.0, "y": 1.0, "source": "operator", "stale": true, "name": "A"})
	t.eq([o.driven, o.status, o.stale, o.name, o.z], [false, 1.0, true, "A", 0.0], "operator marker: free, status defaults to 1")
	var dead := D.position_of({"id": 3, "x": 1.0, "y": 1.0, "source": "detect", "stale": true})
	t.eq(dead.driven, false, "source detect alone (a dead assist anchor) is not driven: the operator can take it back")


func test_masks_of_no_entry_is_empty() -> void:
	t.eq(D.masks_of({}, "cam_1"), {"masks_enabled": false, "masks": []}, "no entry gives masks off and none")
	var other := {"cameras": {"cam_2": {"masks_enabled": true, "masks": [{"enabled": true, "vertices": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]}]}}}
	t.eq(D.masks_of(other, "cam_1"), {"masks_enabled": false, "masks": []}, "another camera's masks are not returned")


func test_masks_of_returns_copies() -> void:
	var src := {"cameras": {"cam_1": {"masks_enabled": true, "masks": [{"vertices": [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]}, {"enabled": false, "vertices": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]}]}}}
	var mk := D.masks_of(src, "cam_1")
	t.eq(mk.masks[0].enabled, true, "a mask without enabled comes back enabled")
	t.eq(mk.masks[1].enabled, false, "enabled false stays false")
	mk.masks[0].vertices.append([0.0, 0.0])
	mk.masks[0].vertices[0][0] = 0.7
	t.eq(src.cameras.cam_1.masks[0].vertices.size(), 3, "mutating the copy's vertices does not change the input")
	t.eq(src.cameras.cam_1.masks[0].vertices[0][0], 0.1, "nested vertex arrays are copied too")


func test_with_masks_creates_and_keeps_enabled() -> void:
	var ms := [{"enabled": true, "vertices": [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]}]
	var made := D.with_masks({}, "cam_1", true, ms)
	t.eq(made.cameras.cam_1, {"enabled": true, "masks_enabled": true, "masks": ms}, "no entry: created with enabled true")
	ms[0].vertices.append([0.0, 0.0])
	t.eq(made.cameras.cam_1.masks[0].vertices.size(), 3, "the stored masks are a copy")
	var d := {"cameras": {"cam_1": {"enabled": false, "masks_enabled": false, "masks": []}}}
	var kept := D.with_masks(d, "cam_1", true, ms)
	t.eq(kept.cameras.cam_1.enabled, false, "an existing enabled false is kept")
	t.eq(kept.cameras.cam_1.masks_enabled, true, "masks_enabled replaced")
	t.eq(d.cameras.cam_1.masks_enabled, false, "the input dictionary is not mutated")


func test_with_masks_keeps_other_cameras() -> void:
	var d := {"cameras": {"cam_2": {"enabled": false, "masks_enabled": true, "masks": [{"enabled": true, "vertices": [[0.2, 0.2], [0.8, 0.2], [0.5, 0.8]]}]}}}
	var out := D.with_masks(d, "cam_1", true, [])
	t.eq(out.cameras.cam_2, d.cameras.cam_2, "another camera's entry is untouched")
	t.ok(out.cameras.has("cam_1"), "the new camera is added")


func test_masks_active_states() -> void:
	var tri := [{"enabled": true, "vertices": [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]}]
	t.eq(D.masks_active({"masks_enabled": false, "masks": tri}), false, "masks off: not active even with a valid triangle")
	t.eq(D.masks_active({"masks_enabled": true, "masks": [{"enabled": true, "vertices": [[0.1, 0.1], [0.9, 0.1]]}]}), false, "an enabled mask with 2 corners does not filter")
	t.eq(D.masks_active({"masks_enabled": true, "masks": [{"enabled": false, "vertices": [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]}]}), false, "a disabled mask does not filter")
	t.eq(D.masks_active({"masks_enabled": true, "masks": tri}), true, "masks on with one enabled triangle is active")


func test_masks_round_trip() -> void:
	var ms := [{"enabled": true, "vertices": [[0.1, 0.1], [0.9, 0.1], [0.5, 0.9]]}, {"enabled": false, "vertices": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]}]
	var d := D.with_masks({}, "cam_1", true, ms)
	t.eq(D.masks_of(d, "cam_1"), {"masks_enabled": true, "masks": ms}, "round trip gives back what was written")
