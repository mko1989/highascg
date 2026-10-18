extends RefCounted
## WO-601 — golden values from running audio-volume-scale.js + media-ext.js under node (2026-10-18).

const X := preload("res://features/live/mixer_math.gd")
var t

func test_fader_to_gain_golden() -> void:
	for c in [[0, 0], [1, 0.0010864238225116194], [10, 0.002290829674434661], [16.667, 0.003981071705534973], [25, 0.015848931924611134], [33.333, 0.06309573444801933], [50, 0.251188643150958], [60, 0.38018624489028], [66.667, 0.5011872336272722], [75, 0.7079457843841379], [83.333, 1], [90, 1.3182676658170853], [100, 1.9952623149688795], [120, 1.9952623149688795], [-5, 0]]:
		t.ok(absf(X.fader_to_gain(float(c[0])) - float(c[1])) < 1e-12, "fader %s%% → %s" % [c[0], c[1]])


func test_gain_to_fader_and_db_text_golden() -> void:
	var cases := [[0, 0, "−∞"], [0.001, 0, "−∞"], [0.0316, 29, "-30.0 dB"], [0.1, 39, "-20.0 dB"], [0.25, 50, "-12.0 dB"], [0.5, 67, "-6.0 dB"], [0.501, 67, "-6.0 dB"], [1, 83, "0.0 dB"], [1.5, 93, "+3.5 dB"], [1.995, 100, "+6.0 dB"], [3, 100, "+6.0 dB"], [-1, 0, "−∞"]]
	for c in cases:
		t.eq(X.gain_to_fader(float(c[0])), int(c[1]), "gain %s → fader" % c[0])
		t.eq(X.format_db(float(c[0])), c[2], "gain %s → text" % c[0])


func test_loop_support_golden() -> void:
	for c in [["CLIPS/A", "media", true], ["a.mov", "media", true], ["logo.png", "media", false], ["x.wav", "media", true], ["route://1", "media", false], ["t.html", "template", false], ["", "media", false], ["TL", "timeline", true], ["f.xyz", "file", true], ["f.xyz", "html", false]]:
		t.eq(X.supports_loop(c[0], c[1]), c[2], "%s (%s)" % [c[0], c[1]])
