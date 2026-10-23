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

## WO-701 (owner 23.10: "it should keep on a camera and only change a camera after the subject is facing the other
## camera for at least a 2 3 sec"): another camera must stay the better view this long before a cut-out cuts to it.
const SWITCH_HOLD_S := 2.5
const BACK_WEIGHT := 0.25  # a solved camera behind the person (pose known) counts a quarter of its picture
const DEFAULT_HEIGHT := 1.75  # m — a card whose height can't be measured (no solved camera, ray misses)
const MIN_HEIGHT := 0.4
const MAX_HEIGHT := 2.6


## One card per world person a camera currently sees: {id, cam_id, role, box, mask, mask_size, feet [x,y,z] PSN,
## height, width (m), views (WO-666: the solved cameras that paint their dummy, person_dummy_model.views_for),
## joints (WO-667: 17 PSN body joints | null, src/tracking/pose3d.js)}.
## `cams` = normalized tracking cameras. With `now` (seconds) the camera is sticky per person (WO-701): `pick`
## {world id: memory} is the caller's, kept between snapshots; without it the best view of this snapshot.
static func cards(snap: Variant, cams: Array, pick := {}, now := NAN) -> Array:
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
		var ranked := ranked_views(wp, views, by_id)
		if ranked.is_empty():
			continue
		var v: Dictionary = ranked[0]
		if not is_nan(now):
			var ids := ranked.map(func(r: Dictionary) -> String: return str(r.cam.id))
			if not pick.has(int(wp.id)):
				pick[int(wp.id)] = {}
			v = ranked[ids.find(sticky(pick[int(wp.id)], ids, now))]
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


## The view a cut-out shows best (ranked_views' first), {} when no camera sees them.
static func best_view(wp: Dictionary, views: Dictionary, by_id: Dictionary) -> Dictionary:
	var r := ranked_views(wp, views, by_id)
	return r[0] if not r.is_empty() else {}


## Every view of the person, best first: the picture's size in raster pixels, a coasting view (age_s > 0) × 0.25, and
## (WO-701) when their body pose is known, × how squarely they face that camera — BACK_WEIGHT … 1 from behind to
## straight on (an unsolved camera, whose place is unknown, sits halfway).
static func ranked_views(wp: Dictionary, views: Dictionary, by_id: Dictionary) -> Array:
	var f := facing(wp.get("joints"))
	var scored := []
	for k in wp.get("keys", []):
		var v: Variant = views.get(str(k))
		if v == null or not by_id.has(str(v.cam.id)):
			continue
		var box: Variant = v.person.get("box")
		if not (box is Array) or (box as Array).size() < 4:
			continue
		var ce: Dictionary = by_id[str(v.cam.id)]
		var raster: Array = ce.raster
		var area := (float(box[2]) - float(box[0])) * float(raster[0]) * (float(box[3]) - float(box[1])) * float(raster[1])
		var score := area * (1.0 if float(v.person.get("age_s", 0.0)) == 0.0 else 0.25)
		if f != Vector2.ZERO:
			var cam: Dictionary = ce.get("cam", {})
			var to := Vector2(float(cam.get("pos_x", 0.0)) - float(wp.get("x", 0.0)), float(cam.get("pos_y", 0.0)) - float(wp.get("y", 0.0)))
			var front := 0.5
			if C.valid_view(cam, float(raster[0]), float(raster[1])) and to.length() > 1e-3:
				front = maxf(0.0, f.dot(to.normalized()))
			score *= BACK_WEIGHT + (1.0 - BACK_WEIGHT) * front
		scored.append([score, scored.size(), v])
	scored.sort_custom(func(a: Array, b: Array) -> bool: return a[0] > b[0] or (a[0] == b[0] and a[1] < b[1]))
	return scored.map(func(e: Array) -> Dictionary: return e[2])


## WO-701: which way a person faces on the floor (unit, PSN x / y) from their shoulders and hips (COCO 5 / 6, 11 / 12:
## left minus right, turned a quarter clockwise — facing the audience, left is +x, front is −y); ZERO without them.
static func facing(joints: Variant) -> Vector2:
	if not (joints is Array) or (joints as Array).size() != 17:
		return Vector2.ZERO
	for j in [5, 6, 11, 12]:
		if not (joints[j] is Array) or (joints[j] as Array).size() < 2:
			return Vector2.ZERO
	var a := Vector2(float(joints[5][0]) - float(joints[6][0]) + float(joints[11][0]) - float(joints[12][0]),
		float(joints[5][1]) - float(joints[6][1]) + float(joints[11][1]) - float(joints[12][1]))
	return Vector2(a.y, -a.x).normalized() if a.length() > 1e-3 else Vector2.ZERO


## WO-701: the camera a person's cut-out shows. `st` {cam, rival, since} is that person's memory (updated here),
## `ranked` their cameras best first, `now` seconds. The shown camera stays while it still sees them; another one
## takes over only after being the best for SWITCH_HOLD_S without a break. First sight, or the shown camera lost
## them: the best, at once.
static func sticky(st: Dictionary, ranked: Array, now: float) -> String:
	if ranked.is_empty():
		return ""
	var best := str(ranked[0])
	var cur := str(st.get("cam", ""))
	if cur == "" or not ranked.has(cur):
		st.merge({"cam": best, "rival": "", "since": now}, true)
		return best
	if best == cur:
		st.rival = ""
	elif str(st.get("rival", "")) != best:
		st.rival = best
		st.since = now
	elif now - float(st.since) >= SWITCH_HOLD_S:
		st.cam = best
		st.rival = ""
	return str(st.cam)


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
