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


## The Haze submenu of the Quality menu (owner 09.11, WO-1010: "move haze into quality as another menu"): No haze /
## Light haze / Haze / Thick haze, the current one checked.
static func menu() -> PopupMenu:
	var m := PopupMenu.new()
	m.name = "Haze"
	for i in LEVELS.size():
		m.add_radio_check_item(LEVELS[i][0], i)
	var sync := func() -> void:
		for i in LEVELS.size():
			m.set_item_checked(i, i == nearest(shared().level))
	m.id_pressed.connect(func(i: int) -> void:
		shared().set_level(float(LEVELS[i][1]))
		sync.call())
	m.about_to_popup.connect(sync)
	sync.call()
	return m


## The LEVELS row closest to haze `h`.
static func nearest(h: float) -> int:
	var at := 0
	for i in LEVELS.size():
		if absf(float(LEVELS[i][1]) - h) < absf(float(LEVELS[at][1]) - h):
			at = i
	return at
