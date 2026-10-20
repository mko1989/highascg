extends RefCounted
## WO-621 N2 — layer_rect_math.gd against the web look-layer inspector run under Node over the real client/lib
## modules (fill-math, layer-crop, coordinate-origin): tests/golden/live_layer_rect.json. 28 layer / canvas / origin
## cases: the displayed X/Y/W/H, 28 patches each (x / y / w / h / pairs / all × content ratio none / 16:9 / 9:16 ×
## the 500 ms sticky ratio) and the seven crop-aware aligns.

const LR := preload("res://features/live/layer_rect_math.gd")
var t


static func _near(a: Dictionary, b: Dictionary) -> bool:
	for k in b:
		if not a.has(k) or absf(float(a[k]) - float(b[k])) > 1e-9 * maxf(1.0, absf(float(b[k]))):
			return false
	return a.size() == b.size()


func test_golden() -> void:
	var g: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/live_layer_rect.json"))
	for c in g.cases:
		var cv := Vector2(float(c.canvas.width), float(c.canvas.height))
		var layer: Dictionary = c.layer
		t.eq(LR.display(layer, cv, c.center), _f(c.display), c.name + ": display")
		for p in c.patches:
			var cr: Variant = p.content
			var content := Vector2(float(cr.w), float(cr.h)) if cr is Dictionary else Vector2.ZERO
			var sticky := float(p.sticky) if p.sticky != null else 0.0
			var ar := LR.lock_ratio(layer, cv, content, sticky)
			var what := "%s: %s content %s sticky %s" % [c.name, JSON.stringify(p.partial), JSON.stringify(cr), JSON.stringify(p.sticky)]
			t.eq(ar, float(p.out.ar) if p.out.ar != null else 0.0, what + ": ratio")
			var got := LR.patch_fill(layer, p.partial, cv, c.center, ar)
			t.ok(_near(got, p.out.fill), what + ": fill %s ≠ %s" % [got, p.out.fill])
		for m in c.aligns:
			var got := LR.align_fill(layer, m)
			t.ok(_near(got, c.aligns[m]), "%s: align %s %s ≠ %s" % [c.name, m, got, c.aligns[m]])


static func _f(d: Dictionary) -> Dictionary:
	var o := {}
	for k in d:
		o[k] = float(d[k])
	return o
