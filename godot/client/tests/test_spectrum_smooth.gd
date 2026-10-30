extends RefCounted
## WO-875 spectrum smoothing, GDScript twin of template/shaders/player-smooth.js: off = raw, gravity, spread, the frame
## window, and the parity golden the Node smoke (tools/smoke/smoke-wo875-spectrum-smooth.test.js) pins to the same bytes.

const Smooth := preload("res://features/visuals/spectrum_smooth.gd")
const OFF := {"fall": 0, "frames": 1, "spread": 0}
var t


static func _frame(v: int) -> PackedByteArray:
	var a := PackedByteArray()
	a.resize(512)
	a.fill(v)
	return a


static func _parity(f: int) -> PackedByteArray:
	var a := PackedByteArray()
	a.resize(512)
	for k in 512:
		a[k] = (k * 37 + f * 101 + ((k * k) % 23) * 5) % 256
	return a


func test_off_is_raw() -> void:
	var sm := Smooth.new()
	for f in 5:
		t.eq(sm.step(_parity(f), 1.0 / 60.0, OFF), _parity(f), "frame %d passes through" % f)


func test_gravity() -> void:
	var sm := Smooth.new()
	var p := {"fall": 200, "frames": 1, "spread": 0}
	t.eq(sm.step(_frame(200), 0.1, p)[10], 200, "rises at once")
	t.eq(sm.step(_frame(0), 0.1, p)[10], 180, "falls 200/s")
	t.eq(sm.step(_frame(0), 5.0, p)[10], 160, "a stall counts as 0.1 s")
	t.eq(sm.step(_frame(250), 0.1, p)[10], 250, "a new peak lands immediately")
	t.eq(sm.step(_frame(0), 0.05, {"fall": 0, "frames": 1, "spread": 0})[10], 0, "fall 0 = no gravity")


func test_spread() -> void:
	var sm := Smooth.new()
	var raw := _frame(0)
	raw[40] = 255
	raw[300] = 130
	var out := sm.step(raw, 0.0, {"fall": 0, "frames": 1, "spread": 0.02})
	t.eq([out[40], out[41], out[300], out[306], out[310]], [255, 0, 10, 10, 0], "bass untouched, bin 300 averages ±6")


func test_frames() -> void:
	t.eq(snappedf(Smooth.weight(0, 3), 0.01), 0.4, "shallow window edge")
	t.eq(Smooth.weight(1, 3), 1.0, "window middle")
	var sm := Smooth.new()
	var p := {"fall": 0, "frames": 3, "spread": 0}
	for i in 3:
		sm.step(_frame(0), 1.0 / 60.0, p)
	var got := []
	for i in 3:
		got.append(sm.step(_frame(100), 1.0 / 60.0, p)[5])
	t.eq(got, [22, 78, 100], "a step through the 0.4/1/0.4 window")


func test_params() -> void:
	t.eq(Smooth.params(null), Smooth.DEFAULTS, "defaults")
	t.eq(Smooth.params({"fall": -5, "frames": 99, "spread": 1}), {"fall": 0.0, "frames": 8, "spread": 0.25}, "clamped")
	t.eq(Smooth.params({"fall": "x"}).fall, 200.0, "junk → default")


func test_parity_with_player_smooth_js() -> void:
	var sm := Smooth.new()
	var out := PackedByteArray()
	for f in 8:
		out = sm.step(_parity(f), 1.0 / 60.0, Smooth.DEFAULTS)
	t.eq([0, 7, 49, 50, 200, 333, 511].map(func(k: int) -> int: return out[k]), [246, 209, 207, 195, 130, 142, 169],
		"the same bytes as player-smooth.js")


func test_stage_smooths_and_stale_feed_falls() -> void:
	var stage: Node3D = preload("res://features/visuals/visuals_stage.gd").new()
	stage._ready()  # not in a tree under the runner
	stage.set_layers("spectrum", "shader")
	var loud := _frame(255)
	stage.audio_frame({"freq": Marshalls.raw_to_base64(loud), "wave": Marshalls.raw_to_base64(_frame(128)),
		"smooth": {"fall": 200, "frames": 1, "spread": 0}})
	stage._process(0.05)
	var spec: Node3D = stage.layers[0]
	t.eq(spec._freq[100], 255, "the spectrum scene gets the smoothed row")
	stage._audio_at = -100000  # the feed went stale
	stage._process(0.05)
	t.eq(spec._freq[100], 245, "a stale feed falls away under gravity (200/s × 0.05 s), not to zero at once")
	t.eq(stage.layers[1].overlay, true, "the shader scene rides along as layer 2")
	stage.free()


func test_spectrum_levels() -> void:
	const Spec := preload("res://features/visuals/scenes/spectrum.gd")
	t.eq(Spec.level(_frame(0), 0.0, 0.05), 0.0, "silence → no bar")
	t.eq(Spec.level(_frame(255), 0.5, 0.55), 1.0, "full scale → full bar")
	var bass := _frame(0)
	bass[1] = 255  # 47 Hz
	t.ok(Spec.level(bass, 0.0, 0.02) > 0.5, "the lowest bar reads the 40–60 Hz bins")
	t.eq(Spec.level(bass, 0.6, 0.62), 0.0, "a high bar ignores the bass")
	t.ok(Spec.level(_frame(150), 0.9, 0.95) > Spec.level(_frame(150), 0.1, 0.15) + 0.1, "the treble is tilted up")
