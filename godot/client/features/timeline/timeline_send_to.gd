extends RefCounted
## WO-602 slice 8 — timeline output routing, pure (web timeline-state-model.js normalizeSendTo /
## previewBusAvailableForSendTo / coerceTimelineSendTo / defaultTimelineSendTo, timeline-transport.js Dest screen list,
## projectFps and the Take body, editor-defaults.js getDefaultTransitionFromEditor).

const DeckModel := preload("res://features/live/deck_model.gd")
const T := preload("res://features/live/transitions.gd")

const DEFAULT := {"preview": true, "program": false, "screenIdx": 0}


## normalizeSendTo: screenIdx null / "all" = all screens; preview defaults on, program off.
static func normalize(raw: Variant) -> Dictionary:
	if not (raw is Dictionary):
		return DEFAULT.duplicate()
	var s: Variant = raw.get("screenIdx", 0)
	var idx: Variant = null
	if s != null and str(s) != "all":
		idx = int(s) if (s is int or s is float or str(s).is_valid_float()) else 0
	var pv: Variant = raw.get("preview", true)
	return {"preview": not (pv is bool and pv == false), "program": _truthy(raw.get("program")), "screenIdx": idx}


## JS !!v
static func _truthy(v: Variant) -> bool:
	if v is bool:
		return v
	if v is int or v is float:
		return v != 0 and not is_nan(float(v))
	if v is String:
		return v != ""
	return v != null


## Whether the destination has a separate PRV bus (all screens: any of them).
static func prv_available(cm: Dictionary, st: Dictionary) -> bool:
	if st.get("screenIdx") == null:
		for i in DeckModel.screen_count(cm):
			if DeckModel.preview_bus_available(cm, i):
				return true
		return false
	return DeckModel.preview_bus_available(cm, maxi(0, int(st.screenIdx)))


## coerceTimelineSendTo: PGM-only destinations drop PRV; `program` is never switched on here (todos06.08).
static func coerce(cm: Dictionary, st: Dictionary) -> Dictionary:
	if not prv_available(cm, st):
		st["preview"] = false
	return st


static func default_for(cm: Dictionary) -> Dictionary:
	return coerce(cm, DEFAULT.duplicate())


## The Dest list: [[label, screenIdx]], "All screens" (null) first when there are 2+ screens.
static func screen_options(cm: Dictionary) -> Array:
	var n := DeckModel.screen_count(cm)
	var out := []
	if n > 1:
		out.append(["All screens", null])
	var v: Variant = cm.get("virtualMainChannels", [])
	for i in n:
		var vm: Variant = v[i] if v is Array and i < (v as Array).size() else null
		var name := str(vm.get("name", "")) if vm is Dictionary and vm.get("name") != null else ""
		out.append([name if name != "" else _screen_label(cm, i), i])
	return out


## web screenLabel (WO-222): the custom label, else S1, S2 …
static func _screen_label(cm: Dictionary, i: int) -> String:
	var l: Variant = cm.get("screenLabels", [])
	if l is Array and i < (l as Array).size() and l[i] != null and str(l[i]) != "":
		return str(l[i])
	return "S%d" % (i + 1)


## projectFps: the timeline's, else screen 1's program rate, else 50.
static func project_fps(tl: Dictionary, cm: Dictionary) -> float:
	if float(tl.get("fps", 0)) > 0:
		return float(tl.fps)
	var rl: Variant = cm.get("programResolutions", [])
	if rl is Array and not (rl as Array).is_empty() and rl[0] is Dictionary and float(rl[0].get("fps", 0)) > 0:
		return float(rl[0].fps)
	return 50.0


## getDefaultTransitionFromEditor: MIX / auto / linear under settings editorDefaults.transition, the duration
## resolved to frames (auto = half the rate).
static func take_default(editor_t: Variant, fps: float) -> Dictionary:
	var t := T.default_transition()
	if editor_t is Dictionary:
		t.merge(editor_t, true)
	t["duration"] = T.resolve_duration(t.get("duration"), fps if fps > 0 else 50.0)
	t["type"] = T.migrate_type(t.get("type"))
	return t


## The POST /take body (the web clamps the typed frames to 0–120; 12 still means auto).
static func take_body(t: Dictionary, fps: float, screen_idx: Variant) -> Dictionary:
	var ty := str(t.get("type", ""))
	var tw := str(t.get("tween", ""))
	return {"transition": ty if ty != "" else "MIX", "duration": T.resolve_duration(clampi(int(t.get("duration", 0)), 0, 120), fps),
		"tween": tw if tw != "" else "linear", "screenIdx": screen_idx}


## WO-788: the surface role the timeline editor's monitor shows for a routing — PRV of the Dest screen (all screens →
## the first), PGM when the timeline goes to program only.
static func monitor_role(st: Dictionary) -> String:
	var screen := int(st.screenIdx) + 1 if st.get("screenIdx") != null else 1
	return ("pgm%d" if st.get("program") == true and st.get("preview") != true else "prv%d") % screen
