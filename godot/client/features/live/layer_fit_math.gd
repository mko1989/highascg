extends RefCounted
## WO-653 — the rect Caspar actually shows for a look layer: a port of src/engine/scene-native-fill.js
## mapContentFitToStretch + calcMixerFill (authoring canvas = target channel). With the aspect lock on and a non-stretch
## content fit, the server fits the clip INSIDE the layer's fill at the clip's own aspect, anchored top-left; the editor
## drew the raw fill, so a box at another aspect than its clip looked much wider than PGM / PRV. Pure, tests headless.


## The server's stretch mode for a layer ('stretch' | 'none' | 'fit' | 'fill-h' | 'fill-v'); KEEP IN SYNC with
## scene-native-fill.js mapContentFitToStretch.
static func stretch_mode(l: Dictionary) -> String:
	if l.get("aspectLocked") == false:
		return "stretch"
	match str(l.get("contentFit", "")):
		"native":
			return "none"
		"horizontal":
			return "fill-h"
		"vertical":
			return "fill-v"
		"stretch":
			return "stretch"
		"fill-canvas":
			return "fit"
	return "stretch" if l.get("fillNativeAspect") == false else "fit"


## Only probed media is re-fitted (resolveSceneLayerFill): templates, timelines, route:// and live sources keep the fill.
static func refits(l: Dictionary) -> bool:
	var src: Dictionary = l.source if l.get("source") is Dictionary else {}
	var t := str(src.get("type", ""))
	if not (t == "" or t == "media" or t == "file"):
		return false
	return not str(src.get("value", "")).begins_with("route://")


## The fill (fractions of `canvas`) Caspar shows for `l`; `content` = the clip's px size, ZERO when unknown.
static func shown_fill(l: Dictionary, content: Vector2, canvas: Vector2) -> Dictionary:
	var raw: Dictionary = l.fill if l.get("fill") is Dictionary else {"x": 0.0, "y": 0.0, "scaleX": 1.0, "scaleY": 1.0}
	var mode := stretch_mode(l)
	if mode == "stretch" or not refits(l) or canvas.x <= 0.0 or canvas.y <= 0.0:
		return raw
	var lw := float(raw.get("scaleX", 1.0)) * canvas.x
	var lh := float(raw.get("scaleY", 1.0)) * canvas.y
	var known := content.x > 0.0 and content.y > 0.0
	var ar := content.x / content.y if known else 16.0 / 9.0
	var w := lw
	var h := lh
	if mode == "none" or mode == "fit":
		if not known and mode == "none":
			return raw
		w = minf(lw, lh * ar)
		h = w / ar
	elif mode == "fill-h":
		h = lw / ar
	elif mode == "fill-v":
		w = lh * ar
	var out := raw.duplicate()
	out["scaleX"] = w / canvas.x
	out["scaleY"] = h / canvas.y
	return out
