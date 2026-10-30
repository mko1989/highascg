extends Node3D
## WO-875 scene "Spectrum" (after GLava's radial module): the live spectrum as a mirrored ring of bars around a thin circle —
## bass at the bottom, treble at the top on both sides. Reads the stage's smoothed audio (row 0 of set_audio, already
## through spectrum_smooth.gd), bins mapped on a log scale 40 Hz–16 kHz; each bar mixes the average and the peak of its
## bins (GLava's hybrid sampling) and the top end is tilted up so the treble side is not flat.
## amount = how many bars, pulse = bar length, spin = rotation, speed = colour drift along the ring, hue / glow = colour and
## HDR brightness (the stage blooms it), burst = every bar jumps out and falls back.

const MAX_BARS := 160
const RADIUS := 3.0
const F_LO := 40.0
const F_HI := 16000.0
const HZ_PER_BIN := 48000.0 / 1024.0  # the node's FFT: 48 kHz, 1024 points (audio-capture-fft.js)
const FLOOR := 0.35  # dB bytes below this (≈ −75 dBFS) are the room, not the music
const TILT := 0.18
const HYBRID := 0.65  # weight of the average against the peak
const SPIN_MAX := 1.6

var _mm: MultiMeshInstance3D
var _ring: MeshInstance3D
var _ring_mat: StandardMaterial3D
var _freq := PackedByteArray()
var _angle := 0.0
var _drift := 0.0
var _kick := 0.0


func _init() -> void:  # built up front: the stage may step a scene before it enters the tree
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.vertex_color_use_as_albedo = true
	var bar := BoxMesh.new()
	bar.size = Vector3(1.0, 1.0, 0.12)
	bar.material = mat
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = bar
	mm.instance_count = MAX_BARS
	_mm = MultiMeshInstance3D.new()
	_mm.multimesh = mm
	add_child(_mm)
	_ring_mat = StandardMaterial3D.new()
	_ring_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var torus := TorusMesh.new()
	torus.inner_radius = RADIUS - 0.07
	torus.outer_radius = RADIUS
	torus.rings = 96
	torus.material = _ring_mat
	_ring = MeshInstance3D.new()
	_ring.mesh = torus
	_ring.rotation.x = PI / 2  # the torus lies in XZ; face the camera
	add_child(_ring)
	_freq.resize(512)


## The stage's audio (1024 bytes: smoothed FFT row, then the wave); anything else = silence.
func set_audio(bytes: PackedByteArray) -> void:
	_freq = bytes.slice(0, 512) if bytes.size() >= 512 else PackedByteArray()
	_freq.resize(512)


## 0..1 for the spectrum slice q0..q1 (0 = F_LO, 1 = F_HI on a log scale).
static func level(freq: PackedByteArray, q0: float, q1: float) -> float:
	var b0 := F_LO * pow(F_HI / F_LO, q0) / HZ_PER_BIN
	var b1 := F_LO * pow(F_HI / F_LO, q1) / HZ_PER_BIN
	var v := 0.0
	if b1 - b0 < 1.0:  # narrower than a bin (the bass): interpolate at the centre
		var c := clampf((b0 + b1) * 0.5, 0.0, 510.999)
		var i := floori(c)
		v = lerpf(freq[i], freq[i + 1], c - i)
	else:
		var s := 0.0
		var peak := 0.0
		var lo := clampi(floori(b0), 0, 511)
		var hi := clampi(ceili(b1), lo + 1, 512)
		for k in range(lo, hi):
			s += freq[k]
			peak = maxf(peak, freq[k])
		v = HYBRID * s / (hi - lo) + (1.0 - HYBRID) * peak
	return clampf((v / 255.0 - FLOOR) / (1.0 - FLOOR) + TILT * (q0 + q1) * 0.5, 0.0, 1.0)


func step(p: Dictionary, delta: float, burst: bool) -> void:
	var pulse := float(p.get("pulse", 0.2))
	var hue := float(p.get("hue", 0.55))
	var glow := float(p.get("glow", 0.3))
	if burst:
		_kick = 1.0
	_kick = maxf(0.0, _kick - delta * 2.5)
	_angle += delta * SPIN_MAX * float(p.get("spin", 0.15))
	_drift += delta * 0.4 * float(p.get("speed", 0.3))
	var n := 2 * roundi(lerpf(24.0, MAX_BARS / 2.0, clampf(float(p.get("amount", 0.5)), 0.0, 1.0)))
	var mm := _mm.multimesh
	mm.visible_instance_count = n
	var width := TAU * RADIUS / n * 0.62
	var energy := 0.5 + glow * 2.5
	var half := n / 2
	for i in n:
		var j := i if i < half else n - 1 - i  # mirrored: both halves run bass → treble
		var q0 := float(j) / half
		var v := level(_freq, q0, q0 + 1.0 / half)
		var length := 0.08 + pow(v, 1.6) * (1.5 + 6.0 * pulse) + _kick * 2.5
		var a := -PI / 2 + TAU * (i + 0.5) / n + _angle  # bar 0 sits at the bottom
		var out := Vector3(cos(a), sin(a), 0.0)
		var basis := Basis(Vector3.FORWARD, a - PI / 2).scaled(Vector3(width, length, 1.0))  # local +Y points outward
		mm.set_instance_transform(i, Transform3D(basis, out * (RADIUS + length * 0.5)))
		var c := Color.from_hsv(fposmod(hue + 0.22 * q0 + _drift, 1.0), 0.75, 1.0)
		mm.set_instance_color(i, c * (energy * (0.55 + 0.45 * v)))
	var rc := Color.from_hsv(fposmod(hue + _drift, 1.0), 0.5, 1.0)
	_ring_mat.albedo_color = rc * (0.6 + glow * 1.5)
