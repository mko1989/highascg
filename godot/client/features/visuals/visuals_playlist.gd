extends RefCounted
## WO-895 — visual playlists, pure half (owner 31.10: "an option to create playlists of visuals, so operator can set it up and
## forget"). Not the Live playlists (features/live/playlists_panel.gd: Caspar media items on a look layer, run by the node):
## these are the Godot Visuals' own pictures, run by the Visuals tab's Auto. `project.visuals.playlists` is a list of
##   {id, name, mode ("loop" | "shuffle"), entries, order (entry indices, this pass), at (position in `order`)}
## and an entry is a picture with a hold:
##   {kind ("look" | "visual"), name, layers (the WO-890 stack), params?, graph? (a look's), hold ("bars" | "seconds" |
##    "drop"), bars, seconds}
## A look entry is a copy of the look (its layer stack, parameters and Flow), so it replays as it was built even after the look
## is changed or deleted; a visual entry (a Sources ▸ Visuals row) is a one-layer stack and keeps the parameters and Flow
## that run. `seconds` is the hold of a seconds entry and the fallback of the other two while no tempo is locked (no beat to
## count bars on, and no music to drop). Auto (`auto.playlist`, visuals_autopilot.gd) runs one playlist; `order` and `at`
## are stored, so the position survives a restart with the rest of the slice (WO-880).

const M := preload("res://features/visuals/visuals_model.gd")
const Layers := preload("res://features/visuals/visuals_layers.gd")
const Looks := preload("res://features/visuals/visuals_looks.gd")
const Auto := preload("res://features/visuals/visuals_autopilot.gd")
const Catalog := preload("res://features/visuals/visuals_catalog.gd")
const MAX := 16
const MAX_ENTRIES := 64
const HOLDS := ["bars", "seconds", "drop"]
const HOLD_LABELS := ["Bars", "Seconds", "Until drop"]
const MODES := ["loop", "shuffle"]
const BARS := 8
const SECONDS := 30.0
const MAX_BARS := 256
const MAX_SECONDS := 3600.0
const LOOK_DRAG := "visual_look"  # the drag payload type of a look button (visuals_show.gd)


## Stored playlists made safe: at most MAX, unique ids, each entry with a stack (empty ones dropped).
static func normalize(v: Variant) -> Array:
	var out := []
	var ids := {}
	for raw in (v if v is Array else []):
		if not raw is Dictionary or out.size() >= MAX:
			continue
		var p := playlist_of(raw)
		if p.id == "" or ids.has(p.id):
			p.id = new_id(out)
		ids[p.id] = true
		out.append(p)
	return out


static func playlist_of(v: Dictionary) -> Dictionary:
	var entries := []
	for e in (v.get("entries") if v.get("entries") is Array else []):
		var n: Variant = entry_of(e)
		if n != null and entries.size() < MAX_ENTRIES:
			entries.append(n)
	var p := {"id": str(v.get("id", "")).strip_edges().left(64) if v.get("id") is String else "",
		"name": str(v.get("name", "")).strip_edges().left(40) if v.get("name") is String else "",
		"mode": str(v.get("mode")) if str(v.get("mode", "")) in MODES else "loop", "entries": entries}
	if p.name == "":
		p.name = "Visual playlist"
	var order := []
	for i in (v.get("order") if v.get("order") is Array else []):
		order.append(int(M._num(i)))
	var sorted := order.duplicate()
	sorted.sort()
	p.order = order if sorted == range(entries.size()) else range(entries.size())  # not this list's permutation → in order
	p.at = clampi(int(M._num(v.get("at"))), 0, maxi(0, entries.size() - 1))
	return p


## One stored entry made safe, or null (no layer it can show).
static func entry_of(v: Variant) -> Variant:
	if not v is Dictionary:
		return null
	var layers := Layers.normalize(v.get("layers"))
	if layers.is_empty():
		return null
	var e := {"kind": "visual", "layers": layers}
	if v.get("kind") == "look":  # every look key (visuals_looks.gd KEYS) through the looks' own rules
		e = Looks.normalize([v])[0]
		e.kind = "look"
	e.name = str(v.get("name", "")).strip_edges().left(60) if v.get("name") is String else ""
	if e.name == "":
		e.name = Looks.auto_name(e)
	e.hold = str(v.get("hold")) if str(v.get("hold", "")) in HOLDS else "bars"
	e.bars = clampi(int(M._num(v.get("bars", BARS))), 1, MAX_BARS)
	e.seconds = clampf(M._num(v.get("seconds", SECONDS)), 1.0, MAX_SECONDS)
	return e


## A look (visuals_looks.gd) as an entry: a copy of its picture.
static func entry_of_look(look: Dictionary) -> Variant:
	var e := {"kind": "look", "name": look.get("name", "")}
	for k in Looks.KEYS:
		e[k] = look.get(k)
	return entry_of(e)


## A drag payload — a Sources ▸ Visuals row or a look button — as an entry, or null.
static func entry_of_drop(data: Variant) -> Variant:
	if data is Dictionary and data.get("type") == LOOK_DRAG and data.get("look") is Dictionary:
		return entry_of_look(data.look)
	var p: Variant = Catalog.parse(data)
	if p == null:
		return null
	var l := Layers.from_payload(p)
	return entry_of({"kind": "visual", "name": str(p.get("label", "")), "layers": [l]}) if not l.is_empty() else null


## The drag payload a look button carries.
static func look_drag(look: Dictionary, i: int) -> Dictionary:
	return {"type": LOOK_DRAG, "index": i, "label": str(look.get("name", "")), "look": look.duplicate(true)}


static func can_drop(data: Variant) -> bool:
	return entry_of_drop(data) != null


static func new_id(existing: Array) -> String:
	var n := existing.size() + 1
	while existing.any(func(p: Dictionary) -> bool: return p.id == "vpl-%d" % n):
		n += 1
	return "vpl-%d" % n


static func new_playlist(existing: Array, name := "") -> Dictionary:
	return playlist_of({"id": new_id(existing), "name": name if name != "" else "Visual playlist %d" % (existing.size() + 1)})


static func find(playlists: Array, id: String) -> int:
	return playlists.find_custom(func(p: Dictionary) -> bool: return p.id == id) if id != "" else -1


## The playlist Auto runs (`slice.auto.playlist`), or null.
static func active(slice: Dictionary) -> Variant:
	var pls: Array = slice.get("playlists") if slice.get("playlists") is Array else []
	var auto: Dictionary = slice.get("auto") if slice.get("auto") is Dictionary else {}
	var i := find(pls, str(auto.get("playlist", "")))
	return pls[i] if i >= 0 else null


## The entry index the playlist is on, or -1 (empty).
static func current_index(pl: Dictionary) -> int:
	return int(pl.order[pl.at]) if pl.at < pl.order.size() else -1


static func current(pl: Dictionary) -> Variant:
	var i := current_index(pl)
	return pl.entries[i] if i >= 0 else null


## `slice` with the entry's picture (a copy): a look entry recalls like the look (visuals_looks.gd apply), a visual entry
## replaces the layer stack only.
static func apply(slice: Dictionary, entry: Dictionary) -> Dictionary:
	if entry.kind == "look":
		return Looks.apply(slice, entry)
	return M.with_layers(slice.duplicate(true), entry.layers.duplicate(true))


## A fresh pass order: every entry once; in shuffle mode random, never starting with `last` while more than one is left.
static func pass_order(n: int, mode: String, rng: RandomNumberGenerator, last := -1) -> Array:
	var o := range(n)
	if mode != "shuffle":
		return o
	for i in range(n - 1, 0, -1):  # Fisher–Yates
		var j := rng.randi_range(0, i)
		var x: int = o[i]
		o[i] = o[j]
		o[j] = x
	if n > 1 and o[0] == last:
		var j := rng.randi_range(1, n - 1)
		o[0] = o[j]
		o[j] = last
	return o


## The playlist after its current entry's hold ended (a copy): the next position; past the end a new pass (loop: in order,
## shuffle: a new shuffle).
static func next(pl: Dictionary, rng: RandomNumberGenerator) -> Dictionary:
	var p := pl.duplicate(true)
	var n: int = p.entries.size()
	if n == 0:
		return p
	if p.at + 1 < p.order.size():
		p.at += 1
	else:
		p.order = pass_order(n, p.mode, rng, current_index(pl))
		p.at = 0
	return p


## The playlist on entry `i` (a copy): its position in this pass.
static func jump(pl: Dictionary, i: int) -> Dictionary:
	var p := pl.duplicate(true)
	var k: int = p.order.find(i)
	if k >= 0:
		p.at = k
	return p


## Loop or shuffle (a copy): a new pass order that starts with the entry it is on.
static func with_mode(pl: Dictionary, mode: String, rng: RandomNumberGenerator) -> Dictionary:
	var p := pl.duplicate(true)
	p.mode = mode if mode in MODES else "loop"
	var cur := current_index(pl)
	p.order = pass_order(p.entries.size(), p.mode, rng)
	if cur >= 0:
		p.order.erase(cur)
		p.order.push_front(cur)
	p.at = 0
	return p


## The playlist with its entries edited (a copy): `map[old index]` = the new index or -1 (removed), `added` = new indices.
## The pass order keeps its sequence, removed entries leave it, added ones join its end; the position stays on the
## entry it was on (or the one that took its place).
static func _remap(pl: Dictionary, entries: Array, map: Array, added: Array) -> Dictionary:
	var p := pl.duplicate(true)
	var cur := current_index(pl)
	p.entries = entries
	var order := []
	var at := 0
	for k in pl.order.size():
		var to: int = map[pl.order[k]]
		if to >= 0:
			order.append(to)
		if k < pl.at and to >= 0:
			at += 1
	order.append_array(added)
	if pl.mode == "loop":
		var now := int(map[cur]) if cur >= 0 and int(map[cur]) >= 0 else -1
		order = range(entries.size())
		at = now if now >= 0 else mini(at, entries.size() - 1)
	p.order = order
	p.at = clampi(at, 0, maxi(0, entries.size() - 1))
	return p


## `entry` inserted at `to` (-1 = the end), or the playlist unchanged when it is full.
static func add_entry(pl: Dictionary, entry: Dictionary, to := -1) -> Dictionary:
	var n: int = pl.entries.size()
	if n >= MAX_ENTRIES:
		return pl.duplicate(true)
	var k := n if to < 0 or to > n else to
	var entries: Array = pl.entries.duplicate(true)
	entries.insert(k, entry.duplicate(true))
	return _remap(pl, entries, range(n).map(func(i: int) -> int: return i if i < k else i + 1), [k])


static func remove_entry(pl: Dictionary, i: int) -> Dictionary:
	if i < 0 or i >= pl.entries.size():
		return pl.duplicate(true)
	var entries: Array = pl.entries.duplicate(true)
	entries.remove_at(i)
	return _remap(pl, entries, range(pl.entries.size()).map(func(j: int) -> int: return -1 if j == i else (j if j < i else j - 1)), [])


static func move_entry(pl: Dictionary, i: int, to: int) -> Dictionary:
	var n: int = pl.entries.size()
	if i < 0 or i >= n or to < 0 or to >= n or i == to:
		return pl.duplicate(true)
	var idx := range(n)
	idx.remove_at(i)
	idx.insert(to, i)
	var map := range(n)
	for k in n:
		map[idx[k]] = k
	return _remap(pl, idx.map(func(j: int) -> Dictionary: return pl.entries[j].duplicate(true)), map, [])


## An entry's hold fields changed (a copy); values made safe.
static func with_hold(pl: Dictionary, i: int, fields: Dictionary) -> Dictionary:
	var p := pl.duplicate(true)
	if i >= 0 and i < p.entries.size():
		var e: Dictionary = p.entries[i]
		e.merge(fields, true)
		p.entries[i] = entry_of(e)
	return p


static func new_hold() -> Dictionary:
	return {"ms": 0.0, "beats": 0, "n": -1, "drop_n": -1}


## One frame of the current entry's hold → true when it has ended. Bars count the box's locked beats (4 to the bar); a drop
## is a rise of the WO-861 drop count; while no tempo is locked, bars and drop holds end after their seconds.
static func hold_done(st: Dictionary, entry: Dictionary, beat: Variant, drop_n: int, dt_ms: float) -> bool:
	st.ms += dt_ms
	var lk := Auto.locked(beat)
	var n := int(beat.get("n", -1)) if lk else -1
	if lk and st.n >= 0 and n != st.n:
		st.beats += 1
	st.n = n
	var dropped: bool = st.drop_n >= 0 and drop_n > st.drop_n
	st.drop_n = drop_n
	var timed: bool = st.ms >= float(entry.seconds) * 1000.0
	match str(entry.hold):
		"seconds":
			return timed
		"drop":
			return dropped or (not lk and timed)
	return (lk and st.beats >= int(entry.bars) * Auto.BEATS_PER_BAR) or (not lk and timed)


## What ends the entry, for the status line: "next in 3 bars", "next in 12 s", "next on a drop".
static func left(st: Dictionary, entry: Dictionary, beat: Variant) -> String:
	var lk := Auto.locked(beat)
	if entry.hold == "seconds" or not lk:
		var s := ceili(maxf(0.0, float(entry.seconds) - st.ms / 1000.0))
		return "next in %d s" % s + (" (no tempo locked)" if entry.hold != "seconds" else "")
	if entry.hold == "drop":
		return "next on a drop"
	var b := ceili(float(int(entry.bars) * Auto.BEATS_PER_BAR - st.beats) / Auto.BEATS_PER_BAR)
	return "next in %d bar%s" % [b, "" if b == 1 else "s"]


## The hold as a short text: "8 bars", "30 s", "until a drop".
static func hold_text(e: Dictionary) -> String:
	match str(e.hold):
		"seconds":
			return "%d s" % roundi(e.seconds)
		"drop":
			return "until a drop"
	return "%d bar%s" % [e.bars, "" if int(e.bars) == 1 else "s"]
