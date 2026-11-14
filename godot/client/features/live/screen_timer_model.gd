extends RefCounted
## WO-601 — screen timers (server-owned, /api/timers/*; AMCP band 980-989), pure: the readout math of the web's
## timer-control-panel-display.js (computeDisplayTime / formatDisplayTime) and the settings form's config rules
## (timer-control-panel-settings-form.js). Unlike the web, "now" is the SERVER clock (local + the offset measured
## from /api/timers/list `serverNowMs`), so a client on another machine never bakes its clock skew into the readout.

const DEFAULTS := {  # timer-control-panel-display.js DEFAULT_TIMER_CONFIG
	"mode": "duration", "durationSec": 300, "targetTime": "18:00:00", "format": "auto", "amberThresholdSec": 60,
	"redThresholdSec": 15, "position": "center", "hideTimer": false, "timerFontSize": 15, "auxFontSize": 5,
	"timerFontFamily": "", "timerColor": "#ffffff", "amberColor": "#ffb300", "redColor": "#ff3b30",
	"timerBorderWidth": 0, "timerBorderColor": "#000000", "auxColor": "#ffffff", "auxTop": "", "auxMiddle": "", "auxBottom": "",
}
const MODES := [["duration", "Duration"], ["clock", "Clock"]]
const POSITIONS := ["center", "top-left", "top-right", "bottom-left", "bottom-right"]
## Families the box image ships — used until GET /api/timers/fonts answers (what is really installed on the server).
## The web's list (Verdana, Georgia, Impact …) is not installed on the box: Caspar drew most of them as the default.
const FALLBACK_FONTS := ["DejaVu Sans", "DejaVu Sans Mono", "DejaVu Serif", "Nimbus Roman", "Nimbus Sans", "Nimbus Sans Narrow",
	"Ubuntu", "Ubuntu Mono", "URW Bookman", "URW Gothic"]
const FADE_FRAMES := 25
const TICK_MS := 250


static func _num(v: Variant) -> float:
	return float(v) if v is float or v is int else NAN


## JS `a || b || c` over numbers (0 / missing → next).
static func _or_num(vals: Array) -> float:
	for v in vals:
		var n := _num(v)
		if not is_nan(n) and n != 0.0:
			return n
	return 0.0


## computeDisplayTime with now_ms on the server clock; local_sod = seconds since local midnight (clock mode).
static func display_time(rec: Dictionary, now_ms: float, local_sod: float) -> float:
	var cfg: Dictionary = rec.get("config", {}) if rec.get("config") is Dictionary else {}
	var mode := str(cfg.get("mode", "duration")) if str(cfg.get("mode", "")) != "" else "duration"
	var remaining := _num(rec.get("remainingSec"))
	var configured := _or_num([rec.get("durationSec"), cfg.get("durationSec")])
	if mode == "duration":
		var last := str(rec.get("lastCmd", ""))
		if last == "pause":
			return remaining if not is_nan(remaining) else configured
		var at := _num(rec.get("cmdAt"))
		if last == "start" and not is_nan(at):
			var basis := remaining if not is_nan(remaining) else configured
			return basis - (now_ms - at) / 1000.0
		return configured
	if mode == "clock":
		var parts := str(cfg.get("targetTime", "00:00:00")).split(":")
		var hms := [0, 0, 0]
		for i in mini(3, parts.size()):
			hms[i] = parts[i].to_int() if parts[i].strip_edges().is_valid_int() else 0
		return float(hms[0] * 3600 + hms[1] * 60 + hms[2]) - local_sod
	return 0.0


## formatDisplayTime: sign from the raw value, then trunc → "-00:00:00" for -0.4 like the web.
static func format(seconds: float) -> String:
	var sign := "-" if seconds < 0.0 else ""
	var a := absi(int(seconds))
	return "%s%02d:%02d:%02d" % [sign, a / 3600, (a % 3600) / 60, a % 60]


## "red" / "amber" / "" — remaining ≤ red; red < remaining ≤ amber.
static func state(rec: Dictionary, remaining: float) -> String:
	var cfg: Dictionary = rec.get("config", {}) if rec.get("config") is Dictionary else {}
	var red := _or_num([cfg.get("redThresholdSec")])
	var amber := _or_num([cfg.get("amberThresholdSec")])
	if remaining <= red:
		return "red"
	if remaining <= amber:
		return "amber"
	return ""


## Timers assigned to one screen (web: t.screens[String(screenIdx)]).
static func on_screen(timers: Array, screen_idx: int) -> Array:
	return timers.filter(func(t: Variant) -> bool: return t is Dictionary and t.get("screens") is Dictionary and (t.screens as Dictionary).has(str(screen_idx)))


## The Font choice: [[css value, label] …] — Default, every installed family, and the stored value when it is none of
## those (kept and marked, never silently swapped for another font).
static func font_items(installed: Variant, current: String) -> Array:
	var fams: Array = installed if installed is Array and not (installed as Array).is_empty() else FALLBACK_FONTS
	var out := [["", "Default"]]
	for f in fams:
		if str(f).strip_edges() != "" and not str(f).contains("'"):
			out.append(["'%s'" % str(f).strip_edges(), str(f).strip_edges()])
	if current != "" and out.all(func(it: Array) -> bool: return it[0] != current):
		out.append([current, "%s (not installed)" % font_first(current)])
	return out


## "'Verdana', sans-serif" → "Verdana".
static func font_first(css: String) -> String:
	return css.split(",")[0].strip_edges().trim_prefix("'").trim_suffix("'").trim_prefix("\"").trim_suffix("\"")


## Pixel override field → stored value: blank = "" (back to the preset), else rounded int.
static func px_value(text: String) -> Variant:
	return "" if text.strip_edges() == "" else roundi(text.to_float())


## "+ Add timer" name: `Timer <screen>` then ` #n` from the second one.
static func new_name(screen_label: String, existing: int) -> String:
	var n := existing + 1
	return "Timer %s%s" % [screen_label, " #%d" % n if n > 1 else ""]
