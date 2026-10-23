extends RefCounted
## WO-615 T3 — pure helpers for the previs Fixtures section (fixtures_section.gd): free DMX addresses in the patch,
## typed fixtures added from an imported GDTF type (GET /api/fixtures/types summaries), the universe usage lines
## (GET /api/fixtures/dmx) and the `fixtures.dmx` universe list. The patch shape is follow_model.gd's.

const F := preload("res://features/previs/tracking/follow_model.gd")


## Footprint (channels) of a patched fixture: its GDTF mode's, else the generic profile's highest offset.
static func fixture_footprint(fx: Dictionary, types: Array) -> int:
	if str(fx.get("typeId", "")) != "":
		var m := find_mode(types, str(fx.typeId), str(fx.get("mode", "")))
		if not m.is_empty():
			return int(m.footprint)
	return F.footprint(fx)


static func find_type(types: Array, id: String) -> Dictionary:
	for t in types:
		if t is Dictionary and str(t.get("id", "")) == id:
			return t
	return {}


static func find_mode(types: Array, id: String, mode: String) -> Dictionary:
	for m in find_type(types, id).get("modes", []):
		if m is Dictionary and str(m.get("name", "")) == mode:
			return m
	return {}


## 512 flags: which channels of (protocol, universe, destination) the enabled patch already uses.
static func occupied(patch: Array, protocol: String, universe: int, dest: String, types: Array) -> Array:
	var occ := []
	occ.resize(512)
	occ.fill(false)
	for fx in patch:
		if not fx.enabled or fx.protocol != protocol or int(fx.universe) != universe or str(fx.dest) != dest:
			continue
		for c in fixture_footprint(fx, types):
			var at := int(fx.address) - 1 + c
			if at >= 0 and at < 512:
				occ[at] = true
	return occ


## First 1-based address where `width` channels are free, or 0 when the universe has no such gap.
static func first_free(occ: Array, width: int) -> int:
	var run := 0
	for i in 512:
		run = 0 if occ[i] else run + 1
		if run == width:
			return i - width + 2
	return 0


## `count` fixtures of a type / mode at the next free addresses (stops at a full universe). → the new entries.
static func add_typed(patch: Array, types: Array, type_id: String, mode: String, count: int, protocol: String,
		universe: int) -> Array:
	var t := find_type(types, type_id)
	var m := find_mode(types, type_id, mode)
	if t.is_empty() or m.is_empty() or int(m.footprint) < 1:
		return []
	var dest := "" if protocol == "sacn" else F.DEFAULT_DEST
	var work := patch.duplicate()
	var out := []
	var ids := patch.map(func(f: Dictionary) -> String: return str(f.id))
	var n := 1
	var label := str(t.get("shortName", "")) if str(t.get("shortName", "")) != "" else str(t.get("name", "Fixture"))
	for k in count:
		var at := first_free(occupied(work, protocol, universe, dest, types), int(m.footprint))
		if at == 0:
			break
		while ids.has("fx%d" % n):
			n += 1
		ids.append("fx%d" % n)
		var fx := F.normalize_fixture({"id": "fx%d" % n, "name": "%s %d" % [label, k + 1], "protocol": protocol,
			"universe": universe, "address": at, "dest": dest, "typeId": type_id, "mode": mode,
			"pose": {"x": float(k) - (count - 1) / 2.0, "y": 0.0, "z": 6.0, "hang": "truss", "yaw": 0.0}}, work.size())
		work.append(fx)
		out.append(fx)
	return out


## One line per universe from GET /api/fixtures/dmx: "sACN 1 · 78 / 512 ch · 2 fixtures · sending".
static func usage_lines(universes: Array) -> PackedStringArray:
	var out := PackedStringArray()
	for u in universes:
		if not (u is Dictionary):
			continue
		var bad := (u.get("fixtures", []) as Array).filter(func(f: Dictionary) -> bool: return f.get("problem") != null)
		out.append("%s %d → %s · %d / 512 ch · %d fixture%s%s · %s" % [
			"sACN" if u.protocol == "sacn" else "Art-Net", int(u.universe), u.dest, int(u.used),
			(u.fixtures as Array).size(), "" if (u.fixtures as Array).size() == 1 else "s",
			" (%d not output)" % bad.size() if not bad.is_empty() else "", "sending" if u.get("live") == true else "off"])
	return out


## T7 visualiser: what arrives from the console for each patched universe (GET /api/fixtures/dmx `input`).
static func input_lines(universes: Array, input: Variant) -> PackedStringArray:
	var out := PackedStringArray()
	if not input is Dictionary or input.get("visualise") != true:
		return out
	for u in universes:
		if not u is Dictionary:
			continue
		var proto := "sacn" if u.get("protocol") == "sacn" else "artnet"
		var seen := {}
		for r in ((input.get(proto, {}) as Dictionary).get("universes", []) if input.get(proto) is Dictionary else []):
			if r is Dictionary and int(r.get("universe", -1)) == int(u.universe):
				seen = r
		var name := "%s %d" % ["sACN" if proto == "sacn" else "Art-Net", int(u.universe)]
		if seen.is_empty() or float(seen.get("age_ms", 1e9)) > 2500.0:
			out.append("%s ← no console input (rig dark)" % name)
		else:
			out.append("%s ← %s%s" % [name, str(seen.get("from", "?")), " (%s)" % seen.source if str(seen.get("source", "")) != "" else ""])
	return out


## fixtures.dmx.universes with `key` ("sacn:1") switched on or off (normalized, order kept).
static func toggle_universe(dmx: Dictionary, key: String, on: bool) -> Dictionary:
	var d := F.normalize_dmx(dmx)
	if on and not d.universes.has(key):
		d.universes.append(key)
	elif not on:
		d.universes.erase(key)
	return d


## WO-691: delete patched fixtures `ids` from `project` (in place). Deleting the last fixture an MVR scene brought marks
## the scene unpatched (project.previs.mvr.unpatched, as Unpatch does) so the next load does not patch it again.
## → how many were removed.
static func delete_fixtures(project: Dictionary, ids: Array) -> int:
	var fx: Dictionary = project.get("fixtures") if project.get("fixtures") is Dictionary else {}
	var patch: Array = fx.get("patch") if fx.get("patch") is Array else []
	var gone := {}
	for id in ids:
		gone[str(id)] = true
	var kept := patch.filter(func(f: Variant) -> bool: return not (f is Dictionary and gone.has(str(f.get("id", "")))))
	var removed := patch.size() - kept.size()
	if removed == 0:
		return 0
	fx["patch"] = kept
	project["fixtures"] = fx
	var mvr_left := kept.any(func(f: Variant) -> bool: return f is Dictionary and str(f.get("id", "")).begins_with("mvr-"))
	var mvr_gone := ids.any(func(id: Variant) -> bool: return str(id).begins_with("mvr-"))
	var previs: Variant = project.get("previs")
	if mvr_gone and not mvr_left and previs is Dictionary and (previs as Dictionary).get("mvr") is Dictionary:
		previs.mvr["unpatched"] = true
	return removed
