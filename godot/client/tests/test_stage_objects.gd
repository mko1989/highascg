extends RefCounted
## WO-614 T1 — stage object model: derived sizes, pitch, curve geometry, projector pose, crops, presets.

const S := preload("res://features/previs/stage_objects.gd")
var t


func _near(a: float, b: float, eps := 1e-4) -> bool:
	return absf(a - b) < eps


func test_led_wall_from_panel_numbers() -> void:
	var o := S.normalize({"type": "led_wall", "panel_px": [192, 192], "panel_mm": [500, 500], "panels": [10, 6]})
	t.eq(S.pixels(o), Vector2i(1920, 1152), "10×6 of 192 px")
	var s := S.size_m(o)
	t.ok(_near(s.x, 5.0) and _near(s.y, 3.0), "10×6 of 500 mm = 5.0 × 3.0 m")
	t.ok(_near(S.pitch_mm(o).x, 500.0 / 192.0), "pitch P2.604")
	t.ok(S.pitch_is_square(o), "square pitch")
	t.ok(not S.pitch_is_square(S.normalize({"type": "led_wall", "panel_px": [192, 168], "panel_mm": [500, 500]})), "mismatched pitch flagged")


func test_defaults_and_clamps() -> void:
	var o := S.normalize({"type": "nonsense", "panels": [0, 9999], "curve_deg": 90})
	t.eq(o.type, "led_wall", "unknown type falls back to led_wall")
	t.eq(o.panels, [1, 200], "panel count clamped 1..200")
	t.eq(o.curve_deg, 30.0, "curve clamped to 30°")
	t.eq(o.source.rect.w, 192, "default crop = full native width")
	t.ok(o.has("position") and o.has("rotation") and o.visible, "common fields filled")
	t.eq(S.normalize({"type": "tv", "extra": 7}).extra, 7, "unknown keys kept")


func test_flat_wall_column_edges() -> void:
	var e := S.column_edges(S.normalize({"type": "led_wall", "panels": [4, 1]}))
	t.eq(e.size(), 5, "cols + 1 edges")
	t.ok(_near(e[0].x, -1.0) and _near(e[4].x, 1.0) and _near(e[2].x, 0.0), "flat: -1 .. 1 m, centred")
	t.ok(_near(e[0].y, 0.0) and _near(e[4].y, 0.0), "flat: z = 0")


func test_curved_wall_keeps_panel_width() -> void:
	var o := S.normalize({"type": "led_wall", "panels": [6, 1], "curve_deg": 10.0})
	var e := S.column_edges(o)
	for j in 6:
		t.ok(_near(e[j].distance_to(e[j + 1]), 0.5), "chord %d = panel width 0.5 m" % j)
	t.ok(_near(e[0].x, -e[6].x) and _near(e[0].y, e[6].y), "symmetric")
	t.ok(e[0].y > 0.0 and _near(e[3].y, 0.0), "concave: edges towards the audience (+Z), centre at 0")
	o["curve_deg"] = -10.0
	t.ok(S.column_edges(S.normalize(o))[0].y < 0.0, "negative curve = convex")


func test_tv_from_diagonal() -> void:
	var o := S.normalize({"type": "tv", "diagonal_in": 65, "aspect": [16, 9], "resolution": [3840, 2160]})
	var s := S.size_m(o)
	t.ok(_near(s.x, 1.4391, 1e-3) and _near(s.y, 0.8095, 1e-3), "65\" 16:9 ≈ 1.439 × 0.809 m")
	o["portrait"] = true
	o = S.normalize(o)
	t.ok(S.size_m(o).y > S.size_m(o).x, "portrait swaps size")
	t.eq(S.pixels(o), Vector2i(2160, 3840), "portrait swaps pixels")


func test_projector_pose() -> void:
	var o := S.normalize({"type": "projection", "screen_m": [4.0, 2.25], "throw": 1.5})
	var p := S.projector_offset(o)
	t.ok(_near(p.z, 6.0) and _near(p.y, 1.125), "front: 1.5 × 4 m = 6 m out, centred")
	o["rear"] = true
	o["lens_shift_v"] = 0.5
	p = S.projector_offset(S.normalize(o))
	t.ok(_near(p.z, -6.0) and _near(p.y, 2.25), "rear + 50 % shift")


func test_uv_rect_and_destination() -> void:
	var dest := {"label": "Main LED", "width": 3840, "height": 1152, "mainScreenIndex": 1}
	var o := S.from_destination(dest, "led_wall")
	t.eq(o.panels, [20, 6], "3840×1152 / 192 px = 20 × 6 panels")
	t.eq(o.source.role, "pgm2", "bound to destination 2's PGM surface")
	t.eq(o.name, "Main LED", "named after the destination")
	t.eq(S.uv_rect(o, Vector2i(3840, 1152)), Vector4(0, 0, 1, 1), "full raster crop")
	o["source"] = {"role": "pgm2", "rect": {"x": 1920, "y": 0, "w": 1920, "h": 1152}}
	t.eq(S.uv_rect(S.normalize(o), Vector2i(3840, 1152)), Vector4(0.5, 0, 0.5, 1), "right half")
	var tv := S.from_destination({"width": 1920, "height": 1080}, "tv")
	t.eq(S.pixels(tv), Vector2i(1920, 1080), "tv takes the destination raster")


func test_new_object_ids_unique() -> void:
	var a := S.new_object("tv")
	var b := S.new_object("tv", [a])
	t.ok(a.id != b.id, "second TV gets a new id")
	t.eq(b.name, "TV 2", "numbered name")
	t.eq(S.PANEL_PRESETS.size(), 5, "presets present")
	for p in S.PANEL_PRESETS:
		t.ok(_near(float(p.mm[0]) / p.px[0], float(p.mm[1]) / p.px[1], 1e-6), "%s square pitch" % p.name)


func test_2d_footprint_and_front_rect() -> void:
	var o := S.normalize({"type": "tv", "diagonal_in": 65, "position": [2.0, 1.0, 3.0]})
	var fp := S.footprint(o)
	t.ok(_near(fp[0].x, 2.0 - 0.71956, 1e-3) and _near(fp[1].x, 2.0 + 0.71956, 1e-3) and _near(fp[0].y, 3.0), "unrotated TV: centred on x, at z")
	var r := S.front_rect(o)
	t.ok(_near(r.position.y, 1.0) and _near(r.size.y, 0.8095, 1e-3) and _near(r.size.x, 1.4391, 1e-3), "front rect = width × height at its height")
	o["rotation"] = [0.0, 90.0, 0.0]
	o = S.normalize(o)
	t.ok(S.front_rect(o).size.x < 0.02, "yaw 90°: edge-on in the front view")
	t.ok(_near(absf(S.footprint(o)[0].y - S.footprint(o)[1].y), 1.4391, 1e-3), "…and full width along z in the plan")
	var p := S.normalize({"type": "projection", "screen_m": [4.0, 2.25], "throw": 1.5})
	t.ok(_near(S.projector_world_xz(p).y, 6.0), "projector 6 m in front (plan)")
	var wall := S.normalize({"type": "led_wall", "panels": [6, 2], "curve_deg": 10.0})
	t.eq(S.footprint(wall).size(), 7, "curved wall footprint = column edges")


func test_templates() -> void:
	var w := S.template("three_walls", [], "pgm1", Vector2i(2560, 768))  # design canvas = identity crops
	t.eq(w.size(), 3, "three walls")
	t.eq(w[1].name, "Centre LED", "centre in the middle")
	t.eq(S.pixels(w[1]), Vector2i(1536, 768), "centre 12×6 × 128 px")
	t.eq(w[0].source.rect.x, 0, "left wall = canvas 0..512")
	t.eq(w[1].source.rect.x, 512, "centre = canvas 512..2048")
	t.eq(w[2].source.rect.x, 2048, "right wall = canvas 2048..2560")
	t.ok(w[0].id != w[1].id and w[1].id != w[2].id, "unique ids")
	t.ok(w[0].rotation[1] > 0.0 and w[2].rotation[1] < 0.0, "side walls angled towards the audience")
	var imag := S.template("imag_lr", w)
	t.eq(imag.size(), 2, "two IMAG screens")
	t.ok(imag[0].position[0] < 0.0 and imag[1].position[0] > 0.0, "L and R")
	var row := S.template("tv_row", w + imag)
	t.eq(row.size(), 4, "four TVs")
	var ids := {}
	for o in w + imag + row:
		ids[o.id] = true
	t.eq(ids.size(), 9, "all nine ids unique across templates")


func test_array_copies_follow_yaw() -> void:
	var tv := S.normalize({"id": "tv_1", "type": "tv", "name": "DSM 1", "diagonal_in": 55, "position": [0.0, 1.0, 0.0], "rotation": [0.0, 90.0, 0.0]})
	var copies := S.array_copies(tv, 2, 0.5, [tv])
	t.eq(copies.size(), 2, "two copies")
	t.eq(copies[0].name, "DSM 2", "numbered after the original")
	var step := S.size_m(tv).x + 0.5
	t.ok(_near(copies[0].position[0], 0.0, 1e-3) and _near(absf(copies[0].position[2]), step, 1e-3), "yaw 90°: copies run along Z")
	t.ok(_near(absf(copies[1].position[2]), 2.0 * step, 1e-3), "second copy two steps away")
	t.ok(copies[0].id != tv.id and copies[0].id != copies[1].id, "unique ids")


func test_template_crops_fit_the_raster() -> void:
	var w := S.template("three_walls", [], "pgm1", Vector2i(1920, 1080))
	for o in w:
		var r: Dictionary = o.source.rect
		t.ok(r.x + r.w <= 1920 and r.y + r.h <= 1080, "%s crop inside a 1920×1080 raster" % o.name)
	t.eq(w[0].source.rect.x + w[0].source.rect.w, w[1].source.rect.x, "left|centre adjacent")
	t.eq(w[1].source.rect.x + w[1].source.rect.w, w[2].source.rect.x, "centre|right adjacent")
	t.eq(w[2].source.rect.x + w[2].source.rect.w, 1920, "canvas spans the full width")
	var full := S.template("imag_lr", [], "pgm1", Vector2i(3840, 2160))
	t.eq(full[0].source.rect.w, 3840, "full-raster templates take the raster size")
