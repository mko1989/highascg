extends RefCounted
## WO-657 — look editor Mirror copy + next layer number.

const O := preload("res://features/live/look_layer_ops.gd")
var t


func test_next_layer_number_lowest_free() -> void:
	t.eq(O.next_layer_number([]), 10, "empty look → 10")
	t.eq(O.next_layer_number([{"layerNumber": 10}, {"layerNumber": 12}]), 11, "fills the gap like the web")
	var full := []
	for n in range(10, 100):
		full.append({"layerNumber": n})
	t.eq(O.next_layer_number(full), -1, "90 layers → full")
	t.eq(O.mirror_copy(full, full[0], {}), {}, "full look → no copy")


func test_mirror_left_to_right() -> void:
	var l := {"layerNumber": 10, "source": {"value": "a.mov"}, "rotation": 5.0,
		"fill": {"x": 0.1, "y": 0.2, "scaleX": 0.3, "scaleY": 0.4}}
	var d := O.mirror_copy([l], l, l.fill)
	t.ok(absf(d.fill.x - 0.6) < 1e-9, "x 0.1 w 0.3 → x 0.6 (right edge 0.9 = 1 − 0.1)")
	t.eq([d.layerNumber, d.fill.y, d.fill.scaleX, d.rotation], [11, 0.2, 0.3, -5.0], "next number, same y/size, rotation mirrored")
	d.source.value = "b.mov"
	t.eq(l.source.value, "a.mov", "deep copy")


func test_mirror_uses_the_shown_width_and_crop() -> void:
	# Raw fill 0.6 wide but Caspar shows the clip 0.2 wide at x 0.1 (WO-653 contain-fit) → mirror what is seen.
	var l := {"layerNumber": 10, "fill": {"x": 0.1, "y": 0.0, "scaleX": 0.6, "scaleY": 0.5}}
	var d := O.mirror_copy([l], l, {"x": 0.1, "y": 0.0, "scaleX": 0.2, "scaleY": 0.5})
	t.ok(absf(d.fill.x - 0.7) < 1e-9, "shown 0.1..0.3 → 0.7..0.9")
	var c := {"layerNumber": 10, "fill": {"x": 0.0, "y": 0.0, "scaleX": 0.4, "scaleY": 1.0},
		"effects": [{"type": "crop", "params": {"left": 0.5, "top": 0.0, "right": 1.0, "bottom": 1.0}}]}
	var dc := O.mirror_copy([c], c, c.fill)
	# visible 0.2..0.4 → 0.6..0.8; the raw x = visible x − crop.left·w = 0.6 − 0.2
	t.ok(absf(dc.fill.x - 0.4) < 1e-9, "the cropped visible part mirrors, crop kept")


func test_layer_name() -> void:
	t.eq(O.layer_name({"type": "media", "value": "PROJECTS/A/clip.mov"}), "clip.mov", "media → file name")
	t.eq(O.layer_name({"type": "route", "value": "route://5-2", "label": "DeckLink 2"}), "DeckLink 2", "live → label")


func test_drop_sources_wo766() -> void:
	var one := {"type": "media", "value": "kategoria/01.mp4"}
	t.eq(O.drop_sources(one), [one], "one media → one layer")
	var multi := {"type": "multi", "items": [one, {"type": "effect", "value": "blur"}, {"type": "media", "value": ""}, {"type": "image", "value": "a.png"}]}
	t.eq(O.drop_sources(multi).size(), 2, "a multi drag adds every media, never an effect or an empty source")
	t.eq(O.drop_sources({"playlist_row": 2}), [], "a playlist row reorder is not a layer")
	t.eq(O.drop_sources("x"), [], "not a payload")
