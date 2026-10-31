extends RefCounted
## WO-892 — the previs render quality: the preset table, what each apply function sets, the stored level, the cone shader variants.

const Quality := preload("res://features/previs/previs_quality.gd")
const Cone := preload("res://features/previs/fixtures/beam_cone.gd")
var t


func test_presets_grow_from_low() -> void:
	var low := Quality.preset(0)
	t.eq(low, Quality.LOW, "Low is the base table")
	t.ok(low.deband and low.msaa == 0 and not low.smaa and not low.ssao and low.spot_shadows == 0, "Low = today's look + debanding")
	var med := Quality.preset(1)
	t.ok(med.smaa and med.msaa == 0 and med.atlas == 4096 and med.soft_cone and med.cone_segs == 48 and med.led_aa, "Medium = SMAA + the quick wins")
	t.ok(med.floor_rough < 1.0 and not med.ssao and not med.ssr, "Medium: glossier floor, no screen-space effects")
	var high := Quality.preset(2)
	t.ok(high.msaa == 4 and high.smaa and high.ssao and high.ssao_half and high.ssr and high.sun_splits == 2, "High: MSAA 4x, SSAO half, SSR, sun shadow")
	t.ok(high.spot_shadows == 16 and high.fog == 96 and is_equal_approx(high.glow_thr, 0.85) and high.soft == 3, "High: 16 spot shadows, 96 fog, bloom, soft filter medium")
	var ultra := Quality.preset(3)
	t.ok(is_equal_approx(ultra.scale, 1.5) and ultra.ssil and not ultra.ssao_half and ultra.spot_shadows == 32 and ultra.atlas == 8192 and ultra.fog == 128, "Ultra: 1.5x, SSIL, 32 spot shadows, 8192 atlas, 128 fog")
	t.ok(ultra.msaa == 4 and ultra.ssao and ultra.sun_splits == 2, "Ultra keeps everything High has")
	t.eq(Quality.preset(-3), Quality.preset(0), "clamped low")
	t.eq(Quality.preset(99), Quality.preset(3), "clamped high")
	t.eq(Quality.LOW.keys().size(), Quality.preset(3).keys().size(), "no level adds a key Low lacks")
	t.eq(Quality.DEFAULT, 1, "Medium is the default")


func test_level_names() -> void:
	t.eq(Quality.level_of("high"), 2)
	t.eq(Quality.level_of("Ultra"), 3)
	t.eq(Quality.level_of("nonsense"), Quality.DEFAULT, "unknown → default")


func test_viewport_settings() -> void:
	var sv := SubViewport.new()
	Quality.apply_viewport(sv, Quality.preset(3))
	t.eq(sv.msaa_3d, Viewport.MSAA_4X)
	t.eq(sv.screen_space_aa, Viewport.SCREEN_SPACE_AA_SMAA)
	t.ok(sv.use_debanding, "debanding on")
	t.ok(is_equal_approx(sv.scaling_3d_scale, 1.5), "supersampled")
	t.eq(sv.positional_shadow_atlas_size, 8192)
	Quality.apply_viewport(sv, Quality.preset(3), true)
	t.ok(is_equal_approx(sv.scaling_3d_scale, 1.0) and sv.positional_shadow_atlas_size == 4096, "compact (overlay / VR mirror): no supersampling, atlas <= 4096")
	Quality.apply_viewport(sv, Quality.preset(0))
	t.eq(sv.msaa_3d, Viewport.MSAA_DISABLED)
	t.eq(sv.screen_space_aa, Viewport.SCREEN_SPACE_AA_DISABLED)
	t.eq(sv.positional_shadow_atlas_size, 2048)
	Quality.apply_viewport(null, Quality.preset(0))  # nothing to do
	sv.free()


func test_environment_sun_floor() -> void:
	var env := Environment.new()
	Quality.apply_env(env, Quality.preset(3))
	t.ok(env.ssao_enabled and env.ssil_enabled and env.ssr_enabled, "Ultra: SSAO + SSIL + SSR")
	t.ok(env.glow_enabled and is_equal_approx(env.glow_hdr_threshold, 0.85), "LED bloom")
	Quality.apply_env(env, Quality.preset(1))
	t.ok(not env.ssao_enabled and not env.ssil_enabled and not env.ssr_enabled and is_equal_approx(env.glow_hdr_threshold, 1.0), "Medium: none of it")
	Quality.apply_env(env, Quality.preset(3), false)
	t.ok(not env.glow_enabled, "the camera overlay keeps glow off")
	Quality.apply_env(null, Quality.preset(3))
	var sun := DirectionalLight3D.new()
	Quality.apply_sun(sun, Quality.preset(2))
	t.ok(sun.shadow_enabled and sun.directional_shadow_mode == DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS, "High: sun shadow, 2 splits")
	Quality.apply_sun(sun, Quality.preset(1))
	t.ok(not sun.shadow_enabled, "Medium: no sun shadow")
	sun.free()
	var m := StandardMaterial3D.new()
	Quality.apply_floor(m, Quality.preset(0))
	t.ok(is_equal_approx(m.roughness, 1.0), "Low: the floor as before")
	Quality.apply_floor(m, Quality.preset(2))
	t.ok(m.roughness < 0.5, "High: glossy floor")
	t.eq(Quality.spot_shadow_budget(Quality.preset(0)), 0)
	t.eq(Quality.spot_shadow_budget(Quality.preset(2)), 16)
	t.eq(Quality.spot_shadow_budget(Quality.preset(3)), 32)


func test_led_shader_aa_follows_the_level() -> void:
	Quality.apply_globals(Quality.preset(0))
	t.ok(not Quality.led_shader().code.contains("#define LED_AA"), "Low strips the anti-moire taps")
	Quality.apply_globals(Quality.preset(1))
	t.ok(Quality.led_shader().code.contains("#define LED_AA") and Quality.led_shader().code.contains("#ifdef LED_AA"), "Medium has them")
	Quality.apply_globals(Quality.preset(Quality.DEFAULT))


func test_cone_shader_variants() -> void:
	var plain := Cone.code(false)
	var soft := Cone.code(true)
	t.ok(not plain.contains("hint_depth_texture") and not plain.contains("//SOFT"), "Low: today's shader, no depth read")
	t.ok(soft.contains("hint_depth_texture") and not soft.contains("//SOFT") and soft.contains("cam_local"), "Medium+: depth fade + camera-inside fade")
	t.ok(plain.contains("pow(max(1.0 - along, 0.0)") and soft.contains("pow(max(1.0 - along, 0.0)"), "no pow of a negative: MSAA extrapolates `along` past 1 → NaN → glow blobs")
	t.ok(plain.contains("ALPHA = a;") and soft.contains("INV_PROJECTION_MATRIX"), "both end in ALPHA")


func test_cone_apply_sets_shadows_up_to_the_budget() -> void:
	var fx := {}
	for i in 5:
		var sl := SpotLight3D.new()
		fx["f%d" % i] = {"beams": {"b": {"light": sl}}}
	fx["f4"].beams.b.light.light_projector = PlaceholderTexture2D.new()  # a gobo spot
	var cone := CylinderMesh.new()
	var sh := Shader.new()
	var p := Quality.preset(2)
	p.spot_shadows = 2
	Cone.apply(fx, cone, sh, 2, p)
	var on := fx.values().map(func(f: Dictionary) -> bool: return f.beams.b.light.shadow_enabled)
	t.eq(on, [true, true, false, false, true], "first 2 spots + the gobo spot cast shadows")
	t.eq(cone.radial_segments, 48)
	t.ok(sh.code.contains("hint_depth_texture"), "soft cone shader")
	Cone.apply(fx, cone, sh, 0, Quality.preset(0))
	on = fx.values().map(func(f: Dictionary) -> bool: return f.beams.b.light.shadow_enabled)
	t.eq(on, [false, false, false, false, true], "Low: only the gobo spot")
	t.eq(cone.radial_segments, 24)
	t.ok(not sh.code.contains("hint_depth_texture"), "plain cone shader")
	for f in fx.values():
		(f.beams.b.light as Node).free()


func test_level_is_stored_per_client() -> void:
	var q := Quality.shared()
	var was: int = q.level
	var path := "user://test_previs_quality.cfg"  # not the real ui.cfg
	q.set_level(2, path)
	var cfg := ConfigFile.new()
	cfg.load(path)
	t.eq(cfg.get_value("previs", "quality"), "high", "ui.cfg [previs] quality, a string")
	t.eq(cfg.get_sections(), PackedStringArray(["previs"]), "only the client file's [previs] section, nothing project-side")
	t.eq(q.current().msaa, 4 if Quality.max_level() >= 2 else 0, "current() is held to the machine's maximum")
	q.set_level(was, path)
	t.eq(q.level, was)
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


func test_picker_has_a_level_per_item() -> void:
	var box := Quality.picker()
	var o := box.get_child(0) as OptionButton
	t.eq(o.item_count, 4)
	t.ok(o.get_item_tooltip(3).contains("Not while on air"), "Ultra warns")
	box.free()
