extends RefCounted
## WO-1024 — the unit shapes of GDTF built-in primitives (gdtf-rig.js primOf): drawn in the model's size box, which the
## rig's mesh_xf scales from this unit cube (x length, y height, z width; centred). GDTF models a fixture hanging (beam
## along −Z, Godot −Y), so a Yoke is a U whose bar is at the top and whose arms hang down round the head.

const ARM := 0.14  # of the length, each arm
const BAR := 0.18  # of the height, the top bar

static var _cache := {}


## "prim:box" | "prim:cylinder" | "prim:sphere" | "prim:yoke" → its unit Mesh (shared); anything else a box.
static func mesh(key: String) -> Mesh:
	if not _cache.has(key):
		_cache[key] = _build(key)
	return _cache[key]


static func _build(key: String) -> Mesh:
	match key:
		"prim:cylinder":
			var c := CylinderMesh.new()
			c.top_radius = 0.5
			c.bottom_radius = 0.5
			c.height = 1.0
			return c
		"prim:sphere":
			var s := SphereMesh.new()
			s.radius = 0.5
			s.height = 1.0
			return s
		"prim:yoke":
			var st := SurfaceTool.new()
			var bar := BoxMesh.new()
			bar.size = Vector3(1.0, BAR, 1.0)
			st.append_from(bar, 0, Transform3D(Basis.IDENTITY, Vector3(0, 0.5 - BAR / 2.0, 0)))
			for sx in [-1.0, 1.0]:
				var arm := BoxMesh.new()
				arm.size = Vector3(ARM, 1.0 - BAR, 1.0)
				st.append_from(arm, 0, Transform3D(Basis.IDENTITY, Vector3(sx * (0.5 - ARM / 2.0), -BAR / 2.0, 0)))
			return st.commit()
	return BoxMesh.new()
