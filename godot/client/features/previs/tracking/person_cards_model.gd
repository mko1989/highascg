extends RefCounted
## WO-665 — cut-out cards (research step 1, docs/research/multi-camera-person-texturing.md): which camera shows a
## tracked person best, how tall their card is, and their cut-out mask. Pure; person_cards.gd draws the result.
##
## Input = the WS `tracking:detections` snapshot (src/tracking/register.js withPins):
##   cameras[] {id, role, stale, mask_size?, persons[] {tid, box [x1,y1,x2,y2] 0–1, age_s, mask?}}
##   world {plane_z, persons[] {id, x, y, height|null, keys ["camId:tid", …], age_s}}
## plus the tracking cameras (tracking_model.normalize(...).cameras: {id, role, raster [w,h], cam {...}}).

const C := preload("res://features/previs/tracking/camera_model.gd")
const PD := preload("res://features/previs/tracking/person_dummy_model.gd")

const DEFAULT_HEIGHT := 1.75  # m — a card whose height can't be measured (no solved camera, ray misses)
const MIN_HEIGHT := 0.4
const MAX_HEIGHT := 2.6


## One card per world person a camera currently sees: {id, cam_id, role, box, mask, mask_size, feet [x,y,z] PSN,
## height, width (m), views (WO-666: the solved cameras that paint their dummy, person_dummy_model.views_for),
## joints (WO-667: 17 PSN body joints | null, src/tracking/pose3d.js)}.
## `cams` = normalized tracking cameras.
static func cards(snap: Variant, cams: Array) -> Array:
	var out := []
	if not (snap is Dictionary) or not (snap.get("world") is Dictionary):
		return out
	var by_id := {}
	for ce in cams:
		by_id[str(ce.id)] = ce
	var views := {}  # "camId:tid" → {cam, person}
	for c in snap.get("cameras", []):
		if not (c is Dictionary) or c.get("stale", true):
			continue
		for p in c.get("persons", []):
			views["%s:%s" % [c.id, int(p.get("tid", -1))]] = {"cam": c, "person": p}
	var plane_z := float(snap.world.get("plane_z", 0.0))
	for wp in snap.world.get("persons", []):
		var v := best_view(wp, views, by_id)
		if v.is_empty():
			continue
		var ce: Dictionary = by_id[str(v.cam.id)]
		var box: Array = v.person.box
		var feet := [float(wp.x), float(wp.y), plane_z]
		var h: float = float(wp.height) if wp.get("height") != null else estimate_height(ce, box, feet)
		h = clampf(h, MIN_HEIGHT, MAX_HEIGHT) if is_finite(h) and h > 0.0 else DEFAULT_HEIGHT
		var raster: Array = ce.raster
		var bw: float = (float(box[2]) - float(box[0])) * float(raster[0])
		var bh: float = maxf((float(box[3]) - float(box[1])) * float(raster[1]), 1e-6)
		out.append({"id": int(wp.id), "cam_id": str(v.cam.id), "role": str(v.cam.get("role", ce.role)), "box": box,
			"mask": str(v.person.get("mask", "")), "mask_size": v.cam.get("mask_size", []), "feet": feet,
			"height": h, "width": h * bw / bh, "views": PD.views_for(wp, views, by_id),
			"joints": wp.get("joints")})
	return out


## The camera with the largest live (age_s 0) picture of the person, in raster pixels; a live view beats a coasting
## one. {} when no camera sees them.
static func best_view(wp: Dictionary, views: Dictionary, by_id: Dictionary) -> Dictionary:
	var best := {}
	var best_score := -1.0
	for k in wp.get("keys", []):
		var v: Variant = views.get(str(k))
		if v == null or not by_id.has(str(v.cam.id)):
			continue
		var box: Variant = v.person.get("box")
		if not (box is Array) or (box as Array).size() < 4:
			continue
		var raster: Array = by_id[str(v.cam.id)].raster
		var area := (float(box[2]) - float(box[0])) * float(raster[0]) * (float(box[3]) - float(box[1])) * float(raster[1])
		var score := area * (1.0 if float(v.person.get("age_s", 0.0)) == 0.0 else 0.25)
		if score > best_score:
			best_score = score
			best = v
	return best


## Height of the box top above the feet: the camera ray through the (undistorted) top-centre pixel, at the point
## where it passes the person's vertical line (closest approach in plan). NAN when the camera can't say.
static func estimate_height(ce: Dictionary, box: Array, feet: Array) -> float:
	var cam: Dictionary = ce.cam
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	if not C.valid_view(cam, w, h):
		return NAN
	var top: Array = C.invert_distortion([[(float(box[0]) + float(box[2])) / 2.0 * w, float(box[1]) * h]], w, h,
		float(cam.get("lens_k1", 0.0)), float(cam.get("lens_k2", 0.0)))
	if top.is_empty() or top[0] == null:
		return NAN
	var d := ray_dir(cam, top[0], w, h)
	var dxy := Vector2(d[0], d[1])
	if dxy.length_squared() < 1e-12:
		return NAN
	var t := (Vector2(feet[0] - cam.pos_x, feet[1] - cam.pos_y)).dot(dxy) / dxy.length_squared()
	if t <= 0.0:
		return NAN
	return float(cam.pos_z) + t * d[2] - float(feet[2])


## PSN direction [x, y, z] of the camera ray through screen pixel s (pinhole; same frame maths as unproject).
static func ray_dir(cam: Dictionary, s: Array, w: float, h: float) -> Array:
	var r := C.rotation(cam.pitch, cam.yaw, cam.roll)
	var aspect := w / h
	var f := 1.0 / tan(deg_to_rad(C.hfov_to_vfov(cam.fov, aspect)) / 2.0)
	var dx := ((float(s[0]) / w) * 2.0 - 1.0) * aspect / f
	var dy := (1.0 - (float(s[1]) / h) * 2.0) / f
	var gx: float = r[0] * dx + r[1] * dy - r[2]  # Godot frame (x, up, -y)
	var gy: float = r[3] * dx + r[4] * dy - r[5]
	var gz: float = r[6] * dx + r[7] * dy - r[8]
	return [gx, -gz, gy]


## The sidecar's mask (tools/tracking-detect/seg.py: base64 of packbits, MSB first, row 0 = box top) → an L8 image
## (0 / 255), or null when it doesn't decode to w × h.
static func mask_image(b64: String, size: Variant) -> Image:
	if b64 == "" or not (size is Array) or (size as Array).size() != 2:
		return null
	var w := int(size[0])
	var h := int(size[1])
	var raw := Marshalls.base64_to_raw(b64)
	if w <= 0 or h <= 0 or raw.size() * 8 < w * h:
		return null
	var px := PackedByteArray()
	px.resize(w * h)
	for i in w * h:
		px[i] = 255 if (raw[i >> 3] >> (7 - (i & 7))) & 1 else 0
	return Image.create_from_data(w, h, false, Image.FORMAT_L8, px)
