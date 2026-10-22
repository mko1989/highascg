extends RefCounted
## WO-616 T9 — `project.previs.tracking.detection` on the client: defaults + clamps mirrored from the server's
## src/tracking/detect-model.js normalizeDetection (the server is the authority; this only keeps the Inspector
## showing what the server will use). Unknown keys survive (`normalize` starts from a deep copy), so masks written
## by a later client are not dropped by this one.

const DEFAULTS := {
	"enabled": false, "model": "yolo26n.onnx", "pose_model": "", "confidence": 0.2, "interval_ms": 67, "max_persons": 10,
	"grace_ms": 500, "threads": 4, "pin_mode": "assist", "pin_marker_id": 1, "pin_point": "top",
	"smoothing": 0.15, "prediction": 8, "assist_radius_m": 1.0, "assist_strength": 0.5,
}
const LIMITS := {
	"confidence": [0.1, 0.95], "interval_ms": [20, 2000], "max_persons": [1, 50], "grace_ms": [0, 10000],
	"threads": [1, 16], "pin_marker_id": [1, 65535], "smoothing": [0.01, 1], "prediction": [0, 30],
	"assist_radius_m": [0.1, 10], "assist_strength": [0, 1],
}
const INTS := ["interval_ms", "max_persons", "grace_ms", "threads", "pin_marker_id"]
const PIN_MODES := ["assist", "replace", "off"]
const PIN_LABELS := {"assist": "Assist — nudge my marker onto the nearest person",
	"replace": "Replace — the marker follows one detected person", "off": "Off — boxes only"}
const MODEL_RE := "^[A-Za-z0-9_][A-Za-z0-9_.-]{0,80}\\.onnx$"


static func normalize(src: Variant) -> Dictionary:
	var out: Dictionary = (src as Dictionary).duplicate(true) if src is Dictionary else {}
	out["enabled"] = out.get("enabled") == true
	var re := RegEx.create_from_string(MODEL_RE)
	var model := str(out.get("model", ""))
	out["model"] = model if re.search(model) != null and not model.contains("..") else DEFAULTS.model
	var pm := str(out.get("pose_model", ""))
	out["pose_model"] = pm if re.search(pm) != null and not pm.contains("..") else ""  # WO-667: "" = no body pose
	for k in LIMITS:
		var v: Variant = out.get(k)
		var lim: Array = LIMITS[k]
		var n: float = clampf(float(v), lim[0], lim[1]) if (v is float or v is int) else float(DEFAULTS[k])
		out[k] = int(round(n)) if INTS.has(k) else n
	out["pin_mode"] = out.get("pin_mode") if PIN_MODES.has(out.get("pin_mode")) else DEFAULTS.pin_mode
	out["pin_point"] = "bottom" if out.get("pin_point") == "bottom" else "top"
	var cams: Variant = out.get("cameras")
	out["cameras"] = cams if cams is Dictionary else {}
	return out


## One hub marker (tracking:markers item) → the driver's position: an assisted marker is steered at its `anchor`
## (the AI-corrected output kept as `out`); one the replace pin owns carries `driven` (the server says so — never
## inferred from source "detect", which a dead assist anchor leaves behind on a marker nobody drives).
static func position_of(m: Dictionary) -> Dictionary:
	var a: Variant = m.get("anchor")
	var out: Variant = [float(m.get("x", 0.0)), float(m.get("y", 0.0)), float(m.get("z", 0.0))] if a is Dictionary else null
	var src: Dictionary = a if a is Dictionary else m
	return {"x": float(src.get("x", 0.0)), "y": float(src.get("y", 0.0)), "z": float(src.get("z", 0.0)),
		"stale": m.get("stale") == true, "name": str(m.get("name", "")), "out": out,
		"driven": m.get("driven") == true and out == null, "status": float(m.get("status", 1.0))}


## Is detection on for this tracking camera? (no entry = watched, as the server's detectCameras)
static func camera_on(d: Dictionary, cam_id: String) -> bool:
	var c: Variant = (d.get("cameras", {}) as Dictionary).get(cam_id)
	return not (c is Dictionary) or c.get("enabled") != false


## d with camera `cam_id` switched on / off (its other fields — masks — kept).
static func with_camera(d: Dictionary, cam_id: String, on: bool) -> Dictionary:
	var out := d.duplicate(true)
	var cams: Dictionary = out.get("cameras", {})
	var c: Dictionary = (cams.get(cam_id) as Dictionary).duplicate(true) if cams.get(cam_id) is Dictionary else {}
	c["enabled"] = on
	cams[cam_id] = c
	out["cameras"] = cams
	return out


## One status line from a tracking:detections snapshot for the camera on screen.
static func status_line(snap: Dictionary, cam_id: String) -> String:
	if snap.is_empty():
		return "No detection data from the server (tracking module off?)"
	if snap.get("enabled") != true:
		return "Detection off"
	var err := str(snap.get("error", ""))
	if snap.get("running") != true:
		return "Starting the detector…" if err.is_empty() else "Detector not running — " + err
	for c in snap.get("cameras", []):
		if c is Dictionary and str(c.get("id", "")) == cam_id:
			if c.get("stale") == true:
				return "Running — no frames from %s (%s) yet" % [cam_id, str(c.get("role", ""))]
			var ps: Array = c.get("persons", [])
			var pinned: int = ps.filter(func(p: Variant) -> bool: return p is Dictionary and p.has("marker")).size()
			return "Running — %d person%s%s%s" % [ps.size(), "" if ps.size() == 1 else "s", " · %d pinned" % pinned if pinned > 0 else "", world_line(snap)]
	return "Running — this camera is not watched (no surface role, or switched off)"


## Camera `cam_id`'s ROI masks: {masks_enabled, masks: [{enabled, vertices: [[x, y] 0–1 of the picture]…]}} (copies).
static func masks_of(d: Dictionary, cam_id: String) -> Dictionary:
	var c: Variant = (d.get("cameras", {}) as Dictionary).get(cam_id)
	var ms: Variant = c.get("masks") if c is Dictionary else null
	var out := []
	for m in (ms as Array if ms is Array else []):
		if m is Dictionary:
			out.append({"enabled": m.get("enabled") != false, "vertices": (m.get("vertices", []) as Array).duplicate(true)})
	return {"masks_enabled": c is Dictionary and c.get("masks_enabled") == true, "masks": out}


## d with camera `cam_id`'s masks replaced (its `enabled` kept; no entry yet = watched).
static func with_masks(d: Dictionary, cam_id: String, masks_enabled: bool, masks: Array) -> Dictionary:
	var out := d.duplicate(true)
	var cams: Dictionary = out.get("cameras", {})
	var c: Dictionary = (cams.get(cam_id) as Dictionary).duplicate(true) if cams.get(cam_id) is Dictionary else {"enabled": true}
	c["masks_enabled"] = masks_enabled
	c["masks"] = masks.duplicate(true)
	cams[cam_id] = c
	out["cameras"] = cams
	return out


## Does mask set `mk` (masks_of) filter anything? The sidecar keeps every box when no enabled mask has 3+ corners.
static func masks_active(mk: Dictionary) -> bool:
	if mk.get("masks_enabled") != true:
		return false
	for m in mk.get("masks", []):
		if m.enabled and (m.vertices as Array).size() >= 3:
			return true
	return false


## T10b: " · world: N (k seen by 2+ cameras)" while the server fuses 2+ solved cameras, else "".
static func world_line(snap: Dictionary) -> String:
	var w: Variant = snap.get("world")
	if not (w is Dictionary) or w.get("fused") != true:
		return ""
	var ps: Array = w.get("persons", [])
	var both: int = ps.filter(func(p: Variant) -> bool: return p is Dictionary and str(p.get("source", "")) == "fused").size()
	return " · world: %d (%d seen by 2+ cameras)" % [ps.size(), both]



## WO-624 E2: the person under a click in the camera view (raster px) — the pin key the server knows: `w:<id>` when
## the box belongs to a fused world person, else `<camera>:<tid>`. Where boxes overlap, the one whose centre is
## nearest the click wins: the operator aims at the middle of the person they mean (box-verified: two people one
## behind the other — "smallest box" picked the wrong one). "" when the click hits no box.
static func person_at(snap: Dictionary, cam_id: String, raster: Vector2, px: Vector2) -> String:
	var best := ""
	var best_d := INF
	for cam in snap.get("cameras", []) if snap.get("enabled") == true else []:
		if not (cam is Dictionary) or str(cam.get("id", "")) != cam_id or cam.get("stale") == true:
			continue
		for p in cam.get("persons", []):
			var b: Variant = p.get("box") if p is Dictionary else null
			if not (b is Array) or (b as Array).size() < 4:
				continue
			var r := Rect2(Vector2(float(b[0]) * raster.x, float(b[1]) * raster.y), Vector2(float(b[2]) - float(b[0]), float(b[3]) - float(b[1])) * raster)
			if r.has_point(px) and r.get_center().distance_squared_to(px) < best_d:
				best_d = r.get_center().distance_squared_to(px)
				best = "w:%d" % int(p.world) if p.get("world") != null else "%s:%d" % [cam_id, int(p.get("tid", 0))]
	return best
