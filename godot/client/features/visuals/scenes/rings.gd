extends Node3D
## WO-873 scene "Rings" (the WO-863 visual): three counter-rotating rings of emissive bars around the camera axis.
## pulse = bar length, spin = rotation, speed = the bars' wave rate, amount = how many bars are lit, hue / glow = colour and bloom,
## burst = every bar jumps to full length and falls back.

const RINGS := [[24, 3.0], [36, 5.0], [48, 7.5]]  # [bars, radius]
const SPIN_MAX := 1.6  # rad/s at spin 1

var _mm: Array[MultiMeshInstance3D] = []
var _mat: StandardMaterial3D
var _angle := 0.0
var _t := 0.0
var _kick := 0.0


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	_mat = StandardMaterial3D.new()
	_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat.emission_enabled = true
	var bar := BoxMesh.new()
	bar.size = Vector3(0.18, 1.0, 0.18)
	bar.material = _mat
	for r in RINGS:
		var mmi := MultiMeshInstance3D.new()
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = bar
		mm.instance_count = r[0]
		mmi.multimesh = mm
		add_child(mmi)
		_mm.append(mmi)


func step(p: Dictionary, delta: float, burst: bool) -> void:
	var pulse := float(p.get("pulse", 0.2))
	var hue := float(p.get("hue", 0.55))
	var glow := float(p.get("glow", 0.3))
	if burst:
		_kick = 1.0
	_kick = maxf(0.0, _kick - delta * 3.0)
	_t += delta * (0.5 + 3.0 * float(p.get("speed", 0.3)))
	_angle += delta * SPIN_MAX * float(p.get("spin", 0.15))
	var lit := clampf(float(p.get("amount", 1.0)) * 2.0, 0.1, 1.0)  # amount 0.5 and up = every bar
	for i in _mm.size():
		var mm := _mm[i].multimesh
		var n: int = RINGS[i][0]
		var radius: float = RINGS[i][1]
		var dir := 1.0 if i % 2 == 0 else -1.0
		mm.visible_instance_count = maxi(1, roundi(n * lit))
		for k in n:
			var a := TAU * k / n + _angle * dir * (1.0 + i * 0.35)
			var wave := 0.5 + 0.5 * sin(_t * 2.0 + k * 0.7 + i)
			var length := 0.4 + maxf(pulse, _kick) * (2.5 + i) * (0.6 + 0.4 * wave)
			var basis := Basis(Vector3.FORWARD, a).scaled(Vector3(1, length, 1))
			mm.set_instance_transform(k, Transform3D(basis, Vector3(cos(a + PI / 2), sin(a + PI / 2), -i * 1.5) * radius))
	var c := Color.from_hsv(hue, 0.75, 1.0)
	_mat.albedo_color = c
	_mat.emission = c
	_mat.emission_energy_multiplier = 0.5 + glow * 3.0
