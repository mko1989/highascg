extends RefCounted
## WO-666 — the neutral mannequin the dummies are painted on: built from Godot primitives (no asset, no licence),
## 1 m tall with the feet at y = 0 and the front toward +Z; person_cards scales it to the person's height. Arms hang
## at the sides: without pose (research step 3) a raised arm smears onto the torso — the known step-2 limit.

## [part, centre (x, y, z), size (radius, height)] as fractions of the height. Capsules stand along Y.
const PARTS := [
	["sphere", Vector3(0, 0.935, 0.005), Vector2(0.065, 0.13)],  # head
	["capsule", Vector3(0, 0.845, 0), Vector2(0.035, 0.10)],  # neck
	["capsule", Vector3(0, 0.655, 0), Vector2(0.115, 0.30)],  # chest
	["capsule", Vector3(0, 0.505, 0), Vector2(0.105, 0.18)],  # hips
	["capsule", Vector3(-0.058, 0.25, 0), Vector2(0.058, 0.50)],  # legs
	["capsule", Vector3(0.058, 0.25, 0), Vector2(0.058, 0.50)],
	["capsule", Vector3(-0.172, 0.60, 0), Vector2(0.038, 0.36)],  # arms
	["capsule", Vector3(0.172, 0.60, 0), Vector2(0.038, 0.36)],
]
const DEPTH := 0.62  # torso / limbs flattened front-to-back

static var _mesh: ArrayMesh


static func mesh() -> ArrayMesh:
	if _mesh == null:
		_mesh = build()
	return _mesh


static func build() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for p in PARTS:
		var size: Vector2 = p[2]
		var prim: PrimitiveMesh
		if p[0] == "sphere":
			var s := SphereMesh.new()
			s.radius = size.x
			s.height = size.y
			s.radial_segments = 24
			s.rings = 12
			prim = s
		else:
			var c := CapsuleMesh.new()
			c.radius = size.x
			c.height = maxf(size.y, size.x * 2.0)
			c.radial_segments = 20
			c.rings = 6
			prim = c
		var depth := 1.0 if p[0] == "sphere" else DEPTH
		st.append_from(prim, 0, Transform3D(Basis.from_scale(Vector3(1, 1, depth)), p[1]))
	st.generate_normals()  # append_from carries the primitives' normals unscaled; flattened parts need fresh ones
	return st.commit()
