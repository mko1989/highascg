extends RefCounted
## WO-786 — the 3D views' haze: the fog it puts in an Environment and the toolbar picker's levels.

const Haze := preload("res://features/previs/haze.gd")
var t


func test_fog_follows_the_level() -> void:
	var env := Environment.new()
	Haze.apply_env(env, 0.0)
	t.ok(not env.volumetric_fog_enabled, "no haze = no fog")
	Haze.apply_env(env, 0.35)
	var light := env.volumetric_fog_density
	t.ok(env.volumetric_fog_enabled and light > 0.0, "light haze = fog on")
	Haze.apply_env(env, 1.0)
	t.ok(env.volumetric_fog_density > light, "thick haze is denser")
	t.ok(env.volumetric_fog_density < 0.01, "still thin enough for the LED walls to stay bright")
	t.eq(env.volumetric_fog_ambient_inject, 0.0, "only the heads light it, not the ambient")
	Haze.apply_env(null, 1.0)  # a view not in a world yet: nothing to do


func test_picker_levels() -> void:
	var o := Haze.picker()
	t.eq(o.item_count, Haze.LEVELS.size(), "one item per level")
	t.eq(o.get_item_text(0), "No haze", "off first")
	t.eq(float(Haze.LEVELS[0][1]), 0.0, "the first level is off")
	o.free()
