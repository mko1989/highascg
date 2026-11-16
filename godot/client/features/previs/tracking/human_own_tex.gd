extends RefCounted
## WO-1103 — an own puppet's FBX textures (human_own.gd). Godot's runtime FBX import cannot load an FBX's external
## images (they go through the resource loader, which has no runtime loader for loose .png / .tga files, or through
## the absolute path on the author's machine), so a material left without a colour map gets one from the model's
## folder by file name: the image whose name shares the most words with the material's, with a colour word
## (basecolor / albedo / diffuse / color / _d) for the colour map and a normal word for the normal map. A GLB embeds
## its images and needs none of this.

const IMG := ["png", "jpg", "jpeg", "tga", "webp", "bmp"]
const COLOUR := ["basecolor", "base_color", "albedo", "diffuse", "color", "colour", "_d.", "_bc."]
const NORMAL := ["normal", "_n.", "_nrm", "_nm."]


## Fill the colour (and normal) maps of every material of `root` that has none. Returns the number of maps set.
static func fill(root: Node, folder: String) -> int:
	var files := _images(folder)
	var n := 0
	var cache := {}
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		for s in mi.mesh.get_surface_count():
			var m := mi.get_surface_override_material(s)
			if m == null:
				m = mi.mesh.surface_get_material(s)
			if not (m is BaseMaterial3D) or (m as BaseMaterial3D).albedo_texture != null:
				continue
			var c := (m as BaseMaterial3D).duplicate() as BaseMaterial3D
			var col := _pick(files, m.resource_name, COLOUR)
			if col != "":
				c.albedo_texture = _tex(col, cache)
				c.albedo_color = Color.WHITE
				n += 1
			var nrm := _pick(files, m.resource_name, NORMAL)
			if nrm != "":
				c.normal_enabled = true
				c.normal_texture = _tex(nrm, cache)
				n += 1
			mi.set_surface_override_material(s, c)
	return n


static func _images(folder: String, into: Array = []) -> Array:
	var da := DirAccess.open(folder)
	if da == null:
		return into
	for f in da.get_files():
		if f.get_extension().to_lower() in IMG:
			into.append(folder.path_join(f))
	for d in da.get_directories():
		_images(folder.path_join(d), into)
	return into


## The best file for material `mat` among those with one of `kind`'s words; "" if none shares a word with it.
static func _pick(files: Array, mat: String, kind: Array) -> String:
	var words := _words(mat)
	var best := ""
	var score := 0
	for f: String in files:
		var low := f.get_file().to_lower()
		if not kind.any(func(k: String) -> bool: return low.contains(k)):
			continue
		var sc := 0
		for w in words:
			if low.contains(w):
				sc += w.length()
		if sc > score:
			score = sc
			best = f
	return best


static func _words(name: String) -> Array:
	var out := []
	for w in name.to_lower().replace("-", "_").replace(" ", "_").split("_", false):
		if w.length() >= 3 and not w in ["mat", "material", "mtl", "inst"]:
			out.append(w)
	return out


static func _tex(path: String, cache: Dictionary) -> Texture2D:
	if not cache.has(path):
		var img := Image.load_from_file(path)
		if img != null and not img.is_empty():
			if maxi(img.get_width(), img.get_height()) > 2048:
				var k := 2048.0 / maxi(img.get_width(), img.get_height())
				img.resize(int(img.get_width() * k), int(img.get_height() * k), Image.INTERPOLATE_LANCZOS)
			img.generate_mipmaps()
		cache[path] = ImageTexture.create_from_image(img) if img != null and not img.is_empty() else null
	return cache[path]
