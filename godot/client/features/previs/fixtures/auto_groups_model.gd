extends RefCounted
## WO-680 — automatic fixture groups, worked out from the patch every time the Groups menu opens (never stored: a
## re-patch cannot leave them stale, and the operator's own groups stay as they are).
## By position: per fixture type, the rows its fixtures hang in — same mount, chained within ROW_GAP in (upstage,
## height), so a truss line, a floor line or a vertical ladder is one row — each in stage-right → stage-left order;
## a row of HALVES_MIN or more also splits into its stage-right / stage-left half; a type in several rows also gets
## "· all" (row after row). By address: one group per universe,
## in address order. PSN frame: x stage left, y upstage, z up.

const ROW_GAP := 1.2  ## m
const HALVES_MIN := 4

## patch: normalized typed entries ({id, name, typeId, protocol, universe, address, pose}). → [{name, ids}]
static func by_position(patch: Array) -> Array:
	var types := {}
	for f in patch:
		var t := str(f.get("typeId", ""))
		if t != "":
			types[t] = types.get(t, []) + [f]
	var out: Array = []
	var named := {}
	for t in types:
		named[_type_name(types[t])] = t
	var names := named.keys()
	names.sort()
	for tname in names:
		var rows := _rows(types[named[tname]])
		if rows.size() > 1:
			var all: Array = []
			for row in rows:
				all.append_array(_ordered(row))
			out.append({"name": "%s · all" % tname, "ids": all})
		for row in rows:
			var label: String = tname if rows.size() == 1 else "%s · %s" % [tname, _row_label(row)]
			out.append({"name": label, "ids": _ordered(row)})
			if row.size() >= HALVES_MIN:
				out.append_array(_halves(row, label))
	return _unique_names(out)


static func by_address(patch: Array) -> Array:
	var unis := {}
	for f in patch:
		var key := "%s %d" % ["sACN" if f.get("protocol") == "sacn" else "Art-Net", int(f.get("universe", 0))]
		unis[key] = unis.get(key, []) + [f]
	var keys := unis.keys()
	keys.sort_custom(func(a: String, b: String) -> bool:
		return a.get_slice(" ", 0) < b.get_slice(" ", 0) or (a.get_slice(" ", 0) == b.get_slice(" ", 0)
			and int(a.get_slice(" ", 1)) < int(b.get_slice(" ", 1))))
	var out: Array = []
	for k in keys:
		var list: Array = unis[k].duplicate()
		list.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return int(a.address) < int(b.address))
		out.append({"name": k, "ids": list.map(func(f: Dictionary) -> String: return str(f.id))})
	return out


## The name the type's fixtures share without their numbers ("Sharpy Plus 101" → "Sharpy Plus"), most common first.
static func _type_name(list: Array) -> String:
	var count := {}
	var re := RegEx.create_from_string("[\\s._-]*\\d+$")
	for f in list:
		var n := re.sub(str(f.get("name", "")), "").strip_edges()
		if n != "":
			count[n] = int(count.get(n, 0)) + 1
	var best := ""
	for n in count:
		if best == "" or count[n] > count[best] or (count[n] == count[best] and n < best):
			best = n
	return best if best != "" else str(list[0].get("typeId", "?"))


## Single-link rows: same mount, (y, z) within ROW_GAP of a row member. Highest row first.
static func _rows(list: Array) -> Array:
	var rows: Array = []
	for f in list:
		var joined: Array = []
		for r in rows:
			for g in r:
				if g.pose.hang == f.pose.hang and Vector2(g.pose.y - f.pose.y, g.pose.z - f.pose.z).length() <= ROW_GAP:
					joined.append(r)
					break
		var merged: Array = [f]
		for r in joined:
			merged.append_array(r)
			rows.erase(r)
		rows.append(merged)
	rows.sort_custom(func(a: Array, b: Array) -> bool: return _mean_z(a) > _mean_z(b))
	return rows


static func _mean_z(row: Array) -> float:
	var s := 0.0
	for f in row:
		s += float(f.pose.z)
	return s / maxf(1.0, row.size())


static func _row_label(row: Array) -> String:
	return "floor" if row[0].pose.hang == "floor" else "%.1f m" % _mean_z(row)


## Stage right → stage left (PSN x up); within a column top first, then downstage first.
static func _ordered(list: Array) -> Array:
	var l := list.duplicate()
	l.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if absf(a.pose.x - b.pose.x) > 0.15:
			return a.pose.x < b.pose.x
		return a.pose.z > b.pose.z + 0.05 or (absf(a.pose.z - b.pose.z) <= 0.05 and a.pose.y < b.pose.y))
	return l.map(func(f: Dictionary) -> String: return str(f.id))


static func _halves(row: Array, label: String) -> Array:
	var lo := INF
	var hi := -INF
	for f in row:
		lo = minf(lo, f.pose.x)
		hi = maxf(hi, f.pose.x)
	if hi - lo < 1.0:
		return []
	var mid := (lo + hi) / 2.0
	var sr := row.filter(func(f: Dictionary) -> bool: return f.pose.x < mid)
	var sl := row.filter(func(f: Dictionary) -> bool: return f.pose.x >= mid)
	return [{"name": "%s SR" % label, "ids": _ordered(sr)}, {"name": "%s SL" % label, "ids": _ordered(sl)}]


static func _unique_names(groups: Array) -> Array:
	var seen := {}
	for g in groups:
		var n: String = g.name
		var k := 2
		while seen.has(g.name):
			g.name = "%s (%d)" % [n, k]
			k += 1
		seen[g.name] = true
	return groups
