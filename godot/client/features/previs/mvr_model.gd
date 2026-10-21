extends RefCounted
## WO-612 — pure helpers for the imported MVR scene (mvr_scene.gd): the server's part transform and the status text.


## Server xform (basis x, y, z columns + origin, Godot frame) → Transform3D; malformed → identity.
static func xform(a: Array) -> Transform3D:
	if a.size() != 12:
		return Transform3D.IDENTITY
	return Transform3D(Basis(Vector3(a[0], a[1], a[2]), Vector3(a[3], a[4], a[5]), Vector3(a[6], a[7], a[8])), Vector3(a[9], a[10], a[11]))


## Where the scene sits on our stage: project.previs.mvr.place {x, y, z (m, stage frame: x stage left, y upstage, z up),
## yaw (°, the pose convention: Godot Ry(−yaw))}. An MVR's origin is wherever its author drew (a Capture venue can sit
## metres off to one side with its floor below ours), so the file's frame is moved, not trusted.
static func place_of(c: Variant) -> Dictionary:
	var p: Dictionary = c.get("place") if c is Dictionary and c.get("place") is Dictionary else {}
	var n := func(k: String, lo: float, hi: float) -> float:
		var v: Variant = p.get(k)
		return clampf(float(v), lo, hi) if v is float or v is int else 0.0
	return {"x": n.call("x", -500, 500), "y": n.call("y", -500, 500), "z": n.call("z", -50, 200), "yaw": n.call("yaw", -360, 360)}


## WO-643 — the scene settings after importing `id` / `name` while `cur` is shown. The same file again (the store is
## content-addressed: same bytes, same id) keeps everything; a new version of the shown scene (same name) keeps its
## place, layer colours, hidden layers / objects and patch state (MVR uuids are stable across versions); anything else
## starts fresh (and gets fitted). A re-import used to reset all of it — the scene fell back to the file's own origin
## while its patched fixtures stayed placed (owner, 21.10: "added the second set of models … wrong 0,0,0").
static func import_cfg(cur: Dictionary, id: String, name: String) -> Dictionary:
	if not cur.is_empty() and (str(cur.get("id", "")) == id or str(cur.get("name", "")) == name):
		var c := cur.duplicate(true)
		c["id"] = id
		c["name"] = name
		return c
	return {"id": id, "name": name, "hidden_layers": []}


static func placement(place: Dictionary) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, -deg_to_rad(float(place.yaw))), Vector3(place.x, place.z, -float(place.y)))


## A patch pose taken from the file's frame onto the stage (inverse = back): position moved, yaw turned; the hang, pitch
## and roll ride along (yaw is the outermost rotation of the pose).
static func place_pose(pose: Dictionary, place: Dictionary, inverse := false) -> Dictionary:
	var t := placement(place)
	if inverse:
		t = t.affine_inverse()
	var q := t * Vector3(float(pose.get("x", 0)), float(pose.get("z", 0)), -float(pose.get("y", 0)))
	var out := pose.duplicate()
	out.x = snappedf(q.x, 0.0001)
	out.y = snappedf(-q.z, 0.0001)
	out.z = snappedf(q.y, 0.0001)
	out.yaw = snappedf(wrapf(float(pose.get("yaw", 0)) + (-1.0 if inverse else 1.0) * float(place.yaw), -180.0, 180.0), 0.001)
	return out


## The patch with this scene's fixtures (uuids lower case) moved from one placement to another.
static func replace_patch(patch: Array, uuids: Array, from: Dictionary, to: Dictionary) -> Array:
	var mine := {}
	for u in uuids:
		mine["mvr-" + str(u)] = true
	var out := []
	for f in patch:
		if f is Dictionary and mine.has(str(f.get("id", ""))) and f.get("pose") is Dictionary:
			var g: Dictionary = (f as Dictionary).duplicate(true)
			g.pose = place_pose(place_pose(f.pose, from, true), to)
			out.append(g)
		else:
			out.append(f)
	return out


## "Fit": the placement that centres the scene's footprint on the stage and stands its lowest point on the floor, keeping
## the yaw. `local` = the content bounds in the scene's own (unplaced) frame.
static func fit_place(local: AABB, yaw: float) -> Dictionary:
	var b := Transform3D(Basis(Vector3.UP, -deg_to_rad(yaw)), Vector3.ZERO) * local
	var c := b.get_center()
	return {"x": snappedf(-c.x, 0.01), "y": snappedf(c.z, 0.01), "z": snappedf(-b.position.y, 0.01), "yaw": yaw}


## Import fits only a scene that is off: its footprint misses the stage origin, or its lowest point is off our floor.
static func needs_fit(local: AABB) -> bool:
	var e := local.end
	var p := local.position
	return not (p.x <= 0.0 and e.x >= 0.0 and p.z <= 0.0 and e.z >= 0.0) or absf(p.y) > 0.5


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
	for k in [["missing_gdtf", "No GDTF (shown as boxes)"], ["gdtf_no_model", "GDTF without a 3D model (shown as boxes)"],
			["missing_files", "Missing files"], ["unsupported", "Not supported"]]:
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


## WO-637: POST /api/fixtures/share/resolve results → one line under the scene summary ("" = nothing to say).
static func share_note(results: Array, offline: String) -> String:
	var got := results.filter(func(r: Dictionary) -> bool: return r.get("status", "") == "replaced")
	var pick := results.filter(func(r: Dictionary) -> bool: return r.get("status", "") in ["choose", "error"])
	var none := results.filter(func(r: Dictionary) -> bool: return r.get("status", "") == "none")
	var parts := PackedStringArray()
	if not got.is_empty():
		parts.append("real GDTF for %s" % ", ".join(PackedStringArray(got.map(func(r: Dictionary) -> String: return str(r.name)))))
	if not pick.is_empty():
		parts.append("%d to pick by hand (Fixtures → Replace…)" % pick.size())
	if not none.is_empty():
		parts.append("%d not on GDTF Share" % none.size())
	if parts.is_empty():
		return "" if offline == "" else "GDTF Share unreachable (%s) — placeholders kept." % offline
	return "GDTF Share: " + "; ".join(parts) + "." + ("" if offline == "" else " (cached list: %s)" % offline)


## WO-637: `info` without the GDTF specs now replaced by real files (they no longer draw as boxes).
static func without_specs(info: Dictionary, specs: Array) -> Dictionary:
	var out := info.duplicate(true)
	var rep: Variant = out.get("report")
	if rep is Dictionary and (rep as Dictionary).get("gdtf_no_model") is Array:
		rep.gdtf_no_model = (rep.gdtf_no_model as Array).filter(func(s: Variant) -> bool: return not specs.has(str(s)))
	return out
