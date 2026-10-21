extends RefCounted
## WO-641 — colour overrides for previs models: per MVR layer (project.previs.mvr.layer_colors) and per GDTF fixture
## type (project.previs.fixture_colors), each a {name → "#rrggbb"} map. A tinted MeshInstance3D gets its own matte
## material as material_override (its own: a Glow fixture's body lights its material) and gets back whatever override
## it had when the colour is cleared. Meshes tagged `no_tint` (a VideoScreen's picture, a lens, a cone, the selection
## box) are left alone.

const TINT_ORIG := "tint_orig"


## "#rrggbb" → Color, anything else → null (no override).
static func parse(v: Variant) -> Variant:
	if not v is String or not (v as String).begins_with("#") or not Color.html_is_valid(v):
		return null
	return Color.html(v)


static func hex(c: Color) -> String:
	return "#" + c.to_html(false)


## The colour map stored at `d[key]`, or {}.
static func colors(d: Variant, key: String) -> Dictionary:
	return (d as Dictionary).get(key, {}) if d is Dictionary and (d as Dictionary).get(key) is Dictionary else {}


## `colors` with `name` set to `c` (null clears it) — a new map, the input is left as it was.
static func with_color(colors_in: Dictionary, name: String, c: Variant) -> Dictionary:
	var out := colors_in.duplicate()
	if c is Color:
		out[name] = hex(c)
	else:
		out.erase(name)
	return out


## Tint every mesh under `root` (null = back to the model's own materials).
static func apply(root: Node, color: Variant) -> void:
	var meshes := root.find_children("*", "MeshInstance3D", true, false)
	if root is MeshInstance3D:
		meshes.append(root)
	for n in meshes:
		var mi := n as MeshInstance3D
		if mi.has_meta("no_tint"):
			continue
		if color is Color:
			if not mi.has_meta(TINT_ORIG):
				mi.set_meta(TINT_ORIG, [mi.material_override])  # wrapped: set_meta(k, null) would erase the key
			var mat := StandardMaterial3D.new()
			mat.albedo_color = color
			mat.roughness = 0.8
			mi.material_override = mat
		elif mi.has_meta(TINT_ORIG):
			mi.material_override = mi.get_meta(TINT_ORIG)[0]
			mi.remove_meta(TINT_ORIG)
