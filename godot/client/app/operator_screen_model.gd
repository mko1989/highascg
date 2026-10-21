extends RefCounted
## WO-599 T4 — the pure half of operator_screen_picker.gd (tests run without autoloads).


## Screen index → the server output on it ({} when none): exact origin first, else the output holding the screen's
## centre — the same rule as Placement.pick_screen, in the other direction.
static func match_outputs(outputs: Array, screens: Array) -> Array:
	var out := []
	for s: Rect2i in screens:
		var hit := {}
		for o in outputs:
			if o is Dictionary and Vector2i(int(o.get("x", 0)), int(o.get("y", 0))) == s.position:
				hit = o
				break
		if hit.is_empty():
			var c := s.position + s.size / 2
			for o in outputs:
				if o is Dictionary and Rect2i(int(o.get("x", 0)), int(o.get("y", 0)), int(o.get("width", 0)),
						int(o.get("height", 0))).has_point(c):
					hit = o
					break
		out.append(hit)
	return out


## One prompt line per screen.
static func screen_line(i: int, o: Dictionary) -> String:
	if o.is_empty():
		return "Screen %d — not a known output" % (i + 1)
	var line := "Screen %d — %s" % [i + 1, str(o.get("name", "?"))]
	if o.get("current", false):
		line += " (operator screen now)"
	return line


## Fresh box (no operator monitor flagged or resolved) with more than one screen: prompt at start-up, as the WO-290
## boot picker did for the kiosk.
static func should_auto_open(rect: Variant, port: Variant, screen_count: int) -> bool:
	return not rect is Dictionary and port == null and screen_count > 1


## WO-645: the client the session autostart started (--autostart) quits when this boot runs headless — startup.mode
## headless, or Run headless was answered this boot. Started by hand it always runs.
static func autostart_quits(boot: Variant, autostart: bool) -> bool:
	return autostart and boot is Dictionary and bool((boot as Dictionary).get("headless", false)) \
		and not bool((boot as Dictionary).get("pending", false))


## WO-638 boot mode: the line under every prompt.
static func boot_countdown(seconds: int, default_name: String) -> String:
	if default_name == "":
		return "Choose the operator screen — %d s" % max(seconds, 0)
	return "%s becomes the operator screen in %d s" % [default_name, max(seconds, 0)]
