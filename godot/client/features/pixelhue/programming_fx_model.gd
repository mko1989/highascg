extends RefCounted
## WO-1039 — layer effects, pure (no autoloads): Studio's public/layer-effects-ui.js as data. sections(state, layer)
## describes every section the device supports for this layer (Look, Border, Mask, Shadow, Colour, Source crop,
## Keying, Cut & Fill) as rows; effect(row, value) is the `effect` object of {action:'effect', …} that row sends
## (lib/layer-effects.js planEffects accepts it). The UI (programming_effects.gd) only draws rows.
##
## Row: {kind: check|number|color|select|button|slider|note, label, path: [section, key] or [key], value, min, max,
## step, int, options: [[value, label]], effect (button: the whole effect), msg}

const M := preload("res://features/pixelhue/programming_model.gd")
const G := preload("res://features/pixelhue/programming_geometry.gd")

const RATIO := 100000
const BORDER_RESET := {"enable": false, "style": 1, "h": 2, "v": 2, "color": "#3460d8", "opacity": 100}
const MASK_RESET := {"enable": false, "left": 0, "right": 0, "top": 0, "bottom": 0}
const SHADOW_RESET := {"enable": false, "feather": 5, "width": 100, "height": 100, "x": 5, "y": 5, "color": "#000000", "opacity": 100}
const QUALITY_RESET := {"brightness": 100, "contrast": 100, "hue": 0, "saturation": 100}
const CROP_RESET := {"enable": false, "x": 0, "y": 0, "width": RATIO, "height": RATIO}
const KEY_RESET := {"enable": false, "type": 2, "threshold": 10, "gain": 50, "fill": false, "fillColor": "#ffffff", "hueClip": 10, "hueRamp": 90,
	"satClip": 10, "softness": 100, "spill": 50, "shadow": 0, "highlight": 0, "edgeSmooth": false, "color": "#000000", "smartColor": "#000000", "strength": 50, "gainAdjust": 0}


static func _check(label: String, path: Array, value: Variant, msg: String) -> Dictionary:
	return {"kind": "check", "label": label, "path": path, "value": value == true, "msg": msg}


static func _num(label: String, path: Array, value: Variant, lo: float, hi: float, msg: String, step := 1.0) -> Dictionary:
	return {"kind": "number", "label": label, "path": path, "value": value, "min": lo, "max": hi, "step": step, "int": step >= 1.0, "msg": msg}


static func _color(label: String, path: Array, value: Variant, msg: String) -> Dictionary:
	return {"kind": "color", "label": label, "path": path, "value": str(value), "msg": msg}


static func _button(label: String, effect: Dictionary, msg: String) -> Dictionary:
	return {"kind": "button", "label": label, "effect": effect, "msg": msg}


static func _d(fx: Dictionary, key: String) -> Dictionary:
	return fx.get(key) if fx.get(key) is Dictionary else {}


static func pct(raw: Variant) -> float:
	return G.jr(float(raw) / 100.0) / 10.0


static func raw(p: float) -> int:
	return G.jr(p * 1000.0)


## Every section shown for `layer`: [{id, title, on, rows}]. Locked on the device → only the Look's lock switch.
static func sections(state: Dictionary, layer: Dictionary) -> Array:
	var fx: Dictionary = layer.get("fx") if layer.get("fx") is Dictionary else {}
	if fx.is_empty():
		return []
	var can: Dictionary = state.get("effects") if state.get("effects") is Dictionary else {}
	var type := int(layer.get("type", 2))
	var input := int(layer.get("sourceType", 0)) == 2
	var out: Array = []
	var op: Variant = fx.get("opacity")
	var look_on: bool = (op != null and int(op) < 100) or fx.get("flipH") == true or fx.get("flipV") == true or fx.get("mono") == true or fx.get("inverse") == true or fx.get("locked") == true
	var look: Array = [_check("Locked on device", ["locked"], fx.get("locked"), "Layer lock saved.")]
	if fx.get("locked") == true:
		look.append({"kind": "note", "label": "Unlock to edit effects."})
		return [{"id": "look", "title": "Look", "on": look_on, "rows": look}]
	if can.get("opacity") == true and op != null:
		look.append({"kind": "slider", "label": "Opacity", "path": ["opacity"], "value": int(op), "min": 0, "max": 100, "msg": "Opacity saved."})
	if can.get("flip") == true:
		look.append_array([_check("Flip H", ["flipH"], fx.get("flipH"), "Flip saved."), _check("Flip V", ["flipV"], fx.get("flipV"), "Flip saved.")])
	if can.get("mono") == true:
		look.append(_check("Mono", ["mono"], fx.get("mono"), "Monochrome saved."))
	if can.get("inverse") == true:
		look.append(_check("Invert", ["inverse"], fx.get("inverse"), "Invert saved."))
	out.append({"id": "look", "title": "Look", "on": look_on, "rows": look})
	var b := _d(fx, "border")
	if can.get("border") == true and not b.is_empty() and type == 2:
		var styles: Array = can.get("borderStyles") if can.get("borderStyles") is Array else [[b.get("style", 1), "Style %s" % str(b.get("style", 1))]]
		out.append({"id": "border", "title": "Border", "on": b.get("enable") == true, "rows": [
			_check("Show border", ["border", "enable"], b.get("enable"), "Border saved."),
			_num("Width", ["border", "h"], b.get("h", 0), 0, 512, "Border saved."), _num("Height", ["border", "v"], b.get("v", 0), 0, 512, "Border saved."),
			{"kind": "select", "label": "Style", "path": ["border", "style"], "value": int(b.get("style", 1)), "options": styles, "msg": "Border saved."},
			_color("Colour", ["border", "color"], b.get("color", "#3460d8"), "Border saved."), _button("Reset border", {"border": BORDER_RESET}, "Border saved.")]})
	var m := _d(fx, "mask")
	if can.get("mask") == true and not m.is_empty() and type in [2, 4]:
		var w: Dictionary = layer.get("window", {})
		out.append({"id": "mask", "title": "Mask", "on": m.get("enable") == true, "rows": [
			_check("Mask edges", ["mask", "enable"], m.get("enable"), "Mask saved."),
			_num("Left px", ["mask", "left"], m.get("left", 0), 0, w.get("width", 0), "Mask saved."), _num("Right px", ["mask", "right"], m.get("right", 0), 0, w.get("width", 0), "Mask saved."),
			_num("Top px", ["mask", "top"], m.get("top", 0), 0, w.get("height", 0), "Mask saved."), _num("Bottom px", ["mask", "bottom"], m.get("bottom", 0), 0, w.get("height", 0), "Mask saved."),
			_button("Reset mask", {"mask": MASK_RESET}, "Mask saved.")]})
	var s := _d(fx, "shadow")
	if can.get("shadow") == true and not s.is_empty() and type == 2:
		out.append({"id": "shadow", "title": "Shadow", "on": s.get("enable") == true, "rows": [
			_check("Drop shadow", ["shadow", "enable"], s.get("enable"), "Shadow saved."),
			_num("Offset X %", ["shadow", "x"], s.get("x", 0), -100, 100, "Shadow saved."), _num("Offset Y %", ["shadow", "y"], s.get("y", 0), -100, 100, "Shadow saved."),
			_num("Width %", ["shadow", "width"], s.get("width", 100), 5, 200, "Shadow saved."), _num("Height %", ["shadow", "height"], s.get("height", 100), 5, 200, "Shadow saved."),
			_num("Feather", ["shadow", "feather"], s.get("feather", 0), 0, 100, "Shadow saved."), _num("Opacity %", ["shadow", "opacity"], s.get("opacity", 100), 0, 100, "Shadow saved."),
			_color("Colour", ["shadow", "color"], s.get("color", "#000000"), "Shadow saved."), _button("Reset shadow", {"shadow": SHADOW_RESET}, "Shadow saved.")]})
	var q := _d(fx, "quality")
	if can.get("quality") == true and not q.is_empty():
		var changed: bool = int(q.get("brightness", 100)) != 100 or int(q.get("contrast", 100)) != 100 or int(q.get("hue", 0)) != 0 or int(q.get("saturation", 100)) != 100
		out.append({"id": "colour", "title": "Colour", "on": changed, "rows": [
			_num("Brightness", ["quality", "brightness"], q.get("brightness", 100), 0, 200, "Colour saved."), _num("Contrast", ["quality", "contrast"], q.get("contrast", 100), 0, 200, "Colour saved."),
			_num("Saturation", ["quality", "saturation"], q.get("saturation", 100), 0, 200, "Colour saved."), _num("Hue °", ["quality", "hue"], q.get("hue", 0), -180, 180, "Colour saved."),
			_button("Reset colour", {"quality": QUALITY_RESET}, "Colour saved.")]})
	var c := _d(fx, "crop")
	if can.get("crop") == true and not c.is_empty() and type in [2, 4] and input:
		out.append({"id": "crop", "title": "Source crop", "on": c.get("enable") == true, "rows": [
			_check("Crop source", ["crop", "enable"], c.get("enable"), "Source crop saved."),
			_num("X %", ["crop", "x"], pct(c.get("x", 0)), 0, 99.9, "Source crop saved.", 0.1), _num("Y %", ["crop", "y"], pct(c.get("y", 0)), 0, 99.9, "Source crop saved.", 0.1),
			_num("Width %", ["crop", "width"], pct(c.get("width", RATIO)), 0.1, 100, "Source crop saved.", 0.1), _num("Height %", ["crop", "height"], pct(c.get("height", RATIO)), 0.1, 100, "Source crop saved.", 0.1),
			_button("Reset crop", {"crop": CROP_RESET}, "Source crop saved.")]})
	var k := _d(fx, "key")
	if can.get("key") == true and not k.is_empty() and type == 2 and input:
		out.append({"id": "key", "title": "Keying", "on": k.get("enable") == true, "rows": key_rows(k)})
	var cf := _d(fx, "cutFill")
	if can.get("cutFill") == true and not cf.is_empty() and type == 2:
		out.append({"id": "cutfill", "title": "Cut & Fill", "on": cf.get("enable") == true, "rows": cut_rows(state, cf)})
	return out


static func key_rows(k: Dictionary) -> Array:
	var rows: Array = [_check("Key this layer", ["key", "enable"], k.get("enable"), "Keying saved."),
		{"kind": "select", "label": "Type", "path": ["key", "type"], "value": int(k.get("type", 2)), "options": [[0, "Luma"], [1, "Chroma"], [2, "Smart"]], "msg": "Keying saved."}]
	match int(k.get("type", 2)):
		0:
			rows.append_array([_num("Threshold", ["key", "threshold"], k.get("threshold", 0), 0, 100, "Keying saved."), _num("Gain", ["key", "gain"], k.get("gain", 0), 0, 100, "Keying saved."),
				_check("Fill colour", ["key", "fill"], k.get("fill"), "Keying saved."), _color("Fill", ["key", "fillColor"], k.get("fillColor", "#ffffff"), "Keying saved.")])
		1:
			rows.append_array([_color("Key colour", ["key", "color"], k.get("color", "#000000"), "Keying saved."), _check("Smooth edges", ["key", "edgeSmooth"], k.get("edgeSmooth"), "Keying saved."),
				_num("Hue tolerance", ["key", "hueClip"], k.get("hueClip", 10), 5, 180, "Keying saved."), _num("Hue threshold", ["key", "hueRamp"], k.get("hueRamp", 90), 5, 180, "Keying saved."),
				_num("Saturation", ["key", "satClip"], k.get("satClip", 0), 0, 100, "Keying saved."), _num("Softness", ["key", "softness"], k.get("softness", 100), 1, 100, "Keying saved."),
				_num("Spill", ["key", "spill"], k.get("spill", 0), 0, 100, "Keying saved."), _num("Shadow", ["key", "shadow"], k.get("shadow", 0), 0, 100, "Keying saved."),
				_num("Highlight", ["key", "highlight"], k.get("highlight", 0), 0, 100, "Keying saved.")])
		_:
			rows.append_array([_color("Key colour", ["key", "smartColor"], k.get("smartColor", "#000000"), "Keying saved."),
				_num("Strength", ["key", "strength"], k.get("strength", 50), 0, 100, "Keying saved."), _num("Gain", ["key", "gainAdjust"], k.get("gainAdjust", 0), 0, 100, "Keying saved.")])
	rows.append(_button("Reset keying", {"key": KEY_RESET}, "Keying saved."))
	return rows


## Cut & Fill: the cut source supplies the shape, this layer the fill. Settings only while it is on.
static func cut_rows(state: Dictionary, c: Dictionary) -> Array:
	var on: bool = c.get("enable") == true
	var rows: Array = [{"kind": "check", "label": "Cut this layer with a key source", "path": ["cutFill", "enable"], "value": on, "msg": "Cut & Fill on." if not on else "Cut & Fill off."}]
	if not on:
		return rows
	var options: Array = [["0:0", "No cut source"]]
	for s in M.arr(state, "sources"):
		if int(s.get("type", 0)) == 2:
			options.append(["2:%d" % int(s.id), str(s.get("name", ""))])
	var st := int(c.get("sourceType", 0))
	if st == 5:
		options.append(["5:%d" % int(c.get("sourceId", 0)), "Gallery image"])
	var current := "%d:%d" % [st, int(c.get("sourceId", 0))] if st in [2, 5] else "0:0"
	rows.append_array([{"kind": "select", "label": "Cut source", "path": ["cutFill", "source"], "value": current, "options": options, "msg": "Cut source saved."},
		_check("Invert cut", ["cutFill", "inverse"], c.get("inverse"), "Cut & Fill saved."),
		_num("Offset X %", ["cutFill", "x"], c.get("x", 0), -100, 100, "Cut & Fill saved."), _num("Offset Y %", ["cutFill", "y"], c.get("y", 0), -100, 100, "Cut & Fill saved."),
		_num("Width %", ["cutFill", "width"], c.get("width", 100), 5, 200, "Cut & Fill saved."), _num("Height %", ["cutFill", "height"], c.get("height", 100), 5, 200, "Cut & Fill saved."),
		_num("Black in", ["cutFill", "startX"], c.get("startX", 0), 0, 255, "Cut & Fill saved."), _num("Black out", ["cutFill", "startY"], c.get("startY", 0), 0, 255, "Cut & Fill saved."),
		_num("White in", ["cutFill", "endX"], c.get("endX", 255), 0, 255, "Cut & Fill saved."), _num("White out", ["cutFill", "endY"], c.get("endY", 255), 0, 255, "Cut & Fill saved."),
		_button("Reset Cut & Fill", {"cutFill": {"reset": true}}, "Cut & Fill reset.")])
	return rows


## The effect object a row sends for `value` ({} = nothing to send). `fx` = the layer's current effects (crop coupling).
static func effect(row: Dictionary, value: Variant, fx: Dictionary) -> Dictionary:
	if str(row.get("kind")) == "button":
		return (row.effect as Dictionary).duplicate(true)
	var path: Array = row.get("path", [])
	if path.is_empty():
		return {}
	var v: Variant = value
	if str(row.get("kind")) in ["number", "slider"]:
		if value == null:
			return {}
		var f := clampf(float(value), float(row.get("min", -INF)), float(row.get("max", INF)))
		v = G.jr(f) if row.get("int", true) == true else f
	if path.size() == 1:
		return {path[0]: v}
	var sec := str(path[0])
	var key := str(path[1])
	if sec == "crop" and key in ["x", "y", "width", "height"]:
		return {"crop": crop_change(key, float(v), _d(fx, "crop"))}
	if sec == "cutFill" and key == "source":
		var parts := str(v).split(":")
		var t := int(parts[0])
		return {"cutFill": {"source": {"id": int(parts[1]), "type": t}}} if t != 0 else {"cutFill": {"reset": true}}
	return {sec: {key: v}}


## Crop in percent (one decimal) → device ratios 0–100000, keeping the crop inside the source.
static func crop_change(key: String, percent: float, c: Dictionary) -> Dictionary:
	var r := raw(percent)
	var cx := int(c.get("x", 0))
	var cy := int(c.get("y", 0))
	match key:
		"x":
			return {"x": r, "width": mini(int(c.get("width", RATIO)), RATIO - r)}
		"y":
			return {"y": r, "height": mini(int(c.get("height", RATIO)), RATIO - r)}
		"width":
			return {"width": mini(r, RATIO - cx)}
	return {"height": mini(r, RATIO - cy)}


static func color_hex(c: Color) -> String:
	return "#" + c.to_html(false).to_lower()
