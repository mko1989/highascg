extends RefCounted
## WO-1099 — House lights (owner 16.11: "add the ability to turn off the 'sun' so users can only see the rigs lights";
## "i hope there will be a slider for house lights"): the general light on the room in the 3D views — the stage's ambient
## fill, its directional "sun" and the venue's own glowing materials (a model's emissive ceiling coffers, chandeliers,
## practicals: house light too) — as ONE level 0–100 % (a slider beside the Quality menu; its label jumps to off and back
## to the last level). The slider reads as perceived brightness: every house light scales by gain() = level^2.2, so 50 %
## looks half as bright on the sRGB screen, and everything fades together and smoothly (no light switched at a
## threshold; the rig's spot lights shine at every level — fixtures_3d.gd + beam_cone.gd pick). 100 % = the views as they
## were; 0 % = a dark room where only the show lights: the rig's lights, cones and lenses, the LED walls / TVs /
## projections, the camera cut-outs. One level for every 3D view of this client (ui.cfg [previs] house_lights, never in
## the project), like Quality and Haze. The tracking Camera view's stage overlay does not follow it (a geometry aid,
## camera_overlay.gd keeps its own fill). Avatars keep a small self-light floor (ui.cfg [previs] avatar_floor) so a
## presenter outside every beam still reads, without glowing in the dark.

signal changed(level: float)

const UiCfg := preload("res://core/ui_cfg.gd")
const GAMMA := 2.2  ## slider (perceived) → light (linear): gain()
const SUN_ENERGY := 0.6  ## the stage's sun at full house light (previs_stage.gd)
const OVERLAY_FILL := 1.5  ## extra ambient energy the Camera overlay takes when the room's sun is off
const AVATAR_FLOOR := 0.06  ## avatar self-light with the house lights off (theirs is 0.3 when on)
const SHOW_LIGHT := "show_light"  ## node or material meta: show light — never dimmed (the rig, LED pictures)
const ORIG := "house_emission"  ## material meta: its emission energy at full house light

static var _shared: RefCounted
static var _controls: Array = []  # WeakRef → a control() box the shared level keeps in step (WO-1106 A20)
static var _hooked := false

var level := 1.0  ## the slider, 0..1 (perceived brightness)
var last := 1.0  ## the level the label toggle goes back to (ui.cfg [previs] house_last)
var avatar_floor := AVATAR_FLOOR
var lit := {}  # rig (fixtures_3d.gd) instance id → its lit beams now, for hint()


static func shared() -> RefCounted:
	if _shared == null:
		_shared = from_cfg(UiCfg.PATH)
	return _shared


## A level as stored in `path` (ui.cfg): the slider, the label's last lit level (WO-1106 A9: it was saved, never read
## back, so after a restart the label went to 100 %) and the avatar floor.
static func from_cfg(path: String) -> RefCounted:
	var h: RefCounted = new()
	var cfg := ConfigFile.new()
	cfg.load(path)
	h.level = clampf(float(cfg.get_value("previs", "house_lights", 1.0)), 0.0, 1.0)
	var l := clampf(float(cfg.get_value("previs", "house_last", 1.0)), 0.0, 1.0)
	h.last = l if l > 0.0 else 1.0
	h.avatar_floor = clampf(float(cfg.get_value("previs", "avatar_floor", AVATAR_FLOOR)), 0.0, 1.0)
	return h


## `save` false while a slider drags (the control saves once it rests).
func set_level(h: float, save := true, path := UiCfg.PATH) -> void:
	level = clampf(h, 0.0, 1.0)
	if level > 0.0:
		last = level
	if save:
		UiCfg.save_value("previs", "house_lights", level, path)
		UiCfg.save_value("previs", "house_last", last, path)
	changed.emit(level)


## The label's click: off, or back on at the last level (full if there is none).
func toggle(path := UiCfg.PATH) -> void:
	set_level(0.0 if level > 0.0 else last, true, path)


## Linear light at slider level `h`: perceptually even (sRGB ≈ gamma 2.2), 0 at 0, 1 at 1, no steps.
static func gain(h: float) -> float:
	return pow(clampf(h, 0.0, 1.0), GAMMA)


## A stage's Environment + sun at house level `h`: the ambient fill and the sun scale with gain(h) (the sun is hidden
## only at 0, where its energy is already 0 — no pop).
static func apply_stage(env: Environment, sun: DirectionalLight3D, h: float) -> void:
	var g := gain(h)
	if env != null:
		env.ambient_light_energy = g
	if sun != null:
		sun.light_energy = SUN_ENERGY * g
		sun.visible = g > 0.0


## The Camera overlay's own fill: full ambient, plus a share standing in for the shared world's sun when it is off.
static func overlay_ambient(h: float) -> float:
	return 1.0 + OVERLAY_FILL * (1.0 - gain(h))


## An avatar's self-light at house level `h`: `base` when on, down to `low` (never above `base`) when off.
static func self_light(base: float, h: float, low: float) -> float:
	return lerpf(minf(low, base), base, gain(h))


## Every emissive BaseMaterial3D under `root` (overrides, surface overrides, the meshes' own; once each) as WeakRefs —
## a venue's glow is house light. Subtrees, meshes and materials marked SHOW_LIGHT are skipped (the rig, LED pictures);
## ShaderMaterials (LED walls, avatars) too. The stage keeps the list, so a slider step only writes numbers.
static func collect(root: Node, into: Array = [], seen: Dictionary = {}) -> Array:
	for c in root.get_children():
		if c.has_meta(SHOW_LIGHT):
			continue
		var mi := c as MeshInstance3D
		if mi != null:
			var mats: Array = [mi.material_override]
			for k in mi.get_surface_override_material_count():
				mats.append(mi.get_surface_override_material(k))
			for k in mi.mesh.get_surface_count() if mi.mesh != null else 0:
				mats.append(mi.mesh.surface_get_material(k))
			for m in mats:
				var bm := m as BaseMaterial3D
				if bm != null and bm.emission_enabled and not bm.has_meta(SHOW_LIGHT) and not seen.has(bm.get_instance_id()):
					seen[bm.get_instance_id()] = true
					into.append(weakref(bm))
		collect(c, into, seen)
	return into


## `glow` (collect()) at house level `h`: each material's emission energy × gain(h) of its full-house energy.
static func dim(glow: Array, h: float) -> void:
	var g := gain(h)
	for w: WeakRef in glow:
		var bm := w.get_ref() as BaseMaterial3D
		if bm == null:
			continue
		if not bm.has_meta(ORIG):
			if g >= 1.0:
				continue  # never dimmed: nothing to restore
			bm.set_meta(ORIG, bm.emission_energy_multiplier)
		bm.emission_energy_multiplier = float(bm.get_meta(ORIG)) * g


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
	var s := "House lights off" if h <= 0.0 else "House lights %d %%" % roundi(h * 100.0)
	return s + (" — rig dark" if beams <= 0 and h <= 0.3 else "")


## The toolbar control beside the Quality menu: "House" (click: off / back to the last level) + a 0–100 % slider, live
## while it drags (set_level without saving; saved once it rests 0.4 s).
static func control() -> HBoxContainer:
	var box := HBoxContainer.new()
	box.name = "HouseLights"
	box.tooltip_text = "House lights: the general light on the room (ambient, the 'sun', the venue's own glow), this client only. 0 % = only the rig's own light, the LED walls and the projections."
	var b := Button.new()
	b.name = "Toggle"
	b.flat = true
	b.tooltip_text = "House lights off / back on at the last level"
	b.focus_mode = Control.FOCUS_NONE
	box.add_child(b)
	var sl := HSlider.new()
	sl.name = "Level"
	sl.min_value = 0.0
	sl.max_value = 100.0
	sl.step = 1.0
	sl.custom_minimum_size = Vector2(110, 0)
	sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	sl.tooltip_text = box.tooltip_text
	sl.focus_mode = Control.FOCUS_NONE  # arrows stay with the 3D view (nudge)
	box.add_child(sl)
	var rest := Timer.new()
	rest.one_shot = true
	rest.wait_time = 0.4
	rest.timeout.connect(func() -> void: shared().set_level(shared().level))
	box.add_child(rest)
	sl.value_changed.connect(func(v: float) -> void:
		shared().set_level(v / 100.0, false)
		rest.start())
	b.pressed.connect(func() -> void: shared().toggle())
	# WO-1106 A20: one static-method hook for every control (the WO-1103 exit-134 shape), never a lambda per control
	# left on the static singleton — that leaked one connection per call and is the heap-corruption pattern at exit
	_controls.append(weakref(box))
	if not _hooked:
		_hooked = true
		shared().changed.connect(_on_level)
	_sync_control(box, shared().level)
	return box


static func _on_level(h: float) -> void:
	var live: Array = []
	for w: WeakRef in _controls:
		var box := w.get_ref() as HBoxContainer
		if box != null:  # shared() outlives a freed control
			live.append(w)
			_sync_control(box, h)
	_controls = live


static func _sync_control(box: HBoxContainer, h: float) -> void:
	var sl := box.get_node_or_null("Level") as HSlider
	var b := box.get_node_or_null("Toggle") as Button
	if sl == null or b == null:
		return
	sl.set_value_no_signal(roundf(h * 100.0))
	b.text = "House %d %%" % roundi(h * 100.0) if h > 0.0 else "House off"
