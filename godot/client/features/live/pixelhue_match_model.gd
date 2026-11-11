extends RefCounted
## WO-1035 — pure helpers of the layer inspector's "Match PixelHue layer" row (no autoloads; tests/test_pixelhue_match.gd).
## The server reads the switcher's layers (GET /api/pixelhue/layers?scene=pgm); picking one copies its rectangle onto
## the look layer, so an empty layer with a PIP border sits exactly on the switcher's layer (key + fill overlay).


## The switcher layers a look layer can copy: enabled program layers with a size, on enabled screens.
## → [{label, fill}]
static func choices(data: Variant) -> Array:
	var out := []
	if not data is Dictionary:
		return out
	for s in data.get("screens", []):
		if not s is Dictionary or s.get("enabled") != true:
			continue
		for l in s.get("layers", []):
			if not l is Dictionary or l.get("enabled") != true or not l.get("fill") is Dictionary:
				continue
			if str(l.get("scene", "")) != "pgm" or str(l.get("type", "")) in ["bkg", "mvr", "aux"]:
				continue  # the multiviewer's tiles and the AUX outputs are not pictures on a screen a border goes over
			var name := str(l.get("name", "")).strip_edges()
			var src := str(l.get("source", "")).strip_edges()
			out.append({
				"name": "%s · %s" % [str(s.get("name", "Screen")), name if name != "" else "layer"],
				"where": "%d×%d at %d,%d%s" % [int(l.get("width", 0)), int(l.get("height", 0)), int(l.get("x", 0)), int(l.get("y", 0)), " · " + src if src != "" else ""],
				"label": "%s · %s · %d×%d at %d,%d%s" % [str(s.get("name", "Screen")), name if name != "" else "layer", int(l.get("width", 0)), int(l.get("height", 0)), int(l.get("x", 0)), int(l.get("y", 0)), " · " + src if src != "" else ""],
				"fill": l.fill,
			})
	return out


## Colour source of a dropped switcher layer: fully transparent black — nothing on the fill, nothing on the key, so
## only what the layer carries (a PIP border, an effect) reaches the switcher's key + fill inputs.
const EMPTY_COLOR := "#00000000"


## A look layer made from a switcher layer: it plays nothing, so the inspector leaves the media rows out.
static func is_empty_placeholder(layer: Variant) -> bool:
	if not layer is Dictionary or not layer.get("source") is Dictionary:
		return false
	var src: Dictionary = layer.source
	return src.get("isPlaceholder") == true and str(src.get("value", "")) == EMPTY_COLOR


## What a row of the Sources ▸ Live "PixelHue layers" list drags: an empty placeholder source that remembers the
## switcher layer's rectangle (look_layer_drop.gd puts the new layer there).
static func drag_payload(choice: Dictionary) -> Dictionary:
	return {"type": "media", "value": EMPTY_COLOR, "label": "PixelHue · " + str(choice.get("name", "layer")), "isPlaceholder": true,
		"pixelhueFill": choice.get("fill", {})}


## The rectangle patch a dragged source carries, or {} for every other source.
static func patch_of_source(src: Variant) -> Dictionary:
	if src is Dictionary and src.get("pixelhueFill") is Dictionary and not (src.pixelhueFill as Dictionary).is_empty():
		return patch_for({"fill": src.pixelhueFill})
	return {}


## Devices ▸ PixelHue status line from GET /api/pixelhue/layers (ok, body).
static func status_line(ok: bool, data: Variant) -> String:
	if not data is Dictionary:
		return "No answer from the server."
	if not ok:
		return str(data.get("error", "The switcher did not answer."))
	var screens := 0
	var layers := 0
	for s in data.get("screens", []):
		if s is Dictionary and s.get("enabled") == true:
			screens += 1
			for l in s.get("layers", []):
				if l is Dictionary and l.get("enabled") == true and str(l.get("scene", "")) == "pgm":
					layers += 1
	var dev: Dictionary = data.get("device", {}) if data.get("device") is Dictionary else {}
	return "Connected — device %s:%s · %d screen(s) · %d program layer(s)" % [str(dev.get("ip", "?")), str(dev.get("port", "?")), screens, layers]


## The look-layer patch for a picked switcher layer: its rectangle, stretched to it (the rectangle IS the size —
## an aspect lock or a content fit would move it off the switcher's layer).
static func patch_for(choice: Dictionary) -> Dictionary:
	var f: Dictionary = choice.get("fill", {})
	return {"fill": {"x": float(f.get("x", 0)), "y": float(f.get("y", 0)), "scaleX": float(f.get("scaleX", 1)), "scaleY": float(f.get("scaleY", 1))},
		"contentFit": "stretch", "aspectLocked": false}
