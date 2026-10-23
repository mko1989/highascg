extends RefCounted
## WO-710 — pure logic of the Auto tracking overlay (Live + Previs main). Input = the `tracking:auto` body
## (GET /api/tracking/auto, WO-708/709):
##   { pool:[fixture ids], persons:[{key, slot, name?, heads:[ids], lost}], slots:[{slot, key, heads, ptz:[cam ids]}],
##     home:{active, after_s, idle_s, forced}, ptz:[{id, name, enabled}] }
## NOTE: Godot's JSON turns every number into float — ids are compared through id_key(), counts cast with int().

const SLOTS := 9
const AFTER_MIN := 3
const AFTER_MAX := 600
const AFTER_STEP := 5


## "3.0" and 3 are the same id; strings stay as they are.
static func id_key(v: Variant) -> String:
	if v is float and is_equal_approx(v, roundf(v)):
		return str(int(v))
	return str(v)


## The overlay shows when the server reports people or a pool of Auto heads.
static func has_content(data: Variant) -> bool:
	if not data is Dictionary:
		return false
	var d: Dictionary = data
	return not _arr(d.get("persons")).is_empty() or not _arr(d.get("pool")).is_empty()


static func pool_size(data: Dictionary) -> int:
	return _arr(data.get("pool")).size()


## "w:3" → "w3", "cam_1:7" → "c1.7" (short enough for a row, still unique).
static func short_key(key: String) -> String:
	if key.begins_with("cam_"):
		return "c" + key.substr(4).replace(":", ".")
	return key.replace(":", "")


## The presenter's name, else "Person ‹key short›".
static func label(person: Dictionary) -> String:
	var n := str(person.get("name", "")).strip_edges()
	if n != "":
		return n
	return "Person " + short_key(str(person.get("key", "?")))


static func slot_of(data: Dictionary, slot: int) -> Dictionary:
	for s in _arr(data.get("slots")):
		if s is Dictionary and int(s.get("slot", 0)) == slot:
			return s
	return {}


## One row per detected person: { key, label, slot, pinned, following (heads now on them), count (the slot's
## head setting, 0 = share), ptz (cam id keys on the slot), lost }.
static func rows(data: Variant) -> Array:
	var out: Array = []
	if not data is Dictionary:
		return out
	for p in _arr((data as Dictionary).get("persons")):
		if not p is Dictionary:
			continue
		var slot := clampi(int(p.get("slot", 0)), 0, SLOTS)
		var s := slot_of(data, slot) if slot > 0 else {}
		var cams: Array = []
		for c in _arr(s.get("ptz")):
			cams.append(id_key(c))
		out.append({
			"key": str(p.get("key", "")),
			"label": label(p),
			"slot": slot,
			"pinned": slot > 0,
			"following": _arr(p.get("heads")).size(),
			"count": maxi(int(s.get("heads", 0)), 0),
			"ptz": cams,
			"lost": p.get("lost") == true,
		})
	return out


## Enabled PTZ cameras: [{ id (as the server sent it), key, name }].
static func ptz_cams(data: Variant) -> Array:
	var out: Array = []
	if not data is Dictionary:
		return out
	for c in _arr((data as Dictionary).get("ptz")):
		if c is Dictionary and c.get("enabled") != false and c.has("id"):
			var nm := str(c.get("name", "")).strip_edges()
			out.append({"id": c.id, "key": id_key(c.id), "name": nm if nm != "" else "Cam " + id_key(c.id)})
	return out


## Rows are rebuilt only when this changes (the person set, or the PTZ chips on offer); labels, counts and pin
## states are updated in place so a 5 Hz broadcast never flickers.
static func signature(data: Variant) -> String:
	var keys: Array = []
	for r in rows(data):
		keys.append(r.key)
	var cams: Array = []
	for c in ptz_cams(data):
		cams.append("%s=%s" % [c.key, c.name])
	return "%s|%s" % [",".join(keys), ",".join(cams)]


## "share" for 0, else the number.
static func count_text(n: int) -> String:
	return "share" if n <= 0 else str(n)


## Stepper: share(0) → 1 → … → pool size; "−" from 1 returns to share. Clamped to the pool.
static func step_count(n: int, dir: int, pool: int) -> int:
	return clampi(n + dir, 0, maxi(pool, 0))


## Clicking the active pin again unpins (slot 0).
static func pin_target(current: int, clicked: int) -> int:
	return 0 if clicked == current else clampi(clicked, 1, SLOTS)


## Toggle one PTZ camera on a slot's list (originals kept, compared by id_key); returns the new list.
static func toggle_ptz(ids: Array, cam: Variant) -> Array:
	var out: Array = []
	var found := false
	for i in ids:
		if id_key(i) == id_key(cam):
			found = true
		else:
			out.append(i)
	if not found:
		out.append(cam)
	return out


## Footer status: "home" while active (manual: "home · manual"), "home in Ns" while counting down, "" otherwise.
static func home_text(home: Variant) -> String:
	if not home is Dictionary:
		return ""
	var h: Dictionary = home
	if h.get("active") == true:
		return "home · manual" if h.get("forced") == true else "home"
	var idle := float(h.get("idle_s", 0.0))
	if idle <= 0.0:
		return ""
	return "home in %ds" % maxi(int(ceilf(float(h.get("after_s", 0.0)) - idle)), 0)


## The after_s stepper (3…600, steps of 5).
static func step_after(n: float, dir: int) -> int:
	return clampi(int(roundf(n)) + dir * AFTER_STEP, AFTER_MIN, AFTER_MAX)


static func _arr(v: Variant) -> Array:
	return v if v is Array else []
