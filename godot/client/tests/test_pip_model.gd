extends RefCounted
## WO-601 PIP overlays — golden values from the web's pip-overlay-registry.js under node.

const P := preload("res://features/live/pip_model.gd")
## border, edge_strip, shadow of GET /api/scene/effect-registry `pipOverlays` (= web PIP_OVERLAYS), as JSON.
const REG_JSON := "[{\"type\":\"border\",\"label\":\"Border\",\"icon\":\"\",\"template\":\"pip_border\",\"defaults\":{\"width\":4,\"color\":\"#e63946\",\"radius\":0,\"opacity\":1,\"side\":\"outside\"},\"schema\":[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"inside\",\"outside\"],\"default\":\"outside\"},{\"key\":\"width\",\"label\":\"Width\",\"type\":\"float\",\"min\":0,\"max\":50,\"step\":1,\"decimals\":0,\"default\":4,\"slider\":true},{\"key\":\"color\",\"label\":\"Color\",\"type\":\"color\",\"default\":\"#e63946\"},{\"key\":\"radius\",\"label\":\"Corner Radius\",\"type\":\"float\",\"min\":0,\"max\":50,\"step\":1,\"decimals\":0,\"default\":0,\"slider\":true},{\"key\":\"opacity\",\"label\":\"Opacity\",\"type\":\"float\",\"min\":0,\"max\":1,\"step\":0.05,\"decimals\":2,\"default\":1,\"slider\":true}]},{\"type\":\"edge_strip\",\"label\":\"Edge Strip\",\"icon\":\"\",\"template\":\"pip_edge_strip\",\"defaults\":{\"direction\":\"cw\",\"count\":1,\"thickness\":3,\"color\":\"#e63946\",\"speed\":400,\"length\":300,\"glow\":true,\"glowColor\":\"#ff6b6b\",\"glowWidth\":5,\"roundedTips\":false,\"altColors\":false,\"altColor\":\"#457b9d\",\"altGlowColor\":\"#a8dadc\",\"side\":\"outside\",\"opacity\":1},\"schema\":[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"inside\",\"outside\"],\"default\":\"outside\"},{\"key\":\"opacity\",\"label\":\"Opacity\",\"type\":\"float\",\"min\":0,\"max\":1,\"step\":0.05,\"decimals\":2,\"default\":1,\"slider\":true},{\"key\":\"direction\",\"label\":\"Flow (clockwise vs counter-clockwise around PIP)\",\"type\":\"select\",\"options\":[\"cw\",\"ccw\"],\"default\":\"cw\"},{\"key\":\"count\",\"label\":\"Concurrent strips (evenly spaced around the frame edge)\",\"type\":\"int\",\"min\":1,\"max\":12,\"step\":1,\"decimals\":0,\"default\":1,\"slider\":true},{\"key\":\"thickness\",\"label\":\"Thickness\",\"type\":\"float\",\"min\":1,\"max\":20,\"step\":1,\"decimals\":0,\"default\":3,\"slider\":true},{\"key\":\"color\",\"label\":\"Color\",\"type\":\"color\",\"default\":\"#e63946\"},{\"key\":\"speed\",\"label\":\"Speed (px/s)\",\"type\":\"float\",\"min\":10,\"max\":3000,\"step\":10,\"decimals\":0,\"default\":400,\"slider\":true},{\"key\":\"length\",\"label\":\"Strip length (px)\",\"type\":\"float\",\"min\":10,\"max\":2000,\"step\":10,\"decimals\":0,\"default\":300,\"slider\":true},{\"key\":\"glow\",\"label\":\"Glow Trail\",\"type\":\"bool\",\"default\":true},{\"key\":\"glowColor\",\"label\":\"Glow Color\",\"type\":\"color\",\"default\":\"#ff6b6b\"},{\"key\":\"glowWidth\",\"label\":\"Glow Width\",\"type\":\"float\",\"min\":1,\"max\":50,\"step\":1,\"decimals\":0,\"default\":5,\"slider\":true},{\"key\":\"altColors\",\"label\":\"Alternate colors between strips\",\"type\":\"bool\",\"default\":false,\"visibleWhen\":[{\"key\":\"count\",\"min\":2}]},{\"key\":\"altColor\",\"label\":\"Alternate strip color\",\"type\":\"color\",\"default\":\"#457b9d\",\"visibleWhen\":[{\"key\":\"count\",\"min\":2},{\"key\":\"altColors\",\"equals\":true}]},{\"key\":\"altGlowColor\",\"label\":\"Alternate glow color\",\"type\":\"color\",\"default\":\"#a8dadc\",\"visibleWhen\":[{\"key\":\"count\",\"min\":2},{\"key\":\"altColors\",\"equals\":true}]},{\"key\":\"roundedTips\",\"label\":\"Rounded Tips\",\"type\":\"bool\",\"default\":false}]},{\"type\":\"shadow\",\"label\":\"Drop Shadow\",\"icon\":\"\",\"template\":\"pip_shadow\",\"defaults\":{\"blur\":20,\"offsetX\":5,\"offsetY\":5,\"color\":\"rgba(0,0,0,0.6)\",\"spread\":0,\"radius\":0,\"side\":\"outside\",\"opacity\":1},\"schema\":[{\"key\":\"side\",\"label\":\"Side\",\"type\":\"select\",\"options\":[\"inside\",\"outside\"],\"default\":\"outside\"},{\"key\":\"opacity\",\"label\":\"Opacity\",\"type\":\"float\",\"min\":0,\"max\":1,\"step\":0.05,\"decimals\":2,\"default\":1,\"slider\":true},{\"key\":\"blur\",\"label\":\"Blur\",\"type\":\"float\",\"min\":0,\"max\":100,\"step\":1,\"decimals\":0,\"default\":20,\"slider\":true},{\"key\":\"offsetX\",\"label\":\"Offset X\",\"type\":\"float\",\"min\":-50,\"max\":50,\"step\":1,\"decimals\":0,\"default\":5,\"slider\":true},{\"key\":\"offsetY\",\"label\":\"Offset Y\",\"type\":\"float\",\"min\":-50,\"max\":50,\"step\":1,\"decimals\":0,\"default\":5,\"slider\":true},{\"key\":\"color\",\"label\":\"Color\",\"type\":\"color\",\"default\":\"rgba(0,0,0,0.6)\"},{\"key\":\"spread\",\"label\":\"Spread\",\"type\":\"float\",\"min\":-20,\"max\":20,\"step\":1,\"decimals\":0,\"default\":0,\"slider\":true},{\"key\":\"radius\",\"label\":\"Corner Radius\",\"type\":\"float\",\"min\":0,\"max\":50,\"step\":1,\"decimals\":0,\"default\":0,\"slider\":true}]}]"
var t


func _reg() -> Array:
	return JSON.parse_string(REG_JSON)


func _types(a: Array) -> Array:
	return a.map(func(o: Dictionary) -> String: return o.type)


func test_from_layer_and_instance() -> void:
	t.eq(P.from_layer({"pipOverlays": [], "pipOverlay": {"type": "border", "params": {}}}), [{"type": "border", "params": {}}], "empty list → legacy single overlay")
	t.eq(P.from_layer({"pipOverlays": [{"type": "glow"}, {"params": {}}]}), [{"type": "glow"}], "typeless entries dropped")
	t.eq(P.from_layer({}), [], "none")
	t.eq(P.instance(_reg(), "shadow"), JSON.parse_string('{"type":"shadow","params":{"blur":20,"offsetX":5,"offsetY":5,"color":"rgba(0,0,0,0.6)","spread":0,"radius":0,"side":"outside","opacity":1}}'), "createPipOverlayInstance(shadow)")


func test_stack_edits() -> void:
	var reg := _reg()
	var l := P.add([], reg, "shadow", 4)
	l = P.add(l, reg, "border", 4)
	l = P.add(l, reg, "border", 4)
	t.eq(_types(l), ["shadow", "border", "border"], "appended on top; duplicates allowed")
	l = P.add(l, reg, "edge_strip", 4)
	t.eq(P.add(l, reg, "shadow", 4).size(), 4, "max stack 4")
	t.eq(_types(P.move(l, 0, 1)), ["border", "shadow", "border", "edge_strip"], "down")
	t.eq(_types(P.move(l, 0, -1)), _types(l), "first can't move up")
	t.eq(_types(P.move(l, 3, 1)), _types(l), "last can't move down")
	var l2 := P.set_param(l, 1, "width", 9)
	t.eq(P.set_type(l2, 1, reg, "border")[1].params.width, 9, "same type keeps params")
	t.eq(P.set_type(l2, 1, reg, "shadow")[1].params.blur, 20.0, "new type → fresh defaults")
	t.eq(l[1].params.width, 4.0, "input untouched")
	t.eq(_types(P.remove(l, 0)), ["border", "border", "edge_strip"], "remove")


func test_visible_when() -> void:
	var d := P.def_of(_reg(), "edge_strip")
	var f := func(k: String) -> Dictionary:
		for s in d.schema:
			if s.key == k:
				return s
		return {}
	# [params, altColors visible, altColor visible] — node pipOverlayFieldVisible
	var cases := [[{}, false, false], [{"count": 2}, true, false], [{"count": 2, "altColors": true}, true, true],
		[{"count": "3", "altColors": true}, true, true], [{"count": 2, "altColors": 1}, true, false], [{"count": 1, "altColors": true}, false, false]]
	for c in cases:
		t.eq(P.field_visible(f.call("altColors"), c[0], d.schema), c[1], "altColors %s" % [c[0]])
		t.eq(P.field_visible(f.call("altColor"), c[0], d.schema), c[2], "altColor %s" % [c[0]])
	t.ok(P.field_visible(f.call("color"), {}, d.schema), "ungated field always visible")


func test_css_colours() -> void:
	t.eq(P.to_css(P.parse_css("#e63946")), "#e63946", "hex round trip")
	var c := P.parse_css("rgba(0,0,0,0.6)")
	t.ok(c.r == 0.0 and absf(c.a - 0.6) < 1e-6, "rgba parsed")
	t.eq(P.to_css(c), "rgba(0,0,0,0.6)", "translucent → rgba()")
	t.eq(P.to_css(P.parse_css("#fff")), "#ffffff", "short hex")
	t.eq(P.to_css(P.parse_css("rgb(255, 107, 107)")), "#ff6b6b", "rgb()")
	t.eq(P.parse_css("tomato"), Color.WHITE, "named colours unsupported → white")
