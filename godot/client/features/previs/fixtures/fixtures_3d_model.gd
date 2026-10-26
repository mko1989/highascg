extends RefCounted
## WO-615 T5 — pure helpers for fixtures_3d.gd (GDTF fixtures on the 3D stage). The server's rig
## (GET /api/fixtures/types/<id>/rig) is already in Godot's frame; this places it and animates it.
##
## Pose: GDTF models a fixture hanging (beam down), which is the patch's "truss" hang as is; "floor" stands it up by
## turning it 180° about the stage Y axis (Godot Z), so pan 0 / positive tilt still swing toward `yaw` — the same
## frame follow-ik.js aims in (yaw 0 = upstage, clockwise seen from above: Godot rotation −yaw about Y).
## Axes: Pan turns about the node's Godot Y (GDTF Z), Tilt about its X, by the decoded degrees.

const Tint := preload("res://features/previs/model_tint.gd")

const MAX_LIGHTS := 64  ## SpotLight3D budget over the whole rig; further beams (and Glow beams) draw cone + lens only
const CONE_LENGTH := 12.0  ## metres
const CONE_ALPHA := 0.16
const MAX_GOBOS := 16  ## projecting lights (each needs a shadow map); further gobos show as plain spots
const CELL_BEAMS := 4  ## a rig with more beams (pixel panel, LED bar) draws its cells glowing — no cones / lights


static func typed(slice: Variant) -> Array:
	var out: Array = []
	var patch: Variant = (slice as Dictionary).get("patch") if slice is Dictionary else null
	if not patch is Array:
		return out
	for f in patch:
		if f is Dictionary and str(f.get("typeId", "")).length() == 12 and str(f.get("mode", "")) != "":
			out.append(f)
	return out


static func rig_key(fx: Dictionary) -> String:
	return "%s|%s" % [fx.get("typeId", ""), fx.get("mode", "")]


static func pose_xform(pose: Variant) -> Transform3D:
	var p: Dictionary = pose if pose is Dictionary else {}
	var pos := Vector3(float(p.get("x", 0.0)), float(p.get("z", 6.0)), -float(p.get("y", 0.0)))
	# YXZ Euler: yaw about up (negated), then the WO-615 T10 MVR mount pitch / roll — gdtf-ik.js poseXf is the twin.
	var b := Basis.from_euler(Vector3(deg_to_rad(float(p.get("pitch", 0.0))), -deg_to_rad(float(p.get("yaw", 0.0))),
		deg_to_rad(float(p.get("roll", 0.0)))))
	if str(p.get("hang", "truss")) == "floor":
		b = b * Basis(Vector3.BACK, PI)
	return Transform3D(b, pos)


static func axis_basis(kind: String, deg: float) -> Basis:
	if kind == "pan":
		return Basis(Vector3.UP, deg_to_rad(deg))
	if kind == "tilt":
		return Basis(Vector3.RIGHT, deg_to_rad(deg))
	return Basis.IDENTITY


## A unit cone (apex radius ≈ 0, base radius 1, height 1, hanging below its node) scaled to the beam's full angle.
static func cone_scale(zoom_deg: float, length := CONE_LENGTH) -> Vector3:
	var r := length * tan(deg_to_rad(clampf(zoom_deg, 0.5, 170.0) * 0.5))
	return Vector3(r, length, r)


static func is_cell_rig(rig: Dictionary) -> bool:
	var n := 0
	for node in rig.get("nodes", []):
		n += 1 if node is Dictionary and node.get("kind") == "Beam" else 0
	return n > CELL_BEAMS


static func wants_light(beam: Dictionary, used: int) -> bool:
	return used < MAX_LIGHTS and str(beam.get("beamType", "Wash")) != "Glow"


## {i, c[r,g,b]} → the beam colour at its intensity (alpha = intensity, for the cone shader).
static func tint(b: Dictionary) -> Color:
	var c: Array = b.get("c", [1, 1, 1]) if b.get("c") is Array and (b.get("c") as Array).size() == 3 else [1, 1, 1]
	var i := clampf(float(b.get("i", 0.0)), 0.0, 1.0)
	return Color(float(c[0]), float(c[1]), float(c[2]), i)


## WO-649 — the tint a beam is drawn with: dark while the view renders no light (Live 3D "Lights" off).
static func shown_tint(b: Dictionary, beams_on: bool) -> Color:
	return tint(b) if beams_on else Color(0, 0, 0, 0)


## Where a view ray meets the stage floor (Godot y = 0, PSN z = 0) in front of the camera, or null.
static func floor_hit(from: Vector3, dir: Vector3) -> Variant:
	if absf(dir.y) < 1e-5:
		return null
	var t := -from.y / dir.y
	return from + dir * t if t > 0.0 else null


## WO-678 — a head's body colour: its type's (WO-641) wins; else the colour of the MVR layer it was patched from
## (fixture id `mvr-<uuid>`, `layer_of(uuid)` → layer name); else null (the model's own materials).
static func head_color(id: String, type: String, type_colors: Dictionary, layer_colors: Dictionary, layer_of: Callable) -> Variant:
	var c: Variant = Tint.parse(type_colors.get(type))
	if c == null and id.begins_with("mvr-"):
		c = Tint.parse(layer_colors.get(layer_of.call(id.trim_prefix("mvr-"))))
	return c


## A GDTF model (glb bytes) as a scene, or null.
static func from_glb(bytes: PackedByteArray) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if bytes.is_empty() or doc.append_from_buffer(bytes, "", state) != OK:
		return null
	var scene := doc.generate_scene(state) as Node3D
	# WO-784: a glb without materials (Martin's MAC Aura PXL) gets the importer's default white — use the body grey
	if scene != null and state.get_materials().is_empty():
		var grey := StandardMaterial3D.new()
		grey.albedo_color = Color(0.22, 0.22, 0.24)
		grey.cull_mode = BaseMaterial3D.CULL_DISABLED
		for mi in scene.find_children("*", "MeshInstance3D", true, false):
			for s in (mi as MeshInstance3D).get_surface_override_material_count():
				(mi as MeshInstance3D).set_surface_override_material(s, grey)
	return scene
