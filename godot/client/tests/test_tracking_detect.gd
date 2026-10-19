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
