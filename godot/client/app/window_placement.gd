extends RefCounted
## WO-599 T4 — where the operator client opens and how big its UI draws (replaces the kiosk's xdotool placement and
## operator-gui-scale.js). Pure: main.gd feeds it GET /api/system/operator-display and DisplayServer's screens.

const BASELINE := Vector2(1920, 1080)  # the UI is laid out for 1080p, like the web kiosk's CSS
const MIN_SCALE := 1.0
const MAX_SCALE := 4.0


## The screen index whose rect is the server's operator monitor (`rect` {x, y, width, height}): exact origin first,
## else the screen holding the rect's centre; -1 when none does (stay where the window manager put us).
static func pick_screen(rect: Variant, screens: Array) -> int:
	if not rect is Dictionary or not rect.has("x") or not rect.has("y"):
		return -1
	var origin := Vector2i(int(rect.x), int(rect.y))
	for i in screens.size():
		if (screens[i] as Rect2i).position == origin:
			return i
	var centre := origin + Vector2i(int(rect.get("width", 0)) / 2, int(rect.get("height", 0)) / 2)
	for i in screens.size():
		if (screens[i] as Rect2i).has_point(centre):
			return i
	return -1


## UI scale for a screen of `size` px (the kiosk's devPixelsPerPx rule): 1 at / under 1080p, linear above (2 at
## 2160p), clamped to [1, 4], 2 decimals. `override` > 0 (ui.cfg [window] ui_scale, --ui-scale) wins.
static func ui_scale(size: Vector2i, override := 0.0) -> float:
	if override > 0.0:
		return clampf(override, 0.5, MAX_SCALE)
	if size.x <= 0 or size.y <= 0:
		return MIN_SCALE
	var r := minf(size.x / BASELINE.x, size.y / BASELINE.y)
	return clampf(roundf(r * 100.0) / 100.0, MIN_SCALE, MAX_SCALE)


const SCALES := [[0.0, "Auto (by screen size)"], [1.0, "1×"], [1.25, "1.25×"], [1.5, "1.5×"], [2.0, "2×"]]
const UI_CFG := "user://ui.cfg"


## This screen's UI-scale choice (ui.cfg [window] ui_scale; 0 = auto).
static func saved_scale() -> float:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	return float(cfg.get_value("window", "ui_scale", 0.0))


## Settings → Defaults "UI scale": remember the choice and redraw the main window at it now.
static func apply_scale(choice: float) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("window", "ui_scale", choice)
	cfg.save(UI_CFG)
	var root := (Engine.get_main_loop() as SceneTree).root
	root.content_scale_factor = ui_scale(DisplayServer.screen_get_size(root.current_screen), choice)
