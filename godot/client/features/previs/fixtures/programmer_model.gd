extends RefCounted
## WO-615 T6 — pure helpers for the previs Programmer (programmer_section.gd): the selection's features merged (GET
## /api/fixtures/program/features, gdtf-features.js), the values a picked colour means per fixture (RGB mixing, else
## CMY, else the nearest colour-wheel slot), which fixtures own a wheel slot, and saved groups.

const MAX_GROUPS := 64
const RGB_KEYS := {"ColorAdd_R": "r", "ColorAdd_G": "g", "ColorAdd_B": "b",
	"ColorRGB_Red": "r", "ColorRGB_Green": "g", "ColorRGB_Blue": "b"}
const CMY_KEYS := {"ColorSub_C": "r", "ColorSub_M": "g", "ColorSub_Y": "b"}


## What the controls offer for `ids`: a control shows when any selected fixture has it; ranges come from the first
## that has one; wheel slots are listed once per wheel attribute + name (a gobo keeps its first owner's type for the
## thumbnail).
static func merge(feats: Dictionary, ids: Array, type_of: Dictionary) -> Dictionary:
	var out := {"count": 0, "dimmer": false, "mix": false, "colors": [], "gobos": [], "cto": {}, "pan": {}, "tilt": {},
		"zoom": {}}
	for id in ids:
		var f: Dictionary = feats.get(id, {}) if feats.get(id) is Dictionary else {}
		if f.is_empty():
			continue
		out.count += 1
		out.dimmer = out.dimmer or f.get("dimmer") == true
		out.mix = out.mix or can_mix(f)
		for k in ["cto", "pan", "tilt", "zoom"]:
			if (out[k] as Dictionary).is_empty() and f.get(k) is Dictionary:
				out[k] = f[k]
		for c in f.get("colors", []):
			if not _named(out.colors, str(c.attr), str(c.name)):
				out.colors.append(c)
		for g in f.get("gobos", []):
			if not _named(out.gobos, str(g.attr), str(g.name)):
				out.gobos.append((g as Dictionary).merged({"type": str(type_of.get(id, ""))}))
	return out


static func _named(list: Array, attr: String, name: String) -> bool:
	return list.any(func(x: Dictionary) -> bool: return str(x.get("attr", "")) == attr and str(x.get("name", "")) == name)


## A colour picker reaches this fixture: it mixes RGB or CMY, or has a colour wheel.
static func can_mix(f: Dictionary) -> bool:
	var keys: Array = (f.get("add", []) as Array) + (f.get("sub", []) as Array)
	return keys.any(func(k: String) -> bool: return RGB_KEYS.has(k) or CMY_KEYS.has(k)) or not (f.get("colors", []) as Array).is_empty()


## Programmer values for picking colour `c` on one fixture: additive RGB (its other emitters — W, A, UV… — off, the
## pick is the colour), else subtractive CMY, else the colour-wheel slot nearest in RGB. Mixing also opens the
## fixture's colour wheels (their first slot): a red wheel left in would filter the mix to black. {} when it has none.
static func color_values(f: Dictionary, c: Color) -> Dictionary:
	var out := {}
	var add: Array = f.get("add", [])
	var sub: Array = f.get("sub", [])
	if add.any(func(k: String) -> bool: return RGB_KEYS.has(k)):
		for k in add:
			out[k] = {"norm": snappedf(float(c[RGB_KEYS[k]]) if RGB_KEYS.has(k) else 0.0, 0.001)}
	elif sub.any(func(k: String) -> bool: return CMY_KEYS.has(k)):
		for k in sub:
			out[k] = {"norm": snappedf(1.0 - float(c[CMY_KEYS[k]]) if CMY_KEYS.has(k) else 0.0, 0.001)}
	if not out.is_empty():
		for s in f.get("colors", []):
			if not out.has(str(s.attr)):
				out[str(s.attr)] = {"set": str(s.name)}
		return out
	var slot := nearest_slot(f.get("colors", []), c)
	if not slot.is_empty():
		out[str(slot.attr)] = {"set": str(slot.name)}
	return out


static func nearest_slot(colors: Array, c: Color) -> Dictionary:
	var best := {}
	var d := INF
	for s in colors:
		var rgb: Array = s.get("rgb", [1, 1, 1])
		var e := Vector3(float(rgb[0]), float(rgb[1]), float(rgb[2])).distance_squared_to(Vector3(c.r, c.g, c.b))
		if e < d:
			d = e
			best = s
	return best


## Ids (of `ids`) whose fixture has a `kind` ("colors" | "gobos") slot `attr` / `name` — a wheel pick goes only
## there (a name another type lacks would put that fixture's wheel back to its default).
static func owners(feats: Dictionary, ids: Array, kind: String, attr: String, name: String) -> Array:
	return ids.filter(func(id: String) -> bool:
		var f: Dictionary = feats.get(id, {}) if feats.get(id) is Dictionary else {}
		return _named(f.get(kind, []), attr, name))


## project.fixtures.groups → [{name, ids}] (named, deduplicated ids, at most MAX_GROUPS).
static func normalize_groups(raw: Variant) -> Array:
	var out := []
	for g in (raw if raw is Array else []):
		if not g is Dictionary or str(g.get("name", "")).strip_edges() == "" or out.size() >= MAX_GROUPS:
			continue
		var ids := []
		for id in (g.get("ids") if g.get("ids") is Array else []):
			if not ids.has(str(id)):
				ids.append(str(id))
		out.append({"name": str(g.name).strip_edges().left(64), "ids": ids})
	return out


## Groups with `name` set to `ids` (replaces a group of that name, else appends).
static func save_group(groups: Array, name: String, ids: Array) -> Array:
	var out := groups.filter(func(g: Dictionary) -> bool: return g.name != name)
	out.append({"name": name, "ids": ids.duplicate()})
	return normalize_groups(out)


static func drop_group(groups: Array, name: String) -> Array:
	return groups.filter(func(g: Dictionary) -> bool: return g.name != name)
