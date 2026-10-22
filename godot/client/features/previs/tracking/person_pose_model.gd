extends RefCounted
## WO-667 — the posed dummy (research step 3): a tracked person's 17 COCO joints (world `joints`, src/tracking/pose3d.js,
## PSN metres) → the body parts person_cards.gd draws, each a unit sphere (radius 0.5) stretched into an ellipsoid
## between two joints — the artist's-mannequin look, every part painted by the same projective material. Pure.

const C := preload("res://features/previs/tracking/camera_model.gd")

const NOSE := 0
const EYES := [1, 2]
const EARS := [3, 4]
const SH := [5, 6]
const EL := [7, 8]
const WR := [9, 10]
const HIP := [11, 12]
const KN := [13, 14]
const AN := [15, 16]
## [from, to, radius (m at a 1.75 m person)] — limbs; a missing joint drops its part.
const LIMBS := [
	[SH[0], EL[0], 0.05], [EL[0], WR[0], 0.042], [SH[1], EL[1], 0.05], [EL[1], WR[1], 0.042],
	[HIP[0], KN[0], 0.075], [KN[0], AN[0], 0.058], [HIP[1], KN[1], 0.075], [KN[1], AN[1], 0.058],
]
const HEAD_R := 0.105
const TORSO_DEPTH := 0.24
const REF_HEIGHT := 1.75


## Joints good enough for a posed body: both shoulders and both hips.
static func usable(joints: Variant) -> bool:
	if not (joints is Array) or (joints as Array).size() != 17:
		return false
	for j in SH + HIP:
		if not (joints[j] is Array):
			return false
	return true


## Joints (PSN) → [{name, xf: Transform3D}] for a unit sphere; [] when not usable. `height` scales part radii.
static func parts(joints: Array, height: float) -> Array:
	if not usable(joints):
		return []
	var g := []
	for p in joints:
		g.append(C.psn_to_godot(p) if p is Array else null)
	var k := clampf(height / REF_HEIGHT, 0.6, 1.4)
	var sh_mid: Vector3 = (g[SH[0]] + g[SH[1]]) / 2.0
	var hip_mid: Vector3 = (g[HIP[0]] + g[HIP[1]]) / 2.0
	var across: Vector3 = (g[SH[1]] - g[SH[0]]) + (g[HIP[1]] - g[HIP[0]])  # the body's left→right
	var out := []
	var sw := maxf((g[SH[1]] - g[SH[0]]).length(), 0.25 * k)
	out.append({"name": "torso", "xf": segment(hip_mid, sh_mid + (sh_mid - hip_mid) * 0.08, sw * 1.05, TORSO_DEPTH * k, across)})
	var head := _head(g, sh_mid, hip_mid)
	out.append({"name": "neck", "xf": segment(sh_mid, head, 0.09 * k, 0.09 * k, across)})
	out.append({"name": "head", "xf": Transform3D(Basis.from_scale(Vector3.ONE * 2.0 * HEAD_R * k), head)})
	for l in LIMBS:
		if g[l[0]] != null and g[l[1]] != null:
			var r: float = l[2] * k * 2.0
			out.append({"name": "limb%d_%d" % [l[0], l[1]], "xf": segment(g[l[0]], g[l[1]], r, r, across)})
	return out


## The head's centre: the mean of the face points seen (nose, eyes, ears), else above the shoulders.
static func _head(g: Array, sh_mid: Vector3, hip_mid: Vector3) -> Vector3:
	var sum := Vector3.ZERO
	var n := 0
	for j in [NOSE] + EYES + EARS:
		if g[j] != null:
			sum += g[j]
			n += 1
	if n > 0:
		return sum / n
	return sh_mid + (sh_mid - hip_mid).normalized() * 0.25


## A unit sphere stretched from a to b (overlapping each end by half its width), `width` across along `side`, `depth`
## front-to-back.
static func segment(a: Vector3, b: Vector3, width: float, depth: float, side: Vector3) -> Transform3D:
	var axis := b - a
	var length := axis.length()
	var y := axis / length if length > 1e-5 else Vector3.UP
	var x := side - y * side.dot(y)
	if x.length_squared() < 1e-8:
		x = Vector3.RIGHT - y * y.x
	x = x.normalized()
	var z := x.cross(y)
	return Transform3D(Basis(x * width, y * (length + width * 0.5), z * depth), (a + b) / 2.0)
