extends RefCounted
## WO-1110 — multi-cell fixtures in a few draw calls. A cell rig (LED wash zones, a pixel strobe, an X-Dot: up to 95
## beams a head) was built as one lens MeshInstance3D with its own material plus one body mesh per cell: a 252-head
## rig came to ~17 000 instances and 42 000 draw calls, and the client fell to 15 fps with the render thread's CPU
## time, not the GPU, as the limit (owner 17.11). Here the cells of one head that hang under the same moving part and
## share a mesh become ONE MultiMeshInstance3D each (lenses; bodies), the cell's light in its instance colour:
## rgb = colour, a = intensity. Real beams (a cone, a spot light) are left as they were.

const MIN_CELLS := 4  # fewer than this is not worth a batch
const LENS_SHADER := "shader_type spatial;\nrender_mode cull_disabled;\nvoid fragment() {\n\tALBEDO = vec3(0.05);\n\tEMISSION = COLOR.rgb * COLOR.a * 4.0;\n}\n"
const GLOW_SHADER := "shader_type spatial;\nrender_mode cull_disabled;\nuniform vec3 body = vec3(0.22, 0.22, 0.24);\nvoid fragment() {\n\tALBEDO = body;\n\tROUGHNESS = 0.8;\n\tEMISSION = COLOR.rgb * COLOR.a;\n}\n"

static var _lens_shader: Shader
static var _glow_shader: Shader


## One beam's light on unbatched parts (what fixtures_3d.gd `_light` did inline): the lens material, a Glow body.
static func plain(p: Dictionary, t: Color) -> void:
	(p.lens as StandardMaterial3D).emission = Color(t.r, t.g, t.b)
	(p.lens as StandardMaterial3D).emission_energy_multiplier = t.a * 4.0
	if p.get("body") is GeometryInstance3D:
		var mi := p.body as GeometryInstance3D
		if mi.material_override is StandardMaterial3D:
			(mi.material_override as StandardMaterial3D).emission_enabled = true
			(mi.material_override as StandardMaterial3D).emission = Color(t.r, t.g, t.b) * t.a


## One beam's light on its batched instances: p.cell = [[MultiMesh, index], …].
static func light(cell: Array, t: Color) -> void:
	for c in cell:
		(c[0] as MultiMesh).set_instance_color(int(c[1]), t)


## Batch the cells of one built fixture: `root` its node, `parts` its {axes, beams} (fixtures_3d.gd `_build`). A beam
## whose lens went into a batch gets `cell` and loses `lens` / `body`. → the number of nodes replaced.
static func run(root: Node3D, parts: Dictionary) -> int:
	var anchors := {root: true}
	for id in parts.axes:
		anchors[parts.axes[id][0]] = true
	var groups := {}  # key → {anchor, mesh, kind, mat, items: [[Transform3D, beam id]], nodes: [MeshInstance3D]}
	for id in parts.beams:
		var p: Dictionary = parts.beams[id]
		if p.has("cone") or p.has("light") or not (p.get("lens_mi") is MeshInstance3D):
			continue
		var lens := p.lens_mi as MeshInstance3D
		_add(groups, anchors, lens, "lens|" + _shape_key(lens.mesh), "lens", id)
		var body: Variant = p.get("body")
		if body is Node3D:
			var list: Array = (body as Node3D).find_children("*", "MeshInstance3D", true, false)
			if body is MeshInstance3D:
				list.append(body)
			for n in list:
				var mi := n as MeshInstance3D
				if mi.mesh == null or mi.has_meta("no_tint"):
					continue
				var glow := mi.material_override is StandardMaterial3D
				_add(groups, anchors, mi, ("glow|" if glow else "body|") + str(mi.mesh.get_instance_id()), "glow" if glow else "body", id)
	var replaced := 0
	for key in groups:
		var g: Dictionary = groups[key]
		if (g.items as Array).size() < MIN_CELLS:
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = g.kind != "body"
		mm.mesh = g.mesh
		mm.instance_count = (g.items as Array).size()
		for i in mm.instance_count:
			mm.set_instance_transform(i, g.items[i][0])
			if mm.use_colors:
				mm.set_instance_color(i, Color(0, 0, 0, 0))
				var p: Dictionary = parts.beams[g.items[i][1]]
				if not p.has("cell"):
					p["cell"] = []
				(p.cell as Array).append([mm, i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = _material(str(g.kind), g.mat)
		if g.kind != "body":
			mmi.set_meta("no_tint", true)
		(g.anchor as Node3D).add_child(mmi)
		for n in g.nodes:
			(n as Node).free()
		replaced += (g.nodes as Array).size()
	for id in parts.beams:
		var p: Dictionary = parts.beams[id]
		if p.has("cell"):  # its lens is in a batch (a lens group is made of beams only, so `cell` means the lens is gone)
			p.erase("lens")
			p.erase("body")
		p.erase("lens_mi")
	return replaced


static func _add(groups: Dictionary, anchors: Dictionary, mi: MeshInstance3D, key: String, kind: String, beam_id: Variant) -> void:
	var xf := Transform3D.IDENTITY
	var at: Node = mi
	while at != null and not anchors.has(at):
		if not (at is Node3D):
			return
		xf = (at as Node3D).transform * xf
		at = at.get_parent()
	if at == null:
		return
	key = "%d|%s" % [at.get_instance_id(), key]
	if not groups.has(key):
		var mat: Material = mi.material_override
		if mat == null and mi.mesh != null and mi.get_surface_override_material_count() > 0:
			mat = mi.get_surface_override_material(0)
		groups[key] = {"anchor": at, "mesh": mi.mesh, "kind": kind, "mat": mat, "items": [], "nodes": []}
	(groups[key].items as Array).append([xf, beam_id])
	(groups[key].nodes as Array).append(mi)


## Lenses are built one mesh each (fixtures_3d_model.gd `lens`): equal shapes share a batch.
static func _shape_key(m: Mesh) -> String:
	if m is BoxMesh:
		return "box%s" % (m as BoxMesh).size.snappedf(0.0005)
	if m is CylinderMesh:
		return "cyl%.4f|%.4f" % [(m as CylinderMesh).top_radius, (m as CylinderMesh).height]
	return str(m.get_instance_id()) if m != null else "none"


static func _material(kind: String, own: Material) -> Material:
	if kind == "body":
		return own  # null = the mesh's own surface materials
	if _lens_shader == null:
		_lens_shader = Shader.new()
		_lens_shader.code = LENS_SHADER
		_glow_shader = Shader.new()
		_glow_shader.code = GLOW_SHADER
	var sm := ShaderMaterial.new()
	sm.shader = _lens_shader if kind == "lens" else _glow_shader
	if kind == "glow" and own is StandardMaterial3D:
		var c := (own as StandardMaterial3D).albedo_color
		sm.set_shader_parameter("body", Vector3(c.r, c.g, c.b))
	return sm
