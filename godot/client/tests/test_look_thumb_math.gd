extends RefCounted
## WO-608 R5 look-card thumbnails — URL choice (web lib/thumbnail-url.js deckIdleMode) and image placement
## (preview-canvas-draw-stacks.js deckThumbnailMode: fill rect, crop clip, contain / cover / stretch).

const TM := preload("res://features/live/look_thumb_math.gd")
const SIZE := Vector2(480, 270)
var t


func _near(a: Rect2, b: Rect2, what: String) -> void:
	t.ok(a.position.distance_to(b.position) < 0.05 and a.size.distance_to(b.size) < 0.05, "%s: %s ≈ %s" % [what, a, b])


func test_thumb_path() -> void:
	var cm := {"decklinkInputChannels": [7], "inputChannels": [{"kind": "decklink", "channel": 8}]}
	t.eq(TM.thumb_path({"type": "media", "value": "PROJECTS/A B"}, cm), "/api/thumbnail/PROJECTS%2FA%20B?hq=1&w=960&t=0", "media → file thumbnail")
	t.eq(TM.thumb_path({"type": "route", "value": "route://9-1", "routeType": "decklink"}, cm), "/api/thumbnail/live/9", "routeType decklink")
	t.eq(TM.thumb_path({"type": "route", "value": "route://7"}, cm), "/api/thumbnail/live/7", "decklinkInputChannels")
	t.eq(TM.thumb_path({"type": "live", "value": "x", "thumbnailChannel": 8}, cm), "/api/thumbnail/live/8", "inputChannels kind decklink")
	t.eq(TM.thumb_path({"type": "route", "value": "route://1"}, cm), "", "WO-63: a program bus never gets a PRINT still")
	t.eq(TM.thumb_path({"type": "template", "value": "lower_third"}, cm), "", "templates draw a label")
	t.eq(TM.thumb_path({"type": "media", "value": "X", "isPlaceholder": true}, cm), "", "placeholder")
	t.eq(TM.thumb_path(null, cm), "", "no source")


func test_sorted_layers() -> void:
	var look := {"layers": [{"layerNumber": 12}, {"layerNumber": 10}, "junk", {"layerNumber": 11}]}
	t.eq(TM.sorted_layers(look).map(func(l: Dictionary) -> int: return l.layerNumber), [10, 11, 12], "bottom → top by layerNumber")


func test_contain() -> void:
	var full := {"fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}}
	var a := TM.placement(full, SIZE, Vector2(960, 540))
	_near(a.dst, Rect2(0, 0, 480, 270), "same aspect fills")
	_near(a.src, Rect2(0, 0, 960, 540), "whole image")
	a = TM.placement(full, SIZE, Vector2(100, 100))
	_near(a.dst, Rect2(105, 0, 270, 270), "square pillarboxed")
	t.eq(TM.placement(full, SIZE, Vector2.ZERO), {}, "no image → nothing")


func test_cover_and_stretch_crop() -> void:
	var cover := {"contentFit": "horizontal", "fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}}
	var a := TM.placement(cover, SIZE, Vector2(100, 100))
	_near(a.dst, Rect2(0, 0, 480, 270), "cover fills the box")
	_near(a.src, Rect2(0, 21.875, 100, 56.25), "centre band of the image")
	var st := {"aspectLocked": false, "fill": {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1},
		"effects": [{"type": "crop", "params": {"left": 0.5, "top": 0, "right": 1, "bottom": 1}}]}
	t.eq(TM.fit_mode(st), "stretch", "unlocked aspect stretches")
	a = TM.placement(st, SIZE, Vector2(960, 540))
	_near(a.dst, Rect2(240, 0, 240, 270), "clipped to the crop window")
	_near(a.src, Rect2(480, 0, 480, 540), "right half of the image")
	t.eq(TM.fit_mode({"source": {"value": "templates/shaders/x"}}), "stretch", "shader templates stretch")
	t.eq(TM.fit_mode({"contentFit": "fill-canvas"}), "contain", "fill-canvas contains")


func test_off_canvas_layer() -> void:
	# the "Background" look's L11 on the box: x −0.5, scale 2 × 1.244 (native 16:9 clip) — only the middle shows
	var l := {"contentFit": "native", "fill": {"x": -0.5, "y": -0.12222222222222222, "scaleX": 2, "scaleY": 1.2444444444444445}}
	var a := TM.placement(l, SIZE, Vector2(1920, 1080))
	_near(a.dst, Rect2(0, 0, 480, 270), "clipped to the card")
	var k := 1920.0 / (336.0 * 16.0 / 9.0)
	_near(a.src, Rect2((240 - (960 - 597.3333) / 2.0) * k, 33 * k, 480 * k, 270 * k), "matching crop of the image")
	t.eq(TM.placement({"fill": {"x": 2, "y": 0, "scaleX": 1, "scaleY": 1}}, SIZE, Vector2(10, 10)), {}, "fully off the card")
