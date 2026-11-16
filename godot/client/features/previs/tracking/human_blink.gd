extends RefCounted
## WO-1103 — the shipped puppets blink (a face that never blinks reads as a mannequin at close range). Rocketbox heads
## have lid bones (Bip01 L/R EyeBlinkTop / Bottom, children of the head, no clip moves them): a blink swings the top
## lid down round the eyeball's centre (the L/R Eye bone) across the body's left–right axis, and the bottom lid a
## little up, every SPACING seconds (random), CLOSE + HOLD + OPEN long. Bodies without those bones do not blink.

const SPACING := Vector2(2.2, 6.0)  # s between blinks
const CLOSE := 0.07
const HOLD := 0.04
const OPEN := 0.13
const TOP := 0.95  # rad the top lid swings down
const BOTTOM := 0.2

var _lids := []  # [{bone, rest: Transform3D, pivot: Vector3, axis: Vector3, ang: float}]
var _sk: Skeleton3D
var _next := 1.0
var _t := -1.0  # seconds into the blink (< 0 between blinks)
var hold := -1.0  # ≥ 0: hold the lids at this closure (probes)
var _rng := RandomNumberGenerator.new()


func setup(sk: Skeleton3D) -> bool:
	_sk = sk
	_lids.clear()
	_rng.randomize()
	_next = _rng.randf_range(0.5, SPACING.y)
	for side in ["L", "R"]:
		var eye := sk.find_bone("Bip01 %sEye" % side)
		if eye < 0:
			continue
		for lid in [["Top", TOP], ["Bottom", -BOTTOM]]:  # + about the body's left (+X): the front of the eye goes down
			var b := sk.find_bone("Bip01 %sEyeBlink%s" % [side, lid[0]])
			if b < 0 or sk.get_bone_parent(b) != sk.get_bone_parent(eye):
				continue
			var parent := sk.get_bone_global_rest(sk.get_bone_parent(b))
			_lids.append({"bone": b, "rest": sk.get_bone_rest(b), "pivot": sk.get_bone_rest(eye).origin,
				"axis": (parent.basis.inverse() * Vector3.RIGHT).normalized(), "ang": float(lid[1])})
	return not _lids.is_empty()


## Lid closure now (0 open … 1 shut).
func closure() -> float:
	if hold >= 0.0:
		return hold
	if _t < 0.0:
		return 0.0
	if _t < CLOSE:
		return _t / CLOSE
	if _t < CLOSE + HOLD:
		return 1.0
	return clampf(1.0 - (_t - CLOSE - HOLD) / OPEN, 0.0, 1.0)


## Advance by `dt` and pose the lids (after the moves have posed the body).
func update(dt: float) -> void:
	if _lids.is_empty():
		return
	if _t >= 0.0:
		_t += dt
		if _t > CLOSE + HOLD + OPEN:
			_t = -1.0
			_next = _rng.randf_range(SPACING.x, SPACING.y)
	else:
		_next -= dt
		if _next <= 0.0:
			_t = 0.0
	var w := closure()
	for l in _lids:
		var r := Transform3D(Basis(l.axis, float(l.ang) * w), Vector3.ZERO)
		var p: Vector3 = l.pivot
		var tr := Transform3D(Basis.IDENTITY, p) * r * Transform3D(Basis.IDENTITY, -p) * (l.rest as Transform3D)
		_sk.set_bone_pose(int(l.bone), tr)
