extends RefCounted
## WO-892 — render quality of the 3D views (Previs, Live 3D, the tracking camera overlay, the VR mirror). One level for
## every view and per client (ui.cfg [previs] quality, never in the project), applied live: each view's SubViewport,
## the stage Environment / sun / floor (previs_stage.gd), the rig's cones and spot shadows (fixtures_3d.gd + beam_cone.gd),
## the LED shader, and the few RenderingServer settings that are global (apply_globals).
## Low = what the views looked like before, plus debanding. Medium (default) = Low + SMAA, the beam cones fading by scene
## depth and when the camera is inside, 48-segment cones, the LED anti-moire taps, a glossier floor, a 4096 shadow atlas.
## High adds MSAA 4x, SSAO, sun shadows, floor reflections (SSR), LED bloom, spot shadows (16), a finer haze fog.
## Ultra adds 1.5x supersampling, SSIL, higher SSAO / SSR, 32 spot shadows on an 8192 atlas, a 128 fog grid.
## No TAA / FSR2 (they ghost on video and beams), no SDFGI. The GPU is shared with Caspar on air: the picker shows the
## measured GPU time of the views. Macs and the Compatibility renderer are held at Low (WO-689).

signal changed(level: int)

const UiCfg := preload("res://core/ui_cfg.gd")
const LED_PATH := "res://features/previs/led_screen.gdshader"

const NAMES := ["Low", "Medium", "High", "Ultra"]
const DEFAULT := 1
const LOW := {
	"msaa": 0, "smaa": false, "deband": true, "scale": 1.0, "atlas": 2048,
	"ssao": false, "ssao_q": 2, "ssao_half": true, "ssil": false, "ssr": false, "ssr_q": 1,
	"glow_thr": 1.0, "sun_splits": 0, "floor_rough": 1.0, "spot_shadows": 0,
	"fog": 64, "fog_filter": true, "soft": 2, "dir_atlas": 4096,
	"soft_cone": false, "cone_segs": 24, "led_aa": false,
}
const MEDIUM := {"smaa": true, "atlas": 4096, "soft_cone": true, "cone_segs": 48, "led_aa": true, "floor_rough": 0.4}
const HIGH := {
	"msaa": 4, "ssao": true, "ssr": true, "ssr_q": 2, "glow_thr": 0.85, "sun_splits": 2, "floor_rough": 0.35,
	"spot_shadows": 16, "fog": 96, "soft": 3,
}
const ULTRA := {
	"scale": 1.5, "atlas": 8192, "ssao_q": 3, "ssao_half": false, "ssil": true, "ssr_q": 3,
	"spot_shadows": 32, "fog": 128, "soft": 4, "dir_atlas": 8192,
}
const TIPS := [
	"Cheapest: the views as they were, plus debanding.",
	"Smooth edges, soft beams, calm LED walls. Default.",
	"Adds MSAA 4x, ambient occlusion, sun and spot shadows, floor reflections, LED bloom.",
	"Not while on air: 1.5x supersampling, 32 spot shadows, the finest haze. Heavy on the GPU the playout shares.",
]

static var _shared: RefCounted
static var _led: Shader
static var _led_base := ""
static var _applied_globals := {}
static var _meters: Array = []  # WeakRef → Viewport whose GPU time the picker shows

var level := DEFAULT  # what the operator picked (the effective level may be lower: max_level)


static func shared() -> RefCounted:
	if _shared == null:
		_shared = new()
		var cfg := ConfigFile.new()
		cfg.load(UiCfg.PATH)
		_shared.level = level_of(str(cfg.get_value("previs", "quality", NAMES[DEFAULT])))
		apply_globals(_shared.current())
	return _shared


## "high" / "High" → 2; unknown → the default.
static func level_of(name: String) -> int:
	var i := NAMES.map(func(n: String) -> String: return n.to_lower()).find(name.to_lower())
	return i if i >= 0 else DEFAULT


## The highest level this machine takes: Macs and the Compatibility renderer stay at Low (WO-689: the Mac crash).
static func max_level() -> int:
	var forward := RenderingServer.get_current_rendering_method() == "forward_plus"
	return NAMES.size() - 1 if forward and OS.get_name() != "macOS" else 0


## The settings of a level: Low, with each higher level's changes laid over it.
static func preset(lv: int) -> Dictionary:
	var p := LOW.duplicate()
	for i in clampi(lv, 0, NAMES.size() - 1):
		p.merge([MEDIUM, HIGH, ULTRA][i], true)
	return p


## The settings in force: the picked level, held to max_level().
func current() -> Dictionary:
	return preset(mini(level, max_level()))


func set_level(lv: int, path := UiCfg.PATH) -> void:
	level = clampi(lv, 0, NAMES.size() - 1)
	UiCfg.save_value("previs", "quality", NAMES[level].to_lower(), path)
	apply_globals(current())
	changed.emit(level)


## A 3D view's SubViewport: anti-aliasing, debanding, supersampling and the positional shadow atlas. `compact` (the
## camera overlay, the VR mirror) leaves out supersampling and keeps the atlas small — they are extra viewports of the same world.
static func apply_viewport(vp: Viewport, p: Dictionary, compact := false) -> void:
	if vp == null:
		return
	vp.msaa_3d = {0: Viewport.MSAA_DISABLED, 2: Viewport.MSAA_2X, 4: Viewport.MSAA_4X}.get(int(p.msaa), Viewport.MSAA_DISABLED)
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_SMAA if p.smaa else Viewport.SCREEN_SPACE_AA_DISABLED
	vp.use_debanding = p.deband
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.scaling_3d_scale = 1.0 if compact or vp.use_xr else float(p.scale)
	vp.positional_shadow_atlas_size = mini(int(p.atlas), 4096) if compact else int(p.atlas)


## SSAO / SSIL / SSR and the glow threshold of a stage Environment. `glow` false (the camera overlay) keeps glow off.
static func apply_env(env: Environment, p: Dictionary, glow := true) -> void:
	if env == null:
		return
	env.ssao_enabled = p.ssao
	env.ssao_radius = 1.0
	env.ssao_intensity = 2.0
	env.ssao_light_affect = 0.0
	env.ssil_enabled = p.ssil
	env.ssil_radius = 5.0
	env.ssil_intensity = 1.0
	env.ssr_enabled = p.ssr
	env.ssr_max_steps = 64
	env.ssr_depth_tolerance = 0.2
	env.glow_enabled = glow
	env.glow_hdr_threshold = float(p.glow_thr)


static func apply_floor(mat: StandardMaterial3D, p: Dictionary) -> void:
	if mat != null:
		mat.roughness = float(p.floor_rough)  # a glossy floor shows the LED walls and the beams' pools (with SSR)


static func apply_sun(sun: DirectionalLight3D, p: Dictionary) -> void:
	if sun == null:
		return
	sun.shadow_enabled = int(p.sun_splits) > 0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 60.0
	sun.directional_shadow_blend_splits = true


## How many spot lights of the rig cast a shadow (gobo spots always do — their projection needs one).
static func spot_shadow_budget(p: Dictionary) -> int:
	return int(p.spot_shadows)


## RenderingServer settings that are global to every viewport, and the LED shader. Only what changed is sent.
static func apply_globals(p: Dictionary) -> void:
	var g := {"ssao": [int(p.ssao_q), bool(p.ssao_half)], "ssr": int(p.ssr_q), "soft": int(p.soft), "dir": int(p.dir_atlas),
			"fog": [int(p.fog), bool(p.fog_filter)], "led": bool(p.led_aa)}
	if g.hash() == _applied_globals.hash():
		return
	_applied_globals = g
	RenderingServer.environment_set_ssao_quality(int(p.ssao_q) as RenderingServer.EnvironmentSSAOQuality, bool(p.ssao_half), 0.5, 2, 50.0, 300.0)
	RenderingServer.environment_set_ssr_roughness_quality(int(p.ssr_q) as RenderingServer.EnvironmentSSRRoughnessQuality)
	RenderingServer.positional_soft_shadow_filter_set_quality(int(p.soft) as RenderingServer.ShadowQuality)
	RenderingServer.directional_soft_shadow_filter_set_quality(int(p.soft) as RenderingServer.ShadowQuality)
	RenderingServer.directional_shadow_atlas_set_size(int(p.dir_atlas), true)
	RenderingServer.environment_set_volumetric_fog_volume_size(int(p.fog), int(p.fog))
	RenderingServer.environment_set_volumetric_fog_filter_active(bool(p.fog_filter))
	apply_led(bool(p.led_aa))


## The LED walls' shader (stage_builder.gd / mvr_scene.gd preload this same cached resource).
static func led_shader() -> Shader:
	if _led == null:
		_led = load(LED_PATH) as Shader  # held here: the resource cache alone would drop an edited copy
	return _led


## The LED walls' anti-moire taps: the shader keeps `#define LED_AA` (on); off removes it. Every LED material shares the shader.
static func apply_led(aa: bool) -> void:
	var sh: Shader = led_shader()
	if _led_base == "":
		_led_base = sh.code
	sh.code = _led_base if aa else _led_base.replace("#define LED_AA\n", "")


## A view's SubViewport whose measured GPU time the picker shows (while it renders).
static func register_meter(vp: Viewport) -> void:
	if vp != null and not _meters.any(func(w: WeakRef) -> bool: return w.get_ref() == vp):
		_meters.append(weakref(vp))


## Summed GPU ms of the registered views that are rendering now (0 when none, or where the renderer does not measure).
static func gpu_ms() -> float:
	var total := 0.0
	_meters = _meters.filter(func(w: WeakRef) -> bool: return w.get_ref() != null)
	for w: WeakRef in _meters:
		var sv := w.get_ref() as SubViewport
		if sv != null and sv.render_target_update_mode != SubViewport.UPDATE_DISABLED and sv.is_inside_tree():
			RenderingServer.viewport_set_measure_render_time(sv.get_viewport_rid(), true)
			total += RenderingServer.viewport_get_measured_render_time_gpu(sv.get_viewport_rid())
	return total


## The toolbar picker: Low / Medium / High / Ultra, and the views' measured GPU time beside it.
static func picker() -> Control:
	var box := HBoxContainer.new()
	var o := OptionButton.new()
	o.tooltip_text = "Render quality of the 3D views (this client only). Applies at once."
	for i in NAMES.size():
		o.add_item("Quality: " + NAMES[i])
		o.set_item_tooltip(i, TIPS[i])
		o.set_item_disabled(i, i > max_level())
	o.select(mini(shared().level, max_level()))
	o.item_selected.connect(func(i: int) -> void: shared().set_level(i))
	box.add_child(o)
	var lab := Label.new()
	lab.tooltip_text = "Measured GPU time to draw the 3D views. The GPU is shared with the playout."
	lab.modulate = Color(1, 1, 1, 0.6)
	box.add_child(lab)
	var t := Timer.new()
	t.wait_time = 1.0
	t.autostart = true
	t.timeout.connect(func() -> void:
		var ms := gpu_ms()
		lab.text = "GPU %.1f ms" % ms if ms > 0.0 else "")
	box.add_child(t)
	return box
