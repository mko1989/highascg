extends RefCounted
## WO-666 — textured dummies (research step 2, docs/research/multi-camera-person-texturing.md): which cameras paint a
## tracked person's mannequin, and the per-camera uniforms person_dummy.gdshader projects with. Pure.
##
## project_uv() is the GDScript twin of the shader's projection (camera_model.project + apply_distortion, in 0..1
## raster units); the tests pin it against camera_model, so the shader and the solved cameras can't drift apart.

const C := preload("res://features/previs/tracking/camera_model.gd")
const MAX_VIEWS := 3  # the shader's camera slots


## Up to MAX_VIEWS live views of one world person, biggest box first: [{cam_id, role, box, mask, mask_size, ce}].
## `views` / `by_id` as person_cards_model.cards builds them.
static func views_for(wp: Dictionary, views: Dictionary, by_id: Dictionary) -> Array:
	var out := []
	for k in wp.get("keys", []):
		var v: Variant = views.get(str(k))
		if v == null or not by_id.has(str(v.cam.id)):
			continue
		var box: Variant = v.person.get("box")
		var ce: Dictionary = by_id[str(v.cam.id)]
		if not (box is Array) or (box as Array).size() < 4 or not C.valid_view(ce.cam, ce.raster[0], ce.raster[1]):
			continue
		var area := (float(box[2]) - float(box[0])) * float(ce.raster[0]) * (float(box[3]) - float(box[1])) * float(ce.raster[1])
		out.append({"cam_id": str(v.cam.id), "role": str(v.cam.get("role", ce.role)), "box": box,
			"mask": str(v.person.get("mask", "")), "mask_size": v.cam.get("mask_size", []), "ce": ce, "_a": area})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a._a > b._a)
	return out.slice(0, MAX_VIEWS)


## One camera's shader uniforms: rot (Basis — its columns are camera_model.rotation's), pos (Godot frame),
## lens [f, aspect, k1, k2], raster [w, h].
static func cam_uniforms(ce: Dictionary) -> Dictionary:
	var cam: Dictionary = ce.cam
	var w := float(ce.raster[0])
	var h := float(ce.raster[1])
	var r := C.rotation(cam.pitch, cam.yaw, cam.roll)
	var aspect := w / h
	return {"rot": Basis(Vector3(r[0], r[3], r[6]), Vector3(r[1], r[4], r[7]), Vector3(r[2], r[5], r[8])),
		"pos": C.psn_to_godot([cam.pos_x, cam.pos_y, cam.pos_z]),
		"lens": Vector4(1.0 / tan(deg_to_rad(C.hfov_to_vfov(cam.fov, aspect)) / 2.0), aspect,
			float(cam.get("lens_k1", 0.0)), float(cam.get("lens_k2", 0.0))),
		"raster": Vector2(w, h)}


## A Godot-frame point → where camera `u` (cam_uniforms) shows it, 0..1 raster units, lens applied; null when it is
## at / behind the camera. Line for line what person_dummy.gdshader's cam_uv() does.
static func project_uv(u: Dictionary, p: Vector3) -> Variant:
	var t: Vector3 = p - u.pos
	var rot: Basis = u.rot
	var v := Vector3(rot.x.dot(t), rot.y.dot(t), rot.z.dot(t))  # Rᵀ · t
	if v.z >= -1e-9:
		return null
	var lens: Vector4 = u.lens
	var uv := Vector2(((lens.x / lens.y) * (v.x / -v.z) + 1.0) / 2.0, (1.0 - lens.x * (v.y / -v.z)) / 2.0)
	var raster: Vector2 = u.raster
	var d := (uv - Vector2(0.5, 0.5)) * raster / (0.5 * raster.length())
	var r2 := d.length_squared()
	return Vector2(0.5, 0.5) + (uv - Vector2(0.5, 0.5)) * (1.0 + lens.z * r2 + lens.w * r2 * r2)


## Yaw (radians, about +Y) that turns the dummy's front (+Z) toward a camera — the best view paints the front.
static func face_yaw(feet: Vector3, cam_pos: Vector3) -> float:
	return atan2(cam_pos.x - feet.x, cam_pos.z - feet.z)
