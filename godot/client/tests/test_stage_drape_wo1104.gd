extends RefCounted
## WO-1104 — the "drape" stage object: model (normalise, defaults, no picture), procedural pleats (counts, bounds,
## triangle budget per quality level, seeded stability, the JS twin's numbers), the skirt under a screen (a wall at the
## origin, the Hilton show's turned wall, a TV, no room), Array / Duplicate, and the not-a-screen rules (audience side,
## Fit yaw, surfaces held, pick in the object's own frame).

const S := preload("res://features/previs/stage_objects.gd")
const D := preload("res://features/previs/drape_geometry.gd")
const B := preload("res://features/previs/stage_builder.gd")
const A := preload("res://features/previs/tracking/aim_model.gd")
const VP := preload("res://features/previs/view_presets.gd")
var t


func _near(a: float, b: float, eps := 1e-4) -> bool:
	return absf(a - b) < eps


func _hilton_wall() -> Dictionary:
	return S.normalize({"id": "led_wall_1", "type": "led_wall", "name": "Dioda P3 15 x 3 m", "panel_mm": [500, 1000], "panel_px": [128, 256],
		"panels": [30, 3], "position": [12.7, 1.239, 3.5], "rotation": [0, -90, 0]})


func test_new_drape_defaults_and_normalise() -> void:
	var d := S.new_object("drape")
	t.eq([d.id, d.name, d.type], ["drape_1", "Drape 1", "drape"], "id / name / type")
	t.eq([d.size_m, d.color, d.fullness, d.pleat_m], [[6.0, 4.0], "#151515", 60.0, 0.25], "a 6 × 4 m black drape, 60 % fullness, 0.25 m pleats")
	t.ok(not d.has("source"), "a drape has no picture source")
	t.ok(not S.is_screen(d) and S.is_screen(S.new_object("tv")), "a drape is not a screen; a TV is")
	t.eq(S.pixels(d), Vector2i.ZERO, "no pixels")
	t.eq(S.size_m(d), Vector2(6, 4), "size_m")
	var n := S.normalize({"type": "drape", "size_m": [0, 999], "color": "red", "fullness": 500, "pleat_m": 0.0, "source": {"role": "pgm1"}, "extra": 3})
	t.eq([n.size_m, n.color, n.fullness, n.pleat_m], [[0.1, 100.0], "#151515", 200.0, 0.08], "clamped; a bad colour → black")
	t.ok(not n.has("source") and n.extra == 3, "a stray source dropped, unknown keys kept")
	t.eq(S.normalize({"type": "drape", "color": "#1B2442"}).color, "#1B2442", "a valid colour kept")
	t.eq(S.normalize(S.normalize(d)), S.normalize(d), "normalise is idempotent")
	t.eq(S.DRAPE_COLORS.map(func(c: Array) -> String: return c[0]), ["Black", "Dark grey", "White", "Navy", "Burgundy"], "presets")


func test_twin_numbers_match_the_js() -> void:
	# the same numbers src/stage/drape-geometry.js gives (smoke-wo1104-drape.test.js pins them there too)
	var seed := D.seed_of("drape_1")
	t.eq(seed, 1142602941, "FNV-1a of drape_1")
	t.ok(_near(D.hash01(seed, 0), 0.773661802, 1e-8) and _near(D.hash01(seed, 7919), 0.598310251, 1e-8), "hash01")
	t.ok(_near(D.amplitude(0.5, 0.25), 0.065505, 1e-5) and _near(D.amplitude(1.0, 0.25), 0.103474, 1e-5), "amplitude for 50 / 100 %")
	var nd := D.nodes({"id": "drape_1", "size_m": [15.1, 1.0], "fullness": 60.0, "pleat_m": 0.25})
	t.eq(nd.size(), 121, "60 pleats → 121 fold nodes")
	t.ok(_near(nd[0].x, -7.55) and _near(nd[0].y, 0.065108, 1e-5) and _near(nd[1].x, -7.413847, 1e-5) and _near(nd[1].y, -0.071886, 1e-5), "first nodes")
	t.ok(_near(nd[120].x, 7.55), "last node at the right edge")


func test_pleats_profile_and_cloth() -> void:
	var d := S.normalize({"id": "drape_7", "type": "drape", "size_m": [6.0, 4.0], "fullness": 60.0, "pleat_m": 0.25})
	t.eq(D.pleats(d), 24, "6 m / 0.25 m = 24 pleats")
	var prof := D.profile(d, 4)
	t.eq(prof.size(), 48 * 4 + 1, "4 points per half pleat + the end")
	var ratio := D.cloth_m(prof) / 6.0
	t.ok(ratio > 1.45 and ratio < 1.7, "60 %% fullness ≈ 1.6 × the width of cloth (%.3f)" % ratio)
	var dr := D.depth_range(d)
	var amp := D.amplitude(0.6, 0.25)
	t.ok(dr.x < 0.0 and dr.y > 0.0 and -dr.x <= amp + 1e-6 and dr.y <= amp + 1e-6 and dr.y - dr.x > 1.4 * amp, "folds within ±A, most of 2A deep")
	var flat := S.normalize({"type": "drape", "fullness": 0.0})
	t.eq([D.pleats(flat), D.profile(flat, 8).size(), D.triangles(flat, 8)], [0, 2, 4], "fullness 0 = flat molton: one quad per band")
	t.eq(D.depth_range(flat), Vector2.ZERO, "flat: no depth")


func test_mesh_bounds_and_budget_per_quality() -> void:
	var d := S.normalize({"id": "drape_1", "type": "drape", "size_m": [15.1, 1.0], "fullness": 50.0, "pleat_m": 0.2})
	var tris := []
	for s in D.SAMPLES:
		tris.append(D.triangles(d, s))
	t.ok(tris[0] < tris[1] and tris[1] < tris[2] and tris[2] < tris[3], "Low < Medium < High < Ultra (%s)" % str(tris))
	t.ok(tris[3] <= 8000, "a 15 m skirt at Ultra stays under 8k triangles (%d)" % tris[3])
	var m := D.mesh(d, D.SAMPLES[1])
	var aabb := m.get_aabb()
	var dr := D.depth_range(d)
	t.ok(_near(aabb.position.x, -7.55) and _near(aabb.end.x, 7.55) and _near(aabb.position.y, 0.0) and _near(aabb.end.y, 1.0), "spans the width, floor to top")
	t.ok(aabb.position.z >= dr.x - 1e-5 and aabb.end.z <= dr.y + 1e-5, "within its depth range")
	t.eq(m.surface_get_array_index_len(0) / 3, tris[1], "triangles() = the mesh's")
	var huge := S.normalize({"type": "drape", "size_m": [100.0, 50.0], "fullness": 200.0, "pleat_m": 0.08})
	t.ok(D.profile(huge, 8).size() <= D.MAX_COLS + 1, "a 100 m drape at 8 cm pleats is capped at %d columns" % D.MAX_COLS)


func test_seeded_stable_and_own_per_id() -> void:
	var a := S.normalize({"id": "drape_1", "type": "drape"})
	var b := S.normalize({"id": "drape_2", "type": "drape"})
	t.eq(D.nodes(a), D.nodes(a.duplicate(true)), "same id → the same folds every time")
	t.ok(D.nodes(a) != D.nodes(b), "another id → its own folds")


func test_skirt_under_a_wall_at_the_origin() -> void:
	var w := S.normalize({"id": "led_wall_1", "type": "led_wall", "panels": [10, 6], "position": [0.0, 1.0, 0.0]})
	var k := S.skirt_under(w, 0.0, [w])
	t.eq([k.type, k.id, k.name, k.color], ["drape", "drape_1", "LED wall skirt", "#151515"], "a black drape")
	t.ok(_near(k.size_m[0], 5.1) and _near(k.size_m[1], 1.0), "5 m wall + 5 cm each side, floor to the wall's bottom")
	t.eq([k.fullness, k.pleat_m], S.SKIRT_FOLDS, "skirt folds")
	t.eq(k.rotation, [0.0, 0.0, 0.0], "faces the audience with the wall")
	t.ok(_near(float(k.position[2]) + D.depth_range(k).x, S.SKIRT_GAP, 1e-3), "back of the folds 2 cm in front of the face")
	t.ok(_near(float(k.position[1]), 0.0) and _near(float(k.position[0]), 0.0), "on the floor, centred")
	t.eq(S.skirt_under(w, 1.0), {}, "no room under a wall standing on the floor")
	t.eq(S.skirt_under(k, 0.0), {}, "no skirt under a drape")


func test_skirt_under_the_hilton_wall() -> void:
	var w := _hilton_wall()
	var k := S.skirt_under(w, 0.239, [w])
	t.ok(_near(k.size_m[0], 15.1) and _near(k.size_m[1], 1.0), "15.1 × 1.0 m (the hand-built one's size)")
	t.eq(k.rotation, [0.0, -90.0, 0.0], "turned with the wall (facing −X)")
	t.ok(_near(float(k.position[1]), 0.239) and _near(float(k.position[2]), 3.5, 1e-3), "floor 0.239, centred at z 3.5")
	var dr := D.depth_range(k)
	var back := float(k.position[0]) - dr.x  # local +Z = world −X
	var front := float(k.position[0]) - dr.y
	t.ok(_near(back, 12.68, 1e-3), "folds' back 2 cm in front of the face x 12.7 (%.4f)" % back)
	t.ok(front > 12.555, "folds' front stays behind the stage edge x 12.55 (%.4f)" % front)
	var pts := S.skirt_probe_points(w)
	t.eq(pts.size(), 5, "five floor probes")
	t.ok(pts.all(func(p: Vector3) -> bool: return _near(p.y, 1.219) and p.x < 12.7 and p.x > 12.55 and absf(p.z - 3.5) < 7.5), "under the wall's bottom, in front of the face")


func test_skirt_under_a_tv_and_floor_of() -> void:
	var tv := S.normalize({"type": "tv", "id": "tv_1", "diagonal_in": 65, "bezel_mm": 10, "position": [0.0, 1.0, 0.0]})
	var k := S.skirt_under(tv, 0.0)
	t.ok(_near(k.size_m[1], 0.99) and _near(k.size_m[0], S.size_m(tv).x + 0.02 + 0.1, 1e-3), "a TV's bezel counts")
	t.eq(S.floor_of([0.2, NAN, 0.25, 0.24, 3.0], 9.0), 0.25, "median of the hits (NAN skipped, an outlier ignored)")
	t.eq(S.floor_of([NAN, NAN], 0.639), 0.639, "nothing hit → the fallback")


func test_array_duplicate_and_template() -> void:
	var d := S.normalize({"id": "drape_1", "type": "drape", "name": "Drape 1", "size_m": [4.0, 3.0]})
	var copies := S.array_copies(d, 2, 0.5, [d])
	t.eq(copies.map(func(c: Dictionary) -> String: return c.id), ["drape_2", "drape_3"], "new ids")
	t.ok(_near(float(copies[1].position[0]), 9.0), "4 m + 0.5 m gap per step")
	t.ok(copies.all(func(c: Dictionary) -> bool: return c.type == "drape" and not c.has("source")), "still drapes, no source")
	var tpl := S.template("wall_skirt")
	t.eq(tpl.map(func(o: Dictionary) -> String: return o.type), ["led_wall", "drape"], "LED wall + skirt")
	t.ok(_near(float(tpl[1].position[1]) + float(tpl[1].size_m[1]), S.bottom_y(tpl[0])), "the skirt reaches the wall's bottom edge")


func test_not_a_screen_for_the_audience_side() -> void:
	var grid := {"width": 10.0, "depth": 6.0, "x_offset": 0.0, "y_offset": 3.0}
	var wall := S.normalize({"type": "led_wall", "panels": [10, 6]})
	var side := S.normalize({"id": "drape_1", "type": "drape", "size_m": [30.0, 4.0], "rotation": [0, 90, 0]})
	t.eq(A.audience(grid, [wall, side]).dir, A.audience(grid, [wall]).dir, "a 30 m drape facing +X does not turn the audience")
	t.eq(A.audience(grid, [side]).from, "grid", "drapes alone are no audience evidence")
	var pv := {"previs": {"stage": {"objects": [wall, S.normalize({"type": "drape", "size_m": [2.0, 8.0], "position": [0, 0, 1]})]}}}
	t.ok(VP.stage_box(pv).end.y >= 8.0 - 1e-4, "a drape is framed with the stage (View presets)")


func test_builder_draws_a_drape_without_a_surface() -> void:
	var b := B.new(func(_role: String) -> Texture2D: return null)
	var wall := S.new_object("led_wall")
	var d := S.normalize({"id": "drape_1", "type": "drape", "rotation": [0, 90, 0]})
	b.set_objects([wall, d])
	var ms: Array = b.node_for("drape_1").find_children("*", "MeshInstance3D", true, false)
	t.eq(ms.size(), 1, "one cloth mesh")
	var mat := (ms[0] as MeshInstance3D).material_override as ShaderMaterial
	t.ok(mat != null and mat.shader.resource_path.ends_with("drape.gdshader"), "drape shader")
	t.eq(mat.get_shader_parameter("albedo"), Color.html("#151515"), "its colour")
	t.ok(not b._mats.has("drape_1"), "no LED material, no source applied")
	t.ok(is_equal_approx(b.front_yaw(), -0.35), "Fit faces the wall's picture, not the drape turned 90°")
	d["color"] = "#5a1622"
	b.upsert(d)
	var m2 := ((b.node_for("drape_1").find_children("*", "MeshInstance3D", true, false)[0]) as MeshInstance3D).material_override as ShaderMaterial
	t.eq(m2.get_shader_parameter("albedo"), Color.html("#5a1622"), "a colour edit rebuilds")
	b.free()


func test_pick_tests_the_object_frame() -> void:
	var b := B.new(func(_role: String) -> Texture2D: return null)
	t.root.add_child(b)
	await t.process_frame
	# a 10 m drape turned 45°: its world AABB is a 7 × 7 m square in plan, the cloth only a diagonal line through it
	var d := S.normalize({"id": "drape_1", "type": "drape", "size_m": [10.0, 2.0], "rotation": [0, 45, 0]})
	b.set_objects([d])
	t.eq(b.pick_ray(Vector3(2, 5, -2), Vector3.DOWN), "drape_1", "a ray onto the cloth picks it")
	t.eq(b.pick_ray(Vector3(2, 5, 2), Vector3.DOWN), "", "a ray inside the world box but 2.8 m off the cloth does not")
	b.free()


func test_delete_takes_the_selection_box_with_it() -> void:
	var panel := FileAccess.get_file_as_string("res://features/previs/stage_panel.gd")
	t.ok(panel.contains("\tbuilder.remove(_selected)\n\t_selected = \"\"\n\tselection_changed.emit(\"\")"), "Delete clears the 3D selection box")


func test_floor_under_a_skirt_goes_through_legs_not_decks() -> void:
	var U := preload("res://features/previs/drape_ui.gd")
	t.ok(is_nan(U.floor_from_hits([])), "no hit")
	# Hilton: the wall's legs (a 4 cm brace at 0.32, a 1 cm foot plate at 0.24) over a floor nothing draws → the plate's bottom
	var legs := [{"y": 0.319, "ny": 1.0}, {"y": 0.279, "ny": -1.0}, {"y": 0.249, "ny": 1.0}, {"y": 0.239, "ny": -1.0}, {"y": 0.8, "ny": 0.0}]
	t.ok(absf(U.floor_from_hits(legs) - 0.239) < 1e-6, "through the legs to their feet")
	t.ok(absf(U.floor_from_hits(legs + [{"y": 0.239, "ny": 1.0}]) - 0.239) < 1e-6, "the hall floor under them")
	t.ok(absf(U.floor_from_hits([{"y": 0.239, "ny": 1.0}] + legs) - 0.239) < 1e-6, "whatever order the meshes answer in")
	t.ok(absf(U.floor_from_hits([{"y": 0.639, "ny": 1.0}, {"y": 0.239, "ny": -1.0}, {"y": 0.239, "ny": 1.0}]) - 0.639) < 1e-6, "a 40 cm deck is a floor")
	t.ok(absf(U.floor_from_hits([{"y": 0.0, "ny": 1.0}]) - 0.0) < 1e-6, "a one-sided floor")
	# the real Hilton legs (nogi.glb): a base rail 0.239..0.319 drawn without its underside, nothing under it
	t.ok(absf(U.floor_from_hits([{"y": 0.319, "ny": 1.0, "bottom": 0.239}]) - 0.239) < 1e-6, "an open-bottomed rail: its mesh's bottom")
	t.ok(absf(U.floor_from_hits([{"y": 0.639, "ny": 1.0, "bottom": 0.239}]) - 0.639) < 1e-6, "an open-bottomed deck is still a deck")
	t.ok(absf(U.floor_from_hits([{"y": 0.647, "ny": 1.0, "bottom": 0.639}, {"y": 0.639, "ny": 1.0, "bottom": 0.239}]) - 0.639) < 1e-6, "carpet on a deck")
	var mvr := FileAccess.get_file_as_string("res://features/previs/mvr_scene.gd")
	t.ok(mvr.contains("return DrapeUi.floor_from_hits(hits)"), "the MVR probe collects every face the ray meets")
