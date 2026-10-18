extends RefCounted
## Layer / clip pixel rect on the program canvas, as the inspectors edit it — 1:1 with web lib/coordinate-origin.js
## (displayPositionFromStoredPx / storedPxFromDisplayPosition / applyFillPxPatch / alignStoredPxRect) and the aspect
## lock of inspector-panel-timeline-clip.js applyFillPx. Stored data is always the top-left rect; with settings
## editorDefaults.coordinateOrigin = "center" the X/Y fields show the layer centre's offset from the canvas centre.

const ALIGN_MODES := ["left", "right", "top", "bottom", "center-h", "center-v", "center"]
const ALIGN_TITLES := {"left": "Align left", "right": "Align right", "top": "Align top", "bottom": "Align bottom",
	"center-h": "Center horizontally", "center-v": "Center vertically", "center": "Center on canvas"}


static func display_from_stored(r: Dictionary, canvas: Vector2, center: bool) -> Dictionary:
	if not center:
		return {"x": float(r.x), "y": float(r.y), "w": float(r.w), "h": float(r.h)}
	return {"x": float(r.x) + float(r.w) / 2.0 - canvas.x / 2.0, "y": float(r.y) + float(r.h) / 2.0 - canvas.y / 2.0,
		"w": float(r.w), "h": float(r.h)}


static func stored_from_display(d: Dictionary, canvas: Vector2, center: bool) -> Dictionary:
	if not center:
		return {"x": float(d.x), "y": float(d.y), "w": float(d.w), "h": float(d.h)}
	return {"x": float(d.x) + canvas.x / 2.0 - float(d.w) / 2.0, "y": float(d.y) + canvas.y / 2.0 - float(d.h) / 2.0,
		"w": float(d.w), "h": float(d.h)}


## applyFillPxPatch + the clip inspector's aspect lock: a lone W (or H) edit drives the other side by `ar`.
## `partial` x/y are display coordinates (centre offsets in centre mode).
static func apply_patch(stored: Dictionary, partial: Dictionary, canvas: Vector2, center: bool, locked: bool, ar: float) -> Dictionary:
	var next := {"x": float(stored.x), "y": float(stored.y), "w": float(stored.w), "h": float(stored.h)}
	if partial.has("w"):
		next.w = float(partial.w)
	if partial.has("h"):
		next.h = float(partial.h)
	if partial.has("x") or partial.has("y"):
		var disp := display_from_stored(next, canvas, center)
		if partial.has("x"):
			disp.x = float(partial.x)
		if partial.has("y"):
			disp.y = float(partial.y)
		var merged := stored_from_display(disp, canvas, center)
		next.x = merged.x
		next.y = merged.y
	if locked and ar > 0:
		if partial.has("w") and not partial.has("h"):
			next.h = maxf(1.0, _jsround(next.w / ar))
		elif partial.has("h") and not partial.has("w"):
			next.w = maxf(1.0, _jsround(next.h * ar))
	return next


## The ratio the aspect lock keeps: the media's own, else the rect's, else 16:9.
static func lock_ratio(content: Vector2, stored: Dictionary) -> float:
	if content.x > 0 and content.y > 0:
		return content.x / content.y
	if float(stored.get("w", 0)) > 0 and float(stored.get("h", 0)) > 0:
		return float(stored.w) / float(stored.h)
	return 16.0 / 9.0


static func align(r: Dictionary, canvas: Vector2, mode: String) -> Dictionary:
	var w := maxf(1.0, float(r.w))
	var h := maxf(1.0, float(r.h))
	var x := float(r.x)
	var y := float(r.y)
	match mode:
		"left": x = 0
		"right": x = canvas.x - w
		"top": y = 0
		"bottom": y = canvas.y - h
		"center-h": x = (canvas.x - w) / 2.0
		"center-v": y = (canvas.y - h) / 2.0
		"center":
			x = (canvas.x - w) / 2.0
			y = (canvas.y - h) / 2.0
	return {"x": _jsround(x), "y": _jsround(y), "w": w, "h": h}


static func _jsround(v: float) -> float:
	return floorf(v + 0.5)
