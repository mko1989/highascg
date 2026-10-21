extends RefCounted
## WO-633 T2 — pure helpers for "Replace placeholder…" (replace_type_dialog.gd): which imported types could stand in for
## an MVR placeholder GDTF (best name match first — maker spellings differ: "Robe" / "Robe Lighting", names lose a "+"
## or gain a "Dummy - "), each placeholder mode paired with a real mode (same footprint; ties by shared words / numbers:
## "4 Channel RGBW" → "4Ch-RGBW", not "4Ch-Strobe"), and the project patch re-pointed onto the real type.
## Types are GET /api/fixtures/types summaries ({id, name, manufacturer, modes[{name, footprint}], placeholder?}).


## Lowercase letters + digits only, "Dummy -" dropped: "Robin 600 LEDWash+" → "robin600ledwash".
static func norm(s: String) -> String:
	var t := s.strip_edges().to_lower()
	if t.begins_with("dummy"):
		t = t.substr(5).lstrip(" -–:")
	var re := RegEx.create_from_string("[^a-z0-9]")
	return re.sub(t, "", true)


## 0 = same name, 1 = one name contains the other, 2 = unrelated; makers that agree (one a prefix of the other) win ties.
static func name_rank(stub: Dictionary, t: Dictionary) -> int:
	var a := norm(str(stub.get("name", "")))
	var b := norm(str(t.get("name", "")))
	var rank := 0 if a == b else 1 if a != "" and b != "" and (a.contains(b) or b.contains(a)) else 2
	var ma := norm(str(stub.get("manufacturer", "")))
	var mb := norm(str(t.get("manufacturer", "")))
	var maker := ma != "" and mb != "" and (ma.begins_with(mb) or mb.begins_with(ma))
	return rank * 2 + (0 if maker else 1)


## The types that can replace `stub`: not itself, not placeholders, best name match first (then alphabetical).
static func targets(types: Array, stub: Dictionary) -> Array:
	var out := types.filter(func(t: Dictionary) -> bool:
		return str(t.get("id", "")) != str(stub.get("id", "")) and not t.get("placeholder", false))
	out.sort_custom(func(x: Dictionary, y: Dictionary) -> bool:
		var rx := name_rank(stub, x)
		var ry := name_rank(stub, y)
		if rx != ry:
			return rx < ry
		return "%s %s" % [x.get("manufacturer", ""), x.get("name", "")] < "%s %s" % [y.get("manufacturer", ""), y.get("name", "")])
	return out


static func _words(s: String) -> Array:
	var out := []
	for m in RegEx.create_from_string("[a-z]+|[0-9]+").search_all(s.to_lower()):
		var w := m.get_string()
		if w not in ["ch", "channel", "channels", "mode"] and w not in out:
			out.append(w)
	return out


## {stub mode → real mode name, "" when no real mode has its footprint}. Each real mode is used once while unused ones
## of that footprint remain.
static func pair_modes(stub: Dictionary, real: Dictionary) -> Dictionary:
	var out := {}
	var used := {}
	for sm in stub.get("modes", []):
		var best := ""
		var best_score := -1
		var sw := _words(str(sm.name))
		for rm in real.get("modes", []):
			if int(rm.get("footprint", -1)) != int(sm.get("footprint", -2)):
				continue
			var score := 100 if not used.has(str(rm.name)) else 0
			for w in _words(str(rm.name)):
				if w in sw:
					score += 1
			if score > best_score:
				best_score = score
				best = str(rm.name)
		out[str(sm.name)] = best
		if best != "":
			used[best] = true
	return out


## Patch entries on `stub_id` whose mode has a pair → the real type + mode. → {patch (copies), moved}.
static func repoint(patch: Array, stub_id: String, real_id: String, modes: Dictionary) -> Dictionary:
	var out := []
	var moved := 0
	for fx in patch:
		var to := str(modes.get(str(fx.get("mode", "")), "")) if str(fx.get("typeId", "")) == stub_id else ""
		if to == "":
			out.append(fx)
			continue
		var c: Dictionary = fx.duplicate(true)
		c.typeId = real_id
		c.mode = to
		out.append(c)
		moved += 1
	return {"patch": out, "moved": moved}
