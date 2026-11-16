extends RefCounted
## WO-1099 — House lights (owner 16.11: "add the ability to turn off the 'sun' so users can only see the rigs lights"):
## the general light on the room in the 3D views — the stage's ambient fill and its directional "sun" — and the venue's
## own glowing materials (a model's emissive ceiling coffers, chandeliers, practicals: house light too). On (default) =
## the views as they were; Dim; Off = a dark room where only the show lights: the rig's spot lights (real SpotLight3D,
## fixtures_3d.gd + beam_cone.gd pick), their cones and lenses, the LED walls / TVs / projections, the camera cut-outs.
## One level for every 3D view of this client (ui.cfg [previs] house_lights, never in the project), like Quality and
## Haze; the switch is in the Quality menu. The tracking Camera view's stage overlay does not follow it (a geometry aid,
## camera_overlay.gd keeps its own fill). Avatars keep a small self-light floor (ui.cfg [previs] avatar_floor) so a
## presenter outside every beam still reads, without glowing in the dark.

signal changed(level: float)

const UiCfg := preload("res://core/ui_cfg.gd")
const LEVELS := [["On", 1.0], ["Dim", 0.3], ["Off", 0.0]]
const SUN_ENERGY := 0.6  ## the stage's sun at full house light (previs_stage.gd)
const OVERLAY_FILL := 1.5  ## extra ambient energy the Camera overlay takes when the room's sun is off
const AVATAR_FLOOR := 0.06  ## avatar self-light with the house lights off (theirs is 0.3 when on)
const SHOW_LIGHT := "show_light"  ## node or material meta: show light — never dimmed (the rig, LED pictures)
const ORIG := "house_emission"  ## material meta: its emission energy at full house light

static var _shared: RefCounted

var level := 1.0
var avatar_floor := AVATAR_FLOOR
var lit := {}  # rig (fixtures_3d.gd) instance id → its lit beams now, for hint()


static func shared() -> RefCounted:
	if _shared == null:
		_shared = new()
		var cfg := ConfigFile.new()
		cfg.load(UiCfg.PATH)
		_shared.level = clampf(float(cfg.get_value("previs", "house_lights", 1.0)), 0.0, 1.0)
		_shared.avatar_floor = clampf(float(cfg.get_value("previs", "avatar_floor", AVATAR_FLOOR)), 0.0, 1.0)
	return _shared


func set_level(h: float, path := UiCfg.PATH) -> void:
	level = clampf(h, 0.0, 1.0)
	UiCfg.save_value("previs", "house_lights", level, path)
	changed.emit(level)


## A stage's Environment + sun at house level `h`: the ambient fill and the sun scale with it; at 0 the sun is off.
static func apply_stage(env: Environment, sun: DirectionalLight3D, h: float) -> void:
	if env != null:
		env.ambient_light_energy = h
	if sun != null:
		sun.light_energy = SUN_ENERGY * h
		sun.visible = h > 0.0


## The Camera overlay's own fill: full ambient, plus a share standing in for the shared world's sun when it is off.
static func overlay_ambient(h: float) -> float:
	return 1.0 + OVERLAY_FILL * (1.0 - clampf(h, 0.0, 1.0))


## An avatar's self-light at house level `h`: `base` when on, down to `low` (never above `base`) when off.
static func self_light(base: float, h: float, low: float) -> float:
	return lerpf(minf(low, base), base, clampf(h, 0.0, 1.0))


## Every emissive BaseMaterial3D of `mi` (override, surface overrides, the mesh's own) at house level `h` — a venue's
## glow is house light. Materials or meshes marked SHOW_LIGHT are left alone; ShaderMaterials (LED walls, avatars) too.
static func dim_mesh(mi: MeshInstance3D, h: float) -> void:
	if mi.has_meta(SHOW_LIGHT):
		return
	var mats: Array = [mi.material_override]
	for s in mi.get_surface_override_material_count():
		mats.append(mi.get_surface_override_material(s))
	for s in mi.mesh.get_surface_count() if mi.mesh != null else 0:
		mats.append(mi.mesh.surface_get_material(s))
	for m in mats:
		var bm := m as BaseMaterial3D
		if bm == null or not bm.emission_enabled or bm.has_meta(SHOW_LIGHT):
			continue
		if not bm.has_meta(ORIG):
			if is_equal_approx(h, 1.0):
				continue  # never dimmed: nothing to restore
			bm.set_meta(ORIG, bm.emission_energy_multiplier)
		bm.emission_energy_multiplier = float(bm.get_meta(ORIG)) * h


## Every mesh under `root` at house level `h`, skipping subtrees marked SHOW_LIGHT (the rig: fixtures_3d.gd).
static func dim_tree(root: Node, h: float) -> void:
	for c in root.get_children():
		if c.has_meta(SHOW_LIGHT):
			continue
		if c is MeshInstance3D:
			dim_mesh(c as MeshInstance3D, h)
		dim_tree(c, h)


## True when `n` sits in a SHOW_LIGHT subtree below `top`.
static func in_show_light(n: Node, top: Node) -> bool:
	while n != null and n != top:
		if n.has_meta(SHOW_LIGHT):
			return true
		n = n.get_parent()
	return false


## How many beams the rigs of this client light now (fixtures_3d.gd reports into `lit`).
func lit_beams() -> int:
	var n := 0
	for v in lit.values():
		n += int(v)
	return n


## The line beside the Quality menu while the house lights are not full: says the room is dark on purpose.
static func hint(h: float, beams: int) -> String:
	if h >= 1.0:
		return ""
	var s := "House lights off" if h <= 0.0 else "House lights dimmed"
	return s + (" — rig dark" if beams <= 0 else "")


## The LEVELS row closest to `h`.
static func nearest(h: float) -> int:
	var at := 0
	for i in LEVELS.size():
		if absf(float(LEVELS[i][1]) - h) < absf(float(LEVELS[at][1]) - h):
			at = i
	return at


## The House lights submenu of the Quality menu (beside Haze): On / Dim / Off, the current one checked.
static func menu() -> PopupMenu:
	var m := PopupMenu.new()
	m.name = "HouseLights"
	for i in LEVELS.size():
		m.add_radio_check_item(LEVELS[i][0], i)
	m.set_item_tooltip(2, "Only the rig's own light, the LED walls and the projections.")
	var sync := func() -> void:
		for i in LEVELS.size():
			m.set_item_checked(i, i == nearest(shared().level))
	m.id_pressed.connect(func(i: int) -> void:
		shared().set_level(float(LEVELS[i][1]))
		sync.call())
	m.about_to_popup.connect(sync)
	sync.call()
	return m
