extends RefCounted
## WO-786 — stage haze for the 3D views (Previs and Live 3D), like a hazer in the venue: the beams show as shafts.
## One level for every view (ui.cfg [previs] haze). Each fixture rig (fixtures_3d.gd) follows it: its world's
## Environment gets Godot's volumetric fog (Forward+; only the heads' spot lights scatter in it — the stage's sun and
## ambient do not, so the room stays dark). The fog's froxels are too coarse at stage distance to draw single beams,
## so the shafts themselves are the beam cones (every beam, also those past the spot-light budget): brighter, and
## carrying further down the throw.

signal changed(level: float)

const UI_CFG := "user://ui.cfg"
const LEVELS := [["No haze", 0.0], ["Light haze", 0.35], ["Haze", 0.65], ["Thick haze", 1.0]]

static var _shared: RefCounted

var level := 0.0


static func shared() -> RefCounted:
	if _shared == null:
		_shared = new()
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		_shared.level = clampf(float(cfg.get_value("previs", "haze", 0.0)), 0.0, 1.0)
	return _shared


func set_level(h: float) -> void:
	level = clampf(h, 0.0, 1.0)
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("previs", "haze", level)
	cfg.save(UI_CFG)
	changed.emit(level)


## The fog of an Environment at haze level `h` (0 = off).
static func apply_env(env: Environment, h: float) -> void:
	if env == null:
		return
	env.volumetric_fog_enabled = h > 0.0
	env.volumetric_fog_density = 0.001 + 0.005 * h  # a thin atmosphere: the LED walls stay bright (extinction)
	env.volumetric_fog_albedo = Color(0.9, 0.9, 0.95)
	env.volumetric_fog_length = 64.0
	env.volumetric_fog_ambient_inject = 0.0
	env.volumetric_fog_sky_affect = 0.0


## The toolbar picker: No haze / Light haze / Haze / Thick haze.
static func picker() -> OptionButton:
	var o := OptionButton.new()
	o.tooltip_text = "Haze in the 3D views — the beams show as shafts of light, as with a hazer in the venue."
	var at := 0
	for i in LEVELS.size():
		o.add_item(LEVELS[i][0])
		if absf(float(LEVELS[i][1]) - shared().level) < absf(float(LEVELS[at][1]) - shared().level):
			at = i
	o.select(at)
	o.item_selected.connect(func(i: int) -> void: shared().set_level(float(LEVELS[i][1])))
	return o
