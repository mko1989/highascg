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
			if str(l.get("scene", "")) != "pgm" or str(l.get("type", "")) == "bkg":
				continue
			var name := str(l.get("name", "")).strip_edges()
			var src := str(l.get("source", "")).strip_edges()
			out.append({
				"label": "%s · %s · %d×%d at %d,%d%s" % [str(s.get("name", "Screen")), name if name != "" else "layer", int(l.get("width", 0)), int(l.get("height", 0)), int(l.get("x", 0)), int(l.get("y", 0)), " · " + src if src != "" else ""],
				"fill": l.fill,
			})
	return out


## The look-layer patch for a picked switcher layer: its rectangle, stretched to it (the rectangle IS the size —
## an aspect lock or a content fit would move it off the switcher's layer).
static func patch_for(choice: Dictionary) -> Dictionary:
	var f: Dictionary = choice.get("fill", {})
	return {"fill": {"x": float(f.get("x", 0)), "y": float(f.get("y", 0)), "scaleX": float(f.get("scaleX", 1)), "scaleY": float(f.get("scaleY", 1))},
		"contentFit": "stretch", "aspectLocked": false}
