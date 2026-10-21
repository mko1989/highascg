extends RefCounted
## WO-612 — pure helpers for the imported MVR scene (mvr_scene.gd): the server's part transform and the status text.


## Server xform (basis x, y, z columns + origin, Godot frame) → Transform3D; malformed → identity.
static func xform(a: Array) -> Transform3D:
	if a.size() != 12:
		return Transform3D.IDENTITY
	return Transform3D(Basis(Vector3(a[0], a[1], a[2]), Vector3(a[3], a[4], a[5]), Vector3(a[6], a[7], a[8])), Vector3(a[9], a[10], a[11]))


## WO-612 T5 — a bound VideoScreen's crop ({role, raster{w,h}, rect{x,y,w,h}} from the server) → the LED shader's
## uv_rect (x, y, w, h in 0..1). No raster or no rect → the full picture.
static func screen_uv(screen: Variant) -> Vector4:
	var s: Dictionary = screen if screen is Dictionary else {}
	var ra: Dictionary = s.get("raster") if s.get("raster") is Dictionary else {}
	var re: Dictionary = s.get("rect") if s.get("rect") is Dictionary else {}
	var w := float(ra.get("w", 0))
	var h := float(ra.get("h", 0))
	if w <= 0 or h <= 0 or re.is_empty():
		return Vector4(0, 0, 1, 1)
	return Vector4(float(re.get("x", 0)) / w, float(re.get("y", 0)) / h, float(re.get("w", w)) / w, float(re.get("h", h)) / h)


## The bound role of an MVR object ("" = not a HighAsCG screen).
static func screen_role(o: Variant) -> String:
	var s: Variant = o.get("screen") if o is Dictionary else null
	return str(s.get("role", "")) if s is Dictionary else ""


## mvr_scene's loaded info → the section's status line.
static func summary(info: Dictionary) -> String:
	if info.is_empty():
		return "No MVR scene. Import… a .mvr (grandMA3, Vectorworks, Capture …) to see the rig around the screens."
	if info.has("error"):
		return str(info.error)
	var rep: Dictionary = info.get("report", {}) if info.get("report") is Dictionary else {}
	var txt := "%s — %d objects (%d fixtures), %d parts from %d meshes." % [info.get("name", ""), int(info.get("objects", 0)),
		int(info.get("fixtures", 0)), int(info.get("parts", 0)), int(info.get("meshes", 0))]
	for k in [["missing_gdtf", "No GDTF (shown as boxes)"], ["missing_files", "Missing files"], ["unsupported", "Not supported"]]:
		if rep.get(k[0]) is Array and not (rep[k[0]] as Array).is_empty():
			txt += "\n%s: %s" % [k[1], ", ".join(rep[k[0]])]
	if int(info.get("screens", 0)) > 0:
		txt += "\n%d video screen(s) show HighAsCG channels (3D view)." % int(info.screens)
	var failed: Array = info.get("failed", []) if info.get("failed") is Array else []
	if not failed.is_empty():
		txt += "\nMeshes that failed to load: %d" % failed.size()
	return txt
