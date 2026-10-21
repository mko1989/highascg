extends RefCounted
## WO-653 — the look editor draws what Caspar shows (port of scene-native-fill.js calcMixerFill).

const F := preload("res://features/live/layer_fit_math.gd")
var t

const CANVAS := Vector2(3072, 1024)
const CLIP := Vector2(2560, 1024)


static func _layer(fit: String, locked := true, src := {"type": "media", "value": "a.mov"}) -> Dictionary:
	return {"contentFit": fit, "aspectLocked": locked, "source": src,
		"fill": {"x": 0.2554744382699331, "y": 0.2562854878328465, "scaleX": 0.8394160469373065, "scaleY": 0.5969180778220847}}


static func _px(f: Dictionary) -> Vector2:
	return Vector2(float(f.scaleX) * CANVAS.x, float(f.scaleY) * CANVAS.y)


func test_box_case_native_clip_fits_inside_the_fill() -> void:
	# The owner's layer (21.10): fill 2579×611 on a 3072×1024 canvas, a 2560×1024 clip. Caspar showed ~1528×611.
	var f := F.shown_fill(_layer("native"), CLIP, CANVAS)
	t.ok(absf(_px(f).x - 611.25 * 2.5) < 1.0 and absf(_px(f).y - 611.25) < 1.0, "contain-fit at the clip aspect: %s" % _px(f))
	t.eq(f.x, _layer("native").fill.x, "anchored top-left like the server (x kept)")
	t.eq(f.y, _layer("native").fill.y, "y kept")


func test_modes() -> void:
	t.eq(F.shown_fill(_layer("native", false), CLIP, CANVAS), _layer("native").fill, "aspect unlocked → stretch → raw")
	t.eq(F.shown_fill(_layer("stretch"), CLIP, CANVAS), _layer("native").fill, "stretch → raw")
	var h := _px(F.shown_fill(_layer("horizontal"), CLIP, CANVAS))
	t.ok(absf(h.x - 2578.75) < 1.0 and absf(h.y - 2578.75 / 2.5) < 1.0, "fill-h: full width, clip aspect")
	var v := _px(F.shown_fill(_layer("vertical"), CLIP, CANVAS))
	t.ok(absf(v.y - 611.25) < 1.0 and absf(v.x - 611.25 * 2.5) < 1.0, "fill-v: full height, clip aspect")
	t.eq(F.shown_fill(_layer("native"), Vector2.ZERO, CANVAS), _layer("native").fill, "native, clip size unknown → raw (server)")
	var fit := _px(F.shown_fill(_layer("fill-canvas"), Vector2.ZERO, CANVAS))
	t.ok(absf(fit.x / fit.y - 16.0 / 9.0) < 1e-3, "fit, size unknown → 16:9 inside the fill (server)")


func test_sources_the_server_never_refits() -> void:
	for src in [{"type": "route", "value": "route://5-2"}, {"type": "template", "value": "lt"}, {"type": "media", "value": "route://3"}]:
		t.eq(F.shown_fill(_layer("native", true, src), CLIP, CANVAS), _layer("native").fill, "raw for %s" % src)
