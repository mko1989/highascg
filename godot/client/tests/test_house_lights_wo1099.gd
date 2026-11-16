extends RefCounted
## WO-1099 — House lights in the 3D views: the per-client slider level (ui.cfg [previs] house_lights, default 100 %),
## its perceptual curve, the label toggle back to the last level, what follows
## it (the stage's ambient + sun, a venue's emissive materials, the avatars' self-light down to a floor) and what does
## not (the rig, LED pictures, the Camera overlay's own fill), and the rig's real spot lights going to the brightest
## beams up to each quality level's cap.

const House := preload("res://features/previs/house_lights.gd")
const Quality := preload("res://features/previs/previs_quality.gd")
const Cone := preload("res://features/previs/fixtures/beam_cone.gd")
var t


func test_default_on_and_stored_per_client() -> void:
	var path := "user://test_house_lights.cfg"  # not the real ui.cfg
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	var cfg := ConfigFile.new()
	t.eq(cfg.load(path) != OK, true, "no file yet")
	t.eq(House.new().level, 1.0, "default: on — nothing changes for existing users")
	var h: RefCounted = House.new()
	var got := []
	h.changed.connect(func(v: float) -> void: got.append(v))
	h.set_level(0.0, true, path)
	t.eq(got, [0.0], "changed fires")
	cfg.load(path)
	t.eq(cfg.get_value("previs", "house_lights"), 0.0, "stored in [previs] house_lights")
	h.set_level(7.0, true, path)
	t.eq(h.level, 1.0, "clamped")
	h.set_level(0.42, false, path)
	cfg.load(path)
	t.eq([h.level, cfg.get_value("previs", "house_lights")], [0.42, 1.0], "a drag step is live, not saved")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


func test_toggle_remembers_the_last_level() -> void:
	var path := "user://test_house_lights.cfg"
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	var h: RefCounted = House.new()
	h.set_level(0.35, true, path)
	h.toggle(path)
	t.eq(h.level, 0.0, "the label: off in one click")
	h.toggle(path)
	t.eq(h.level, 0.35, "… and back to where it was")
	h.set_level(0.0, true, path)
	h.toggle(path)
	t.eq(h.level, 0.35, "dragged to 0: the label still returns to the last lit level")
	var cfg := ConfigFile.new()
	cfg.load(path)
	t.eq(cfg.get_value("previs", "house_last"), 0.35, "remembered across launches ([previs] house_last)")
	var fresh: RefCounted = House.new()
	fresh.toggle(path)
	fresh.toggle(path)
	t.eq(fresh.level, 1.0, "nothing remembered: back to full")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


func test_curve_is_perceptual_and_smooth() -> void:
	t.eq([House.gain(0.0), House.gain(1.0)], [0.0, 1.0], "the ends: dark and as before")
	var half := House.gain(0.5)
	t.ok(half > 0.2 and half < 0.24, "50 %% = ~22 %% linear light, ~half as bright on an sRGB screen (%f)" % half)
	var prev := 0.0
	var max_step := 0.0
	for k in range(1, 101):
		var g := House.gain(k / 100.0)
		if g <= prev:
			t.ok(false, "strictly rising at %d %%" % k)
		max_step = maxf(max_step, g - prev)
		prev = g
	t.ok(max_step < 0.025, "no 1 %% step jumps (largest %f)" % max_step)
	t.ok(is_equal_approx(House.gain(-1.0), 0.0) and is_equal_approx(House.gain(2.0), 1.0), "clamped")


func test_stage_env_and_sun_follow() -> void:
	var env := Environment.new()
	var sun := DirectionalLight3D.new()
	House.apply_stage(env, sun, 1.0)
	t.ok(sun.visible and is_equal_approx(sun.light_energy, House.SUN_ENERGY) and env.ambient_light_energy == 1.0, "on = as before")
	House.apply_stage(env, sun, 0.0)
	t.ok(not sun.visible and env.ambient_light_energy == 0.0, "off: no sun, no ambient fill")
	House.apply_stage(env, sun, 0.5)
	t.ok(sun.visible and is_equal_approx(sun.light_energy, House.SUN_ENERGY * House.gain(0.5)), "the sun follows the curve")
	t.ok(is_equal_approx(env.ambient_light_energy, House.gain(0.5)), "the ambient with it")
	House.apply_stage(env, sun, 0.01)
	t.ok(sun.visible and sun.light_energy < 0.001, "near 0: still on, energy ~0 — hiding it at 0 does not pop")
	House.apply_stage(null, null, 0.0)  # a view without its world yet
	sun.free()


func test_stage_applies_the_shared_level() -> void:
	var src := FileAccess.get_file_as_string("res://features/previs/previs_stage.gd")
	t.ok(src.contains("House.shared().changed.connect(_on_house)") and src.contains("House.apply_stage(environment, sun, h)"), "every stage follows")
	t.ok(src.contains("get_tree().node_added.connect(_on_node_added)"), "meshes that load later take the level")
	t.ok(src.contains("_glow = House.collect(self)") and src.contains("House.dim(_glow, h)"), "a slider step writes numbers, no tree walk")
	t.ok(src.contains("m.set_meta(House.SHOW_LIGHT, true)"), "a GLB screen's picture is show light")
	t.ok(not src.contains("sun.light_energy = 0.6"), "the sun's energy comes from House.SUN_ENERGY")


func test_venue_emission_dims_and_restores() -> void:
	var root := Node3D.new()
	var venue := MeshInstance3D.new()
	venue.mesh = BoxMesh.new()
	var glow := StandardMaterial3D.new()
	glow.emission_enabled = true
	glow.emission_energy_multiplier = 2.0
	venue.material_override = glow
	root.add_child(venue)
	var plain := StandardMaterial3D.new()  # not emissive: untouched
	var wall := MeshInstance3D.new()
	wall.mesh = BoxMesh.new()
	wall.set_surface_override_material(0, plain)
	root.add_child(wall)
	var pic := StandardMaterial3D.new()  # an LED picture
	pic.emission_enabled = true
	pic.set_meta(House.SHOW_LIGHT, true)
	var screen := MeshInstance3D.new()
	screen.mesh = BoxMesh.new()
	screen.material_override = pic
	root.add_child(screen)
	var rig := Node3D.new()  # fixtures_3d.gd: the lens is show light
	rig.set_meta(House.SHOW_LIGHT, true)
	var lens := MeshInstance3D.new()
	lens.mesh = BoxMesh.new()
	var lmat := StandardMaterial3D.new()
	lmat.emission_enabled = true
	lmat.emission_energy_multiplier = 3.0
	lens.material_override = lmat
	rig.add_child(lens)
	root.add_child(rig)
	var list := House.collect(root)
	t.eq(list.size(), 1, "only the venue glow is house light")
	House.dim(list, 1.0)
	t.ok(not glow.has_meta(House.ORIG), "full house light: nothing touched")
	House.dim(list, 0.0)
	t.eq(glow.emission_energy_multiplier, 0.0, "a venue glow is house light: off")
	t.eq(pic.emission_energy_multiplier, 1.0, "the picture stays")
	t.eq(lmat.emission_energy_multiplier, 3.0, "the rig stays")
	t.ok(House.in_show_light(lens, root) and not House.in_show_light(venue, root))
	House.dim(list, 0.5)
	t.ok(is_equal_approx(glow.emission_energy_multiplier, 2.0 * House.gain(0.5)), "half: the curve's share of the original")
	House.dim(list, 1.0)
	t.eq(glow.emission_energy_multiplier, 2.0, "on: back to the model's own")
	root.free()


func test_avatar_self_light_floor() -> void:
	t.eq(House.self_light(0.3, 1.0, 0.06), 0.3, "on: as before")
	t.eq(House.self_light(0.3, 0.0, 0.06), 0.06, "off: only the readability floor")
	t.eq(House.self_light(0.3, 0.0, 0.9), 0.3, "a floor never lifts it above its own")
	var Avatar := load("res://features/previs/tracking/person_avatar.gd")
	var a: Node3D = Avatar.new()
	a.house(0.0)
	var m: ShaderMaterial = a.mats.top
	t.ok(is_equal_approx(float(m.get_shader_parameter("self_light")), House.shared().avatar_floor), "an avatar follows")
	t.ok(float(m.get_shader_parameter("rim")) < 0.2 * 0.5, "its rim fades too (no glowing figure)")
	a.house(1.0)
	t.ok(is_equal_approx(float(m.get_shader_parameter("self_light")), 0.3) and is_equal_approx(float(m.get_shader_parameter("rim")), 0.2))
	a.free()


func test_overlay_keeps_its_own_fill() -> void:
	t.eq(House.overlay_ambient(1.0), 1.0)
	t.ok(House.overlay_ambient(0.0) > 1.0, "off: more fill standing in for the shared sun")
	var src := FileAccess.get_file_as_string("res://features/previs/tracking/camera_overlay.gd")
	t.ok(src.contains("ambient_light_energy = House.overlay_ambient(h)"), "the Camera overlay does not go dark")


func test_hint() -> void:
	t.eq(House.hint(1.0, 0), "", "on: no line")
	t.eq(House.hint(0.0, 3), "House lights off")
	t.eq(House.hint(0.0, 0), "House lights off — rig dark", "a dark rig with the house off: say it is on purpose")
	t.eq(House.hint(0.5, 0), "House lights 50 %")
	t.eq(House.hint(0.2, 0), "House lights 20 % — rig dark")


func test_light_cap_per_quality() -> void:
	var caps := [0, 1, 2, 3].map(func(lv: int) -> int: return int(Quality.preset(lv).lights))
	t.eq(caps, [24, 48, 64, 96], "Low / Medium / High / Ultra real lights")


func test_pick_gives_the_lights_to_the_brightest_beams() -> void:
	var fx := {}
	var lv := [0.2, 0.0, 0.9, 0.5, 0.9, 0.7]
	for k in lv.size():
		fx["f%d" % k] = {"beams": {"b": {"light": SpotLight3D.new(), "i": lv[k]}}}
	fx["glow"] = {"beams": {"c": {"i": 1.0}}}  # a cell beam: lit, no light of its own
	var lit := Cone.pick(fx, 3, 1)
	t.eq(lit, 6, "lit beams counted (the dark one not)")
	var shown := []
	var shadow := []
	for k in lv.size():
		var sl := fx["f%d" % k].beams.b.light as SpotLight3D
		shown.append(sl.visible)
		shadow.append(sl.shadow_enabled)
	t.eq(shown, [false, false, true, false, true, true], "the 3 brightest (0.9, 0.9, 0.7)")
	t.eq(shadow, [false, false, true, false, false, false], "the budget's 1 shadow on the first brightest")
	for k in lv.size():
		fx["f%d" % k].beams.b.i = 0.0
	t.eq(Cone.pick(fx, 3, 1), 1, "only the cell beam")
	t.ok(fx.values().slice(0, lv.size()).all(func(f: Dictionary) -> bool: return not (f.beams.b.light as SpotLight3D).visible), "a dark rig: no lights")
	for k in lv.size():
		(fx["f%d" % k].beams.b.light as Node).free()


func test_rig_reports_and_never_dims() -> void:
	var src := FileAccess.get_file_as_string("res://features/previs/fixtures/fixtures_3d.gd")
	t.ok(src.contains("set_meta(House.SHOW_LIGHT, true)"), "the rig is show light")
	t.ok(src.contains("p.i = t.a"), "each beam's intensity for the pick")
	t.ok(not src.contains("sl.visible = lit"), "visibility is the pick's")
	var q := FileAccess.get_file_as_string("res://features/previs/previs_quality.gd")
	t.ok(q.contains("box.add_child(House.control())"), "the slider sits beside the Quality menu")


func test_control_is_a_slider_with_a_toggle() -> void:
	var c := House.control()
	var sl := c.get_node("Level") as HSlider
	var b := c.get_node("Toggle") as Button
	t.eq([sl.min_value, sl.max_value], [0.0, 100.0], "0–100 %")
	t.eq(sl.value, roundf(House.shared().level * 100.0), "shows the level")
	t.ok(b.text.begins_with("House"), "the label")
	t.eq(sl.focus_mode, Control.FOCUS_NONE, "arrows stay with the 3D view")
	c.free()
