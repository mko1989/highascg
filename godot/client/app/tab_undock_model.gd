extends RefCounted
## WO-891 — the pure half of the second operator window (app/second_window.gd, app/tab_undock.gd): which workspace tabs
## may move, where a tab sits in either strip, which screen the window opens on, and its ui.cfg record (tests run
## without autoloads).

## Owner 31.10: "live, timeline, visuals, previs, audio, devices settings" — Multiview stays in the main window.
const MOVABLE := ["Live", "Timeline", "Visuals", "Previs", "Audio", "Devices", "Settings"]
const ORDER := ["Live", "Timeline", "Visuals", "Previs", "Audio", "Devices", "Multiview", "Settings"]  # shell.gd order
const SECTION := "second_window"
const MIN_RECT := Vector2i(480, 320)


static func movable(name: String) -> bool:
	return name in MOVABLE


## Where a tab called `name` goes among the tabs `present` (in strip order) so both strips keep the shell's order.
static func insert_index(name: String, present: Array) -> int:
	var rank := _rank(name)
	var i := 0
	for n in present:
		if _rank(str(n)) < rank:
			i += 1
	return i


static func _rank(name: String) -> int:
	var r := ORDER.find(name)
	return r if r >= 0 else ORDER.size()


## ui.cfg `tabs` → the tabs to put back in the second window: known, movable, once each, in the shell's order.
static func restore_list(saved: Variant) -> Array:
	var out := []
	if not (saved is Array or saved is PackedStringArray):
		return out
	for n in ORDER:
		if movable(n) and n in saved:
			out.append(n)
	return out


## Whether screen `i` shows a Caspar output (GET /api/system/operator-screen `caspar`, per screen through
## operator_screen_model.match_outputs) or the operator monitor (`current`). Unknown screens are free.
static func busy(outputs: Array, i: int) -> bool:
	if i < 0 or i >= outputs.size() or not outputs[i] is Dictionary:
		return false
	var o: Dictionary = outputs[i]
	return bool(o.get("caspar", false)) or bool(o.get("current", false))


## The screen the second window opens on: the operator's pick (`saved`) while it exists and shows no Caspar output
## — the main window's own screen too, as a plain window there — else the first other screen that is neither the
## main window's nor busy; -1 when there is none (a plain window on the main screen: a one-monitor dev box).
static func pick_screen(screens: Array, outputs: Array, main: int, saved: int) -> int:
	if saved >= 0 and saved < screens.size() and (saved == main or not busy(outputs, saved)):
		return saved
	for i in screens.size():
		if i != main and not busy(outputs, i):
			return i
	return -1


## A screen of its own → the window fills it (maximized); else it is a plain window on the main screen.
static func fills_screen(screen: int, main: int) -> bool:
	return screen >= 0 and screen != main


## The plain window's rect on `screen_rect`: the saved one while it is big enough and on that screen, else two thirds
## of the screen, centred.
static func windowed_rect(screen_rect: Rect2i, saved: Variant) -> Rect2i:
	if saved is Rect2i and (saved as Rect2i).size.x >= MIN_RECT.x and (saved as Rect2i).size.y >= MIN_RECT.y \
			and screen_rect.has_point((saved as Rect2i).get_center()):
		return saved
	var size := Vector2i(screen_rect.size * 2 / 3).max(MIN_RECT)
	return Rect2i(screen_rect.position + (screen_rect.size - size) / 2, size)


## The screen menu's line for screen `i` (`o` its output, {} when unknown).
static func screen_label(i: int, o: Dictionary, main: int) -> String:
	var line := "Screen %d" % (i + 1)
	if str(o.get("name", "")) != "":
		line += " — %s" % o.name
	if i == main:
		line += " (main window — a window on it)"
	elif bool(o.get("caspar", false)):
		line += " (Caspar output)"
	elif bool(o.get("current", false)):
		line += " (operator monitor)"
	return line


## ui.cfg [second_window] → {tabs: Array, screen: int (-1 = automatic), rect: Rect2i or null}.
static func load_record(path: String) -> Dictionary:
	var cfg := ConfigFile.new()
	cfg.load(path)
	var rect: Variant = cfg.get_value(SECTION, "rect") if cfg.has_section_key(SECTION, "rect") else null
	return {"tabs": restore_list(cfg.get_value(SECTION, "tabs", [])), "screen": int(cfg.get_value(SECTION, "screen", -1)),
		"rect": rect if rect is Rect2i else null}


## One load-modify-save (WO-843: re-read right before the write — ui.cfg is shared by many keys). `rect` null keeps the
## saved one (a window that fills its screen has no rect of its own).
static func save_record(path: String, tabs: Array, screen: int, rect: Variant) -> void:
	var cfg := ConfigFile.new()
	cfg.load(path)
	cfg.set_value(SECTION, "tabs", tabs)
	cfg.set_value(SECTION, "screen", screen)
	if rect is Rect2i:
		cfg.set_value(SECTION, "rect", rect)
	cfg.save(path)
