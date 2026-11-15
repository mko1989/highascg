extends RefCounted
## WO-1086 — avatars ("pebble people"): the maths behind person_avatar.gd / person_avatars.gd. Pure.
##
## A tracked person's look arrives as a few palette colours from the sidecar (tools/tracking-detect/traits.py →
## detect-model traitsFrom → the WS snapshot's camera persons `traits` {top, bottom, skin, hair: [r, g, b],
## hair_len, locked}); person_cards_model.cards() lists them per world person as `looks` (best view first). No
## camera pixels ever reach the avatar; its face is the same simple drawing for everyone.

const PCM := preload("res://features/previs/tracking/person_cards_model.gd")
const C := preload("res://features/previs/tracking/camera_model.gd")

## Before the sidecar has a look (or for a camera that sends none): a neutral clay figure.
const NEUTRAL := {"top": Color(0.70, 0.73, 0.78), "bottom": Color(0.40, 0.43, 0.50), "skin": Color(0.87, 0.74, 0.63),
	"hair": Color(0.32, 0.25, 0.20), "hair_len": "short", "known": false}
const HAIR_LENS := ["short", "long", "bald"]
const WALK_MIN := 0.35  # m/s — slower is standing (no walk cycle, keep the last facing); ±10 cm box jitter stays under it
const WALK_FULL := 1.4  # m/s — full stride
const LEG_MAX_UP := -0.5  # a leg's direction (unit, body frame) keeps y ≤ this: a squat, never a leg in the air


## Traits (the wire dict, maybe partial) → the avatar's colours: missing keys stay NEUTRAL, shoes a darker bottom.
static func look(traits: Variant) -> Dictionary:
	var out := NEUTRAL.duplicate()
	if traits is Dictionary:
		for k in ["top", "bottom", "skin", "hair"]:
			var c: Variant = rgb((traits as Dictionary).get(k))
			if c != null:
				out[k] = c
				out.known = true
		if str((traits as Dictionary).get("hair_len", "")) in HAIR_LENS:
			out.hair_len = str(traits.hair_len)
	out["shoes"] = (out.bottom as Color).darkened(0.55)
	return out


## [r, g, b] 0–255 → Color, else null.
static func rgb(v: Variant) -> Variant:
	if not (v is Array) or (v as Array).size() != 3:
		return null
	for x in v:
		if not (x is float or x is int) or float(x) < 0.0 or float(x) > 255.0:
			return null
	return Color8(int(v[0]), int(v[1]), int(v[2]))


## Which camera's look a person wears. `looks` = [{key "cam:tid", traits}] best view first; `memo` {key} is this
## person's memory (updated). The shown key stays while it still has a look, unless it is still settling and another
## view's is locked; otherwise the first locked look, else the first. Keys the chosen look lacks are filled from the
## next views (one camera may not see the hair). → the merged traits, or null.
static func pick(looks: Array, memo: Dictionary) -> Variant:
	if looks.is_empty():
		return null
	var by_key := {}
	for l in looks:
		by_key[str(l.key)] = l.traits
	var cur := str(memo.get("key", ""))
	var first_locked := ""
	for l in looks:
		if (l.traits as Dictionary).get("locked") == true:
			first_locked = str(l.key)
			break
	if not by_key.has(cur) or (by_key[cur].get("locked") != true and first_locked != ""):
		cur = first_locked if first_locked != "" else str(looks[0].key)
	memo["key"] = cur
	var out: Dictionary = (by_key[cur] as Dictionary).duplicate()
	for l in looks:
		for k in ["top", "bottom", "skin", "hair", "hair_len"]:
			if not out.has(k) and (l.traits as Dictionary).has(k):
				out[k] = l.traits[k]
	return out


## Exponential smoothing factor for `rate` per second over `dt` (frame-rate independent).
static func blend(dt: float, rate: float) -> float:
	return 1.0 - exp(-rate * maxf(dt, 0.0))


## Godot yaw (the avatar's front is +Z) a person should face: their body facing when the pose says (WO-701
## person_cards_model.facing), else where they walk (PSN velocity m/s) once faster than WALK_MIN, else `last`.
static func yaw(joints: Variant, vel: Vector2, last: float) -> float:
	var f := PCM.facing(joints)
	if f == Vector2.ZERO and vel.length() >= WALK_MIN:
		f = vel.normalized()
	if f == Vector2.ZERO:
		return last
	return atan2(f.x, -f.y)  # PSN (x, y) → Godot (x, −y)


## Body joints → the limbs' directions in the avatar's own frame (front +Z, up +Y, the person's left +X), unit or
## absent: arm_l / arm_r shoulder → wrist (elbow when the wrist is not seen), leg_l / leg_r hip → ankle (knee).
## Legs never point up past LEG_MAX_UP.
static func limb_dirs(joints: Variant, yaw_rad: float) -> Dictionary:
	var out := {}
	if not (joints is Array) or (joints as Array).size() != 17:
		return out
	var inv := Basis(Vector3.UP, yaw_rad).inverse()
	for spec in [["arm_l", 5, [9, 7]], ["arm_r", 6, [10, 8]], ["leg_l", 11, [15, 13]], ["leg_r", 12, [16, 14]]]:
		var a: Variant = _joint(joints, spec[1])
		var b: Variant = null
		for j in spec[2]:
			b = _joint(joints, j)
			if b != null:
				break
		if a == null or b == null or (b - a).length() < 0.05:
			continue
		var d: Vector3 = (inv * (b - a)).normalized()
		if str(spec[0]).begins_with("leg") and d.y > LEG_MAX_UP:
			var flat := Vector2(d.x, d.z)
			if flat.length() < 1e-4:
				d = Vector3.DOWN
			else:
				flat = flat.normalized() * sqrt(1.0 - LEG_MAX_UP * LEG_MAX_UP)
				d = Vector3(flat.x, LEG_MAX_UP, flat.y)
		out[spec[0]] = d
	return out


static func _joint(joints: Array, i: int) -> Variant:
	var j: Variant = joints[i]
	if not (j is Array) or (j as Array).size() < 3:
		return null
	return C.psn_to_godot([float(j[0]), float(j[1]), float(j[2])])


## Walk cycle: the stride swing (radians, arms and legs opposite) at `phase` for a walking `speed` (m/s), and the
## body's bob (in body heights). Standing → 0.
static func stride(phase: float, speed: float) -> Vector2:
	var k := clampf((speed - WALK_MIN) / (WALK_FULL - WALK_MIN), 0.0, 1.0)
	return Vector2(sin(phase) * 0.5 * k, absf(sin(phase)) * 0.025 * k)


## The basis that turns a limb hanging straight down (−Y) to point along `dir` (unit, body frame).
static func hang_toward(dir: Vector3) -> Basis:
	var down := Vector3.DOWN
	var axis := down.cross(dir)
	if axis.length() < 1e-5:
		return Basis() if dir.dot(down) > 0.0 else Basis(Vector3.RIGHT, PI)
	return Basis(axis.normalized(), down.angle_to(dir))
