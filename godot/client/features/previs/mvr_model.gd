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


## WO-615 T10 — "mvr-<uuid>" patch ids (POST /api/stage/mvr/<id>/patch) → {uuid: true}: the fixtures the live rig draws.
static func patched_uuids(patch: Variant) -> Dictionary:
	var out := {}
	for f in patch if patch is Array else []:
		var id := str(f.get("id", "")) if f is Dictionary else ""
		if id.begins_with("mvr-"):
			out[id.substr(4)] = true
	return out


## The server's entries merged into the patch: a re-patch refreshes address / type / mode / pose from the file but keeps
## what the operator set on the fixture since (follow, fixed channels, aim height, enabled, pan / tilt invert, name).
static func merge_patch(patch: Array, incoming: Array) -> Array:
	var by_id := {}
	for f in incoming:
		if f is Dictionary:
			by_id[str(f.get("id", ""))] = f
	var out := []
	for f in patch:
		var id := str(f.get("id", "")) if f is Dictionary else ""
		if not by_id.has(id):
			out.append(f)
			continue
		var fx: Dictionary = (by_id[id] as Dictionary).duplicate(true)
		for k in ["follow", "fixed", "aim_z", "enabled", "pan", "tilt", "name"]:
			if (f as Dictionary).has(k):
				fx[k] = f[k]
		out.append(fx)
		by_id.erase(id)
	for f in incoming:
		if f is Dictionary and by_id.has(str(f.get("id", ""))):
			out.append(f)
	return out


## The patch without this scene's fixtures (uuids lower case, mvr_scene.fixture_uuids).
static func unpatch(patch: Array, uuids: Array) -> Array:
	var gone := {}
	for u in uuids:
		gone["mvr-" + str(u)] = true
	return patch.filter(func(f: Variant) -> bool: return not (f is Dictionary and gone.has(str(f.get("id", "")))))


## The patch reply → the section's status line.
static func patch_summary(res: Dictionary) -> String:
	var fx: Array = res.get("fixtures", []) if res.get("fixtures") is Array else []
	var skipped: Array = res.get("skipped", []) if res.get("skipped") is Array else []
	var types: Array = res.get("types", []) if res.get("types") is Array else []
	var txt := "Patched %d fixture%s (%s, %d type%s)." % [fx.size(), "" if fx.size() == 1 else "s",
		"sACN" if res.get("protocol") == "sacn" else "Art-Net", types.size(), "" if types.size() == 1 else "s"]
	if not skipped.is_empty():
		var why := {}
		for s in skipped:
			why[str(s.get("reason", "?"))] = int(why.get(str(s.get("reason", "?")), 0)) + 1
		var parts := PackedStringArray()
		for r in why:
			parts.append("%s ×%d" % [r, why[r]])
		txt += "\nNot patched: " + "; ".join(parts)
	for n in res.get("notes", []) if res.get("notes") is Array else []:
		txt += "\n" + str(n)
	txt += "\nDMX output stays off until you enable it under Fixtures."
	return txt
