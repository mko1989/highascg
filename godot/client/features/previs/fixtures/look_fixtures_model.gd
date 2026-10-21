extends RefCounted
## WO-615 T8 — fixture states stored per look: project.fixtures.looks = {lookId: {values: {fixtureId: {key: value}}}}
## (the programmer at Store time; a PGM TAKE of the look crossfades the rig to it on the server). Lives in the fixtures
## slice, not on the look (web migrateScene whitelists look keys). Pure; twin of fixture-looks.js normalizeLooks.

const MAX_LOOKS := 1000


static func normalize_looks(raw: Variant) -> Dictionary:
	var out := {}
	if not raw is Dictionary:
		return out
	for id in raw:
		if out.size() >= MAX_LOOKS:
			break
		var e: Variant = raw[id]
		var vals: Variant = e.get("values") if e is Dictionary else null
		if not vals is Dictionary:
			continue
		var values := {}
		for fx in vals:
			if vals[fx] is Dictionary and not (vals[fx] as Dictionary).is_empty():
				values[str(fx)] = (vals[fx] as Dictionary).duplicate(true)
		out[str(id)] = {"values": values}
	return out


## How many fixtures look `id` stores (0 = none).
static func count(looks: Dictionary, id: String) -> int:
	return (looks.get(id, {}).get("values", {}) as Dictionary).size() if looks.get(id) is Dictionary else 0


## Looks with `id` storing `values` (the GET /api/fixtures/program map); an empty programmer clears the entry.
static func store(looks: Dictionary, id: String, values: Dictionary) -> Dictionary:
	var out := looks.duplicate(true)
	out.erase(id)
	var n := normalize_looks({id: {"values": values}})
	if count(n, id) > 0:
		out[id] = n[id]
	return out


static func clear(looks: Dictionary, id: String) -> Dictionary:
	var out := looks.duplicate(true)
	out.erase(id)
	return out
