extends RefCounted
## WO-806 — the Timers dock's pure half (web timer-control-panel.js + timer-control-panel-inline-time.js): the row list
## from GET /api/timers/list, the per-screen chips, the eye's fade request and the standing Time / Target field
## (parseTimeText / secondsToClockText / timeConfigPatch / timeInputValue, golden-tested against the web under node).
## The dock is a live controller only (WO-381): nothing here creates, assigns or removes a timer.

const NumericField := preload("res://core/numeric_field.gd")
const FADE_FRAMES := 25  # WO-381: the eye fades (= the screen-timer Inspector's FADE_FRAMES)
const FADE_REFRESH_S := 0.7  # re-read the list once the ramp has landed (~0.5 s at 50p)
const _TIME_RE := "^\\d{1,3}(:\\d{1,2}){0,2}$"


## parseTimeText: `SS`, `MM:SS`, `HH:MM:SS` (minutes / seconds not clamped — `90:00` is 90 minutes) → seconds; -1 when
## unparseable. RULES.md input rule 2: a plain `+ - * / ( )` expression (no ':') is evaluated too — `5*60` → 300.
static func parse_time_text(text: String) -> int:
	var raw := text.strip_edges()
	if raw == "":
		return -1
	if RegEx.create_from_string(_TIME_RE).search(raw):
		var parts := Array(raw.split(":")).map(func(x: String) -> int: return x.to_int())
		var hms: Array = parts if parts.size() == 3 else ([0, parts[0], parts[1]] if parts.size() == 2 else [0, 0, parts[0]])
		return int(hms[0]) * 3600 + int(hms[1]) * 60 + int(hms[2])
	if raw.contains(":"):
		return -1
	var v: Variant = NumericField.evaluate(raw)
	return floori(v) if v != null and float(v) >= 0.0 and is_finite(float(v)) else -1


## secondsToClockText: `HH:MM:SS`, wrapped at 24 h (the countdown template's targetTime shape).
static func seconds_to_clock_text(total: float) -> String:
	var n := maxi(0, floori(total if is_finite(total) else 0.0)) % 86400
	return "%02d:%02d:%02d" % [n / 3600, (n % 3600) / 60, n % 60]


static func _mode(timer: Dictionary) -> String:
	var cfg: Variant = timer.get("config")
	var m := str((cfg as Dictionary).get("mode", "")) if cfg is Dictionary else ""
	return m if m != "" else "duration"


static func is_clock(timer: Dictionary) -> bool:
	return _mode(timer) == "clock"


## timeConfigPatch: clock mode sets the target wall-clock time, every other mode the duration.
static func time_config_patch(timer: Dictionary, seconds: int) -> Dictionary:
	return {"targetTime": seconds_to_clock_text(seconds)} if is_clock(timer) else {"durationSec": maxi(0, seconds)}


## timeInputValue: what the Time / Target field shows.
static func time_input_value(timer: Dictionary) -> String:
	var cfg: Dictionary = timer.get("config", {}) if timer.get("config") is Dictionary else {}
	if is_clock(timer):
		return str(cfg.targetTime) if str(cfg.get("targetTime", "")) != "" else "00:00:00"
	var d: Variant = cfg.get("durationSec")
	return seconds_to_clock_text(float(d) if d is float or d is int else 0.0)


## The field's commit: [text to show, patch] — patch {} when unparseable (the stored value comes back) or unchanged
## (no CG UPDATE).
static func commit_time(timer: Dictionary, text: String) -> Array:
	var secs := parse_time_text(text)
	if secs < 0:
		return [time_input_value(timer), {}]
	var patch := time_config_patch(timer, secs)
	var shown: String = patch.targetTime if is_clock(timer) else seconds_to_clock_text(patch.durationSec)
	return [shown, {} if shown == time_input_value(timer) else patch]


## The screens a timer is on (its `screens` keys), ascending.
static func screens(timer: Dictionary) -> Array:
	var out: Array = []
	if timer.get("screens") is Dictionary:
		for k in (timer.screens as Dictionary).keys():
			if str(k).is_valid_int():
				out.append(int(str(k)))
	out.sort()
	return out


static func screen_visible(timer: Dictionary, idx: int) -> bool:
	var e: Variant = (timer.get("screens", {}) as Dictionary).get(str(idx)) if timer.get("screens") is Dictionary else null
	return e is Dictionary and e.get("visible") == true


static func name_of(timer: Dictionary) -> String:
	var n := str(timer.get("name", "")) if timer.get("name") != null else ""
	return n if n != "" else "Timer %s" % str(timer.get("timerId", "")).left(8)


## Every listed timer with an id (the web lists them all, assigned or not).
static func rows(list: Variant) -> Array:
	return (list as Array).filter(func(t: Variant) -> bool: return t is Dictionary and str(t.get("timerId", "")) != "") if list is Array else []


## The rows' shape: the dock rebuilds only when it changes (the readouts tick on their own).
static func shape(list: Array) -> String:
	var sig := []
	for t in list:
		var vis := []
		for i in screens(t):
			vis.append([i, screen_visible(t, i)])
		sig.append([t.timerId, name_of(t), vis, t.get("config", {})])
	return JSON.stringify(sig)


static func cmd_body(timer_id: String, cmd: String) -> Dictionary:
	return {"timerId": timer_id, "cmd": cmd}


## The eye: a fade (WO-381), in to the stored on-air opacity or out.
static func visible_body(timer_id: String, screen_idx: int, on: bool) -> Dictionary:
	return {"timerId": timer_id, "screenIdx": screen_idx, "visible": on, "fadeFrames": FADE_FRAMES}


## saveTimerConfigPatch: the merged config, once per assigned screen (each needs its own CG UPDATE).
static func assign_bodies(timer: Dictionary, patch: Dictionary) -> Array:
	var cfg: Dictionary = (timer.get("config", {}) as Dictionary).duplicate() if timer.get("config") is Dictionary else {}
	cfg.merge(patch, true)
	return screens(timer).map(func(i: int) -> Dictionary: return {"timerId": str(timer.timerId), "screenIdx": i, "config": cfg})
