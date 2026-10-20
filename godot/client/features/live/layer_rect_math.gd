extends RefCounted
## WO-621 N2 — a look layer's geometry in canvas pixels, as the web inspector edits it (inspector-scene-layer.js
## patchFillPx, inspector-fill.js syncGeometryInputsFromLayer / patchFillAlign over lib/fill-math.js, lib/layer-crop.js
## and lib/coordinate-origin.js). The boxes show the VISIBLE (cropped) rect (WO-388B); the stored `fill` stays the
## uncropped, channel-normalised MIXER FILL {x, y, scaleX, scaleY}. Golden: tests/golden/live_layer_rect.json.

const C := preload("res://features/live/compose_math.gd")
const P := preload("res://features/live/px_rect_math.gd")
const FULL := {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}


## cropFromLayer: the layer's crop effect, normalised, or null when absent / identity.
static func crop_of(layer: Dictionary) -> Variant:
	var fx: Array = layer.get("effects", []) if layer.get("effects") is Array else []
	for f in fx:
		if f is Dictionary and f.get("type") == "crop":
			var c := C.normalize_crop(f.get("params"))
			return null if C.is_identity_crop(c) else c
	return null


static func fill_of(layer: Dictionary) -> Dictionary:
	return layer.fill if layer.get("fill") is Dictionary else FULL


static func fill_to_px(f: Dictionary, canvas: Vector2) -> Dictionary:
	return {"x": float(f.x) * canvas.x, "y": float(f.y) * canvas.y, "w": float(f.scaleX) * canvas.x, "h": float(f.scaleY) * canvas.y}


static func px_to_fill(r: Dictionary, canvas: Vector2) -> Dictionary:
	return {"x": float(r.x) / canvas.x, "y": float(r.y) / canvas.y, "scaleX": float(r.w) / canvas.x, "scaleY": float(r.h) / canvas.y}


## cropAdjustedRect.
static func visible_rect(r: Dictionary, crop: Variant) -> Dictionary:
	if crop == null:
		return {"x": r.x, "y": r.y, "w": r.w, "h": r.h}
	return {"x": r.x + crop.left * r.w, "y": r.y + crop.top * r.h, "w": (crop.right - crop.left) * r.w, "h": (crop.bottom - crop.top) * r.h}


## layerRectFromVisibleRect (a collapsed crop is floored at 1e-6, never a division by zero).
static func layer_rect_from_visible(v: Dictionary, crop: Variant) -> Dictionary:
	if crop == null:
		return {"x": v.x, "y": v.y, "w": v.w, "h": v.h}
	var w: float = v.w / maxf(1e-6, crop.right - crop.left)
	var h: float = v.h / maxf(1e-6, crop.bottom - crop.top)
	return {"x": v.x - crop.left * w, "y": v.y - crop.top * h, "w": w, "h": h}


static func visible_px(layer: Dictionary, canvas: Vector2) -> Dictionary:
	return visible_rect(fill_to_px(fill_of(layer), canvas), crop_of(layer))


## What the X / Y / Width / Height boxes show (rounded like the web; centre offsets with coordinateOrigin "center").
static func display(layer: Dictionary, canvas: Vector2, center: bool) -> Dictionary:
	var d := P.display_from_stored(visible_px(layer, canvas), canvas, center)
	return {"x": P._jsround(d.x), "y": P._jsround(d.y), "w": maxf(1.0, P._jsround(d.w)), "h": maxf(1.0, P._jsround(d.h))}


## The ratio a locked edit keeps: the content's own, else `sticky` (the web holds the first ratio for 500 ms so
## stepping a box does not drift with rounding), else the visible rect's, else 16:9. 0 = unlocked.
static func lock_ratio(layer: Dictionary, canvas: Vector2, content: Vector2, sticky: float) -> float:
	if layer.get("aspectLocked") == false:
		return 0.0
	if content.x > 0 and content.y > 0:
		return content.x / content.y
	if sticky > 0:
		return sticky
	var r := visible_px(layer, canvas)
	return r.w / r.h if r.w > 0 and r.h > 0 else 16.0 / 9.0


## patchFillPx: a partial {x?, y?, w?, h?} in display px → the new stored fill. `ar` from lock_ratio (0 = unlocked).
static func patch_fill(layer: Dictionary, partial: Dictionary, canvas: Vector2, center: bool, ar: float) -> Dictionary:
	var next := P.apply_patch(visible_px(layer, canvas), partial, canvas, center, ar > 0, ar)
	return px_to_fill(layer_rect_from_visible(next, crop_of(layer)), canvas)


## alignFillForCrop: seat the visible rect on a canvas edge / centre (fill space, x / y only).
static func align_fill(layer: Dictionary, mode: String) -> Dictionary:
	var f := fill_of(layer)
	var crop: Variant = crop_of(layer)
	var c: Dictionary = crop if crop != null else {"left": 0.0, "top": 0.0, "right": 1.0, "bottom": 1.0}
	var sx := float(f.get("scaleX", 0))
	var sy := float(f.get("scaleY", 0))
	var off_x: float = c.left * sx
	var off_y: float = c.top * sy
	var vis_w: float = (c.right - c.left) * sx
	var vis_h: float = (c.bottom - c.top) * sy
	var vx := float(f.get("x", 0)) + off_x
	var vy := float(f.get("y", 0)) + off_y
	match mode:
		"left": vx = 0.0
		"right": vx = 1.0 - vis_w
		"top": vy = 0.0
		"bottom": vy = 1.0 - vis_h
		"center-h": vx = (1.0 - vis_w) / 2.0
		"center-v": vy = (1.0 - vis_h) / 2.0
		"center":
			vx = (1.0 - vis_w) / 2.0
			vy = (1.0 - vis_h) / 2.0
	return {"x": vx - off_x, "y": vy - off_y, "scaleX": sx, "scaleY": sy}
