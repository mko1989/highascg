extends RefCounted
## WO-944 — "Place outputs": output_place.gd (frames, placement slices, side by side, snapping, the "shows" line) and
## "Side by side" (lined_up). The mounted editor is covered by e2e/scenarios/16 (the canvases lease VideoSurfaces, an
## autoload headless unit runs do not have). Rig = the second dev box 04.11: a 6144×1024 PGM
## feeding a mapping node with two 2160p50 DeckLink outputs.

const OP := preload("res://features/devices/output_place.gd")
const SM := preload("res://features/devices/slice_model.gd")
var t

const OUTS := [{"id": "out_1", "label": "Output 1", "w": 3840, "h": 2160}, {"id": "out_2", "label": "Output 2", "w": 3840, "h": 2160}]
const INPUT := Vector2(6144, 1024)


static func _slices(raw: Array) -> Array:
	return SM.normalize_slices(raw, ["out_1", "out_2"])


func test_frames_kinds() -> void:
	var none := OP.frames([], OUTS, INPUT)
	t.eq(none.map(func(f: Dictionary) -> String: return f.kind), ["unplaced", "unplaced"], "no slices → both unplaced")
	t.eq(none.map(func(f: Dictionary) -> int: return f.x), [0, 3840], "unplaced frames sit where Side by side puts them")
	var s := OP.placed([], OUTS[1], 3840, 0)
	var fs := OP.frames(_slices(s), OUTS, INPUT)
	t.eq([fs[1].kind, fs[1].x, fs[1].y, fs[1].w, fs[1].h], ["placed", 3840, 0, 3840, 2160], "a placement reads back as placed")
	var rot := _slices(s)
	rot[0].dst.rotation = 90.0
	t.eq(OP.frames(rot, OUTS, INPUT)[1].kind, "free", "a rotated slice is a free-slices output")
	t.ok(not OP.all_placeable(rot, OUTS, INPUT), "a free output keeps the editor in Free slices")
	t.ok(OP.all_placeable(_slices(s), OUTS, INPUT), "placed + unplaced is placeable")


func test_the_box_slices_of_04_11_are_placements() -> void:
	# What the owner ended up with on the box (0 / 3840, each 3840 wide): Place outputs must open on it, not Free.
	var raw := [{"id": "map_out_1", "name": "Output 1", "outputId": "out_1", "src": {"x": 0, "y": 0, "w": 3840, "h": 1024},
		"dst": {"rect": {"x": 0, "y": 0, "w": 3840, "h": 1024}}},
		{"id": "map_out_2", "name": "Output 2", "outputId": "out_2", "src": {"x": 3840, "y": 0, "w": 3840, "h": 1024},
		"dst": {"rect": {"x": 0, "y": 0, "w": 3840, "h": 1024}}}]
	var fs := OP.frames(_slices(raw), OUTS, INPUT)
	t.eq(fs.map(func(f: Dictionary) -> String: return f.kind), ["placed", "placed"],
		"3840×1024 = a 2160p output clipped to the 1024-high canvas (h) / the full width (w): placements")
	t.eq([fs[0].x, fs[1].x], [0, 3840], "at their x")
	var crop := _slices(raw)
	crop[0].src.w = 1000
	crop[0].dst.rect.w = 1000
	t.eq(OP.frames(crop, OUTS, INPUT)[0].kind, "free", "a crop narrower than the output inside the canvas stays free")
	var placed := OP.placed(_slices(raw), OUTS[1], 3840, 0)
	t.eq(placed[1].id, "map_out_2", "placing keeps the slice id (the plan / inspector row stays the same)")
	t.eq(placed[1].src, {"x": 3840, "y": 0, "w": 3840, "h": 2160}, "placement = output-sized src at x / y")
	t.eq(placed[1].dst.rect, {"x": 0, "y": 0, "w": 3840, "h": 2160}, "drawn 1:1 at the output's top-left")


func test_placed_replaces_every_slice_of_the_output() -> void:
	var raw := [{"id": "a", "outputId": "out_1", "src": {"x": 0, "y": 0, "w": 100, "h": 100}},
		{"id": "b", "outputId": "out_2", "src": {"x": 0, "y": 0, "w": 100, "h": 100}},
		{"id": "c", "outputId": "out_1", "src": {"x": 200, "y": 0, "w": 100, "h": 100}, "opacity": 0.5}]
	var out := OP.placed(_slices(raw), OUTS[0], 64, 8)
	t.eq(out.map(func(s: Dictionary) -> String: return s.id), ["a", "b"], "out_1's second slice is gone, out_2's kept")
	t.ok(OP.is_placement(out[0], OUTS[0], INPUT), "the survivor is a clean placement")
	var fresh := OP.placed([], OUTS[0], 0, 0)
	t.eq([fresh.size(), fresh[0].name, fresh[0].outputId], [1, "Output 1", "out_1"], "no slice yet → one named after the output")


func test_side_by_side_and_snap() -> void:
	t.eq(OP.side_by_side(OUTS), [{"x": 0, "y": 0}, {"x": 3840, "y": 0}], "each at its own width from x 0")
	var other := [{"x": 0, "y": 0, "w": 3840, "h": 2160}]
	t.eq(OP.snapped(Vector2(3830, 5), 3840, 2160, INPUT, other, 20.0), Vector2i(3840, 0), "abuts the other output, top edge")
	t.eq(OP.snapped(Vector2(2300, 0), 3840, 2160, INPUT, [], 20.0), Vector2i(2304, 0), "right edge onto the canvas's right edge")
	t.eq(OP.snapped(Vector2(3830, 5), 3840, 2160, INPUT, other, 0.0), Vector2i(3830, 5), "Alt (tol 0): no snap")
	t.eq(OP.snapped(Vector2(2900, 3), 3840, 2160, INPUT, other, 20.0), Vector2i(2904, 0), "nothing near in x → 8 px grid; y onto the top edge")
	t.eq(OP.snapped(Vector2(-500, -40), 100, 100, INPUT, [], 0.0), Vector2i(0, 0), "never left of / above the canvas")
	t.eq(OP.clamp_pos(Vector2(9000, 5000), INPUT), Vector2i(6143, 1023), "always touches the canvas")


func test_shows_text() -> void:
	t.eq(OP.shows_text({"x": 3840, "y": 0, "w": 3840, "h": 2160}, INPUT), "canvas x 3840–6144, y 0–1024 · rest black")
	t.eq(OP.shows_text({"x": 0, "y": 0, "w": 1920, "h": 1024}, INPUT), "canvas x 0–1920, y 0–1024", "fully on canvas")


func test_lined_up_skips_free_outputs() -> void:
	var lined := OP.lined_up([], OUTS, INPUT)
	t.eq(lined.map(func(s: Dictionary) -> int: return s.src.x), [0, 3840], "Side by side from nothing → 0 / 3840")
	var free := _slices(OP.placed(OP.placed([], OUTS[0], 500, 0), OUTS[1], 100, 0))
	free[0].dst.flipH = true
	var again := OP.lined_up(free, OUTS, INPUT)
	t.ok(again[0].dst.flipH and int(again[0].src.x) == 500, "the free-slices output is left exactly as it was")
	t.eq(int(again[1].src.x), 3840, "the placeable one moves to its side-by-side spot")
