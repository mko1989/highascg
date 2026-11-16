extends RefCounted
## WO-1098 — core/venue_import.gd (the Files window's venue import) + the WO-1003 venue reader taking the importer's
## HIGHASCG_venue layers.

const VI := preload("res://core/venue_import.gd")
const Venue := preload("res://features/previs/mvr_venue.gd")
var t


func test_parts_and_when_an_import_starts() -> void:
	t.eq(["a.obj", "a.MTL", "x.zip", "h.skp", "p.JPG", "p.png"].map(func(p: String) -> bool: return VI.is_part(p)), [true, true, true, true, true, true])
	t.eq(["a.mvr", "b.glb", "c.txt"].map(func(p: String) -> bool: return VI.is_part(p)), [false, false, false])
	t.ok(VI.starts_import([["/x/a.obj", "a.obj"]]), "an .obj starts one")
	t.ok(VI.starts_import([["/x/h.skp", "h.skp"]]), "a .skp alone too (the server answers: export OBJ)")
	t.ok(not VI.starts_import([["/x/p.png", "p.png"]]), "a picture alone does not")
	t.ok(VI.HELP.contains("File → Export → 3D Model → OBJ"), "the SketchUp help text")
	t.ok(VI.SKP_ONLY.contains("textures only"))


func test_expand_brings_the_mtl_and_picture_folder() -> void:
	var root := OS.get_user_data_dir().path_join("wo1098-test")
	DirAccess.make_dir_recursive_absolute(root.path_join("Hall/sub"))
	for f in ["Hall.obj", "Hall.mtl", "notes.txt", "Hall/a.jpg", "Hall/sub/b.png", "Hall/readme.txt"]:
		FileAccess.open(root.path_join(f), FileAccess.WRITE).store_string("x")
	var got := VI.expand(PackedStringArray([root.path_join("Hall.obj")]))
	var rels := got.map(func(e: Array) -> String: return str(e[1]))
	rels.sort()
	t.eq(rels, ["Hall.mtl", "Hall.obj", "Hall/a.jpg", "Hall/sub/b.png"], "obj + mtl + the <name>/ folder, kept as paths")
	var whole := VI.expand(PackedStringArray([root]))
	t.ok(whole.any(func(e: Array) -> bool: return str(e[1]) == "wo1098-test/Hall/sub/b.png"), "a dropped folder keeps its name")
	t.eq(VI.expand(PackedStringArray([root.path_join("Hall.obj"), root.path_join("Hall.mtl")])).size(), 4, "nothing twice")
	for f in ["Hall/sub/b.png", "Hall/a.jpg", "Hall/readme.txt", "Hall.obj", "Hall.mtl", "notes.txt"]:
		DirAccess.remove_absolute(root.path_join(f))
	for d in ["Hall/sub", "Hall", ""]:
		DirAccess.remove_absolute(root.path_join(d))


func test_job_and_report_text() -> void:
	t.eq(VI.job_text({"state": "running", "text": "Welding 3/9"}), "Converting… Welding 3/9")
	t.ok(VI.job_text({"state": "error", "error": "No .obj"}).contains("No .obj"))
	var r := {"triangles": {"in": 1781340, "out": 249365}, "nodes": {"in": 4657, "out": 20}, "materials": {"in": 22},
		"textures": [{"how": "material"}, {"how": "placeholder (ignored)"}], "missingTextures": [], "units": {"unit": "m", "source": "file"},
		"up": "y", "bounds": {"size": [30.3, 6.9, 62.2]}}
	var s := VI.report_text(r)
	t.ok(s.contains("1 781 340 → 249 365 triangles"), s)
	t.ok(s.contains("4657 → 20 pieces") and s.contains("1 pictures") and s.contains("Y up") and s.contains("30.3 × 62.2 × 6.9 m"), s)
	t.ok(VI.job_text({"state": "done", "name": "Hall.glb", "report": r}).contains("Venue model"), "says where to use it")


func _glb(json: String) -> PackedByteArray:
	var j := json.to_utf8_buffer()
	while j.size() % 4 != 0:
		j.append(32)
	var b := PackedByteArray()
	b.resize(20)
	b.encode_u32(0, 0x46546C67)
	b.encode_u32(4, 2)
	b.encode_u32(8, 20 + j.size())
	b.encode_u32(12, j.size())
	b.encode_u32(16, 0x4E4F534A)
	b.append_array(j)
	return b


func test_venue_reader_takes_the_importer_layers() -> void:
	t.ok(Venue.is_capture(_glb("{\"extensionsUsed\":[\"HIGHASCG_venue\"]}")), "an imported OBJ venue is a venue model")
	var json := {"asset": {"extensions": {"HIGHASCG_venue": {"layers": [{"identifier": "venue-layer-walls", "name": "Walls"}]}}},
		"nodes": [{"name": "venue", "children": [1]}, {"name": "Walls", "mesh": 0, "extensions": {"HIGHASCG_venue": {"layer_identifier": "venue-layer-walls"}}}]}
	var root := GLTFNode.new()
	root.children = PackedInt32Array([1])
	root.xform = Transform3D(Basis.IDENTITY, Vector3(1, 0, 2))
	var walls := GLTFNode.new()
	walls.parent = 0
	walls.mesh = 0
	var r := Venue.meshes_by_uuid(json, [root, walls], [BoxMesh.new()])
	var parts: Array = r.by.get("glb:1", [])
	t.eq(parts.size(), 1)
	t.eq(str(parts[0].layer), "Walls", "the layer name from HIGHASCG_venue")
	t.eq((parts[0].xf as Transform3D).origin, Vector3(1, 0, 2), "the root placement applies")
