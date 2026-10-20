extends RefCounted
## WO-605 slice 4 — pure port of device-view-inspector-gpu-video-modeline-preview.js: which WxH×Hz the timing preview
## asks for (readPreviewDims), the GET it sends and the text block made from the reply. The CVT / GTF timings come
## from GET /api/hardware/modeline-preview (server cvt/gtf) — never re-derived here. Golden-tested
## (test_devices_gpu_output.gd).

const R := preload("res://features/devices/cable_rules.gd")
const S := preload("res://features/devices/cable_seed.gd")
const H := preload("res://features/devices/host_channels.gd")
const GM := preload("res://features/devices/gpu_modeline_model.gd")
const LABEL_CUSTOM_OS := "Timing for Custom OS mode — Apply GPU registers RandR mode (newmode/addmode) at this WxH×Hz"
const LABEL_EDID_OS := "EDID list selection — Apply GPU uses that xrandr mode token as-is (no newmode)"


## readPreviewDims: ui = {display, os_w, os_h, os_fps, override, mode, custom_w, custom_h, custom_fps} (texts / bools).
static func preview_dims(ui: Dictionary, st: Dictionary, cs: Dictionary, settings: Variant, screen_n: int) -> Dictionary:
	if ui.display == "custom":
		return {"w": GM._int_or(ui.os_w, 1920, 64), "h": GM._int_or(ui.os_h, 1080, 64), "r": GM._float_or(ui.os_fps, 50.0, 1.0)}
	var idx: Variant = S._int(R.s(H.coalesce([ui.display if H.truthy(ui.display) else null, "0"])))
	var modes: Array = st.modes
	var i: int = idx if idx != null else 0
	var pick: Dictionary = modes[i] if i >= 0 and i < modes.size() else {}
	if H.truthy(pick.get("mode")):
		var mm := RegEx.create_from_string("(?i)^(\\d+)x(\\d+)$").search(str(pick.mode))
		if mm:
			var r: Variant = S._float(R.s(H.coalesce([pick.rate if H.truthy(pick.get("rate")) else null, st.display.get("refreshHz") if H.truthy(st.display.get("refreshHz")) else null, 60])))
			return {"w": int(mm.get_string(1)), "h": int(mm.get_string(2)), "r": r if r != null and r != 0.0 else 60.0}
	if ui.override:
		var od := GM.screen_os_dims(cs, settings, screen_n)
		var mm := RegEx.create_from_string("(?i)^(\\d+)x(\\d+)$").search(R.s(od.get("osMode")))
		if mm:
			return {"w": int(mm.get_string(1)), "h": int(mm.get_string(2)), "r": float(od.osRate)}
	if ui.mode == "custom":
		return {"w": GM._int_or(ui.custom_w, 1920, 64), "h": GM._int_or(ui.custom_h, 1080, 64), "r": GM._float_or(ui.custom_fps, 60.0, 1.0)}
	var spec := S.mode_spec(R.s(ui.mode))
	if not spec.is_empty():
		return {"w": spec.width, "h": spec.height, "r": float(spec.fps)}
	var mr := RegEx.create_from_string("^(\\d+)x(\\d+)$").search(R.s(st.display.get("resolution")))
	if mr:
		var hz := GM.js_num(st.display.get("refreshHz"))
		return {"w": int(mr.get_string(1)), "h": int(mr.get_string(2)), "r": hz if not is_nan(hz) and st.display.get("refreshHz") != null else 60.0}
	return {"w": 1920, "h": 1080, "r": 60.0}


static func timing_label(os_custom: bool) -> String:
	return LABEL_CUSTOM_OS if os_custom else LABEL_EDID_OS


static func preview_query(dims: Dictionary, type: String) -> String:
	return "/api/hardware/modeline-preview?w=%d&h=%d&rate=%s&type=%s" % [roundi(dims.w), roundi(dims.h), GM.js_num_str(dims.r), type if type != "" else "cvt"]


static func _locale(v: Variant) -> String:
	var s := GM.js_num_str(v)
	var neg := s.begins_with("-")
	var digits := s.trim_prefix("-").get_slice(".", 0)
	var out := ""
	for i in digits.length():
		if i > 0 and (digits.length() - i) % 3 == 0:
			out += ","
		out += digits[i]
	return ("-" if neg else "") + out + ("." + s.get_slice(".", 1) if s.contains(".") else "")


## The preview block from GET /api/hardware/modeline-preview's reply: {tier, lines, error}.
static func preview_lines(data: Variant) -> Dictionary:
	var d := R.d(data)
	if not H.truthy(d.get("ok")):
		return {"tier": "", "lines": [], "error": R.s(d.get("error")) if H.truthy(d.get("error")) else "Preview failed"}
	var b := R.d(d.get("breakdown"))
	var band := R.d(d.get("bandwidth"))
	var out := {"tier": R.s(band.get("short")) if H.truthy(band.get("short")) else "", "lines": [], "error": ""}
	if not b.is_empty():
		out.lines.append("Mode name: %s" % (R.s(d.get("modeName")) if H.truthy(d.get("modeName")) else "—"))
		out.lines.append("Dot clock: %s MHz" % GM.js_num_str(b.get("dotClockMhz")))
		out.lines.append("H: display %s px · sync start %s · sync end %s · total %s" % [GM.js_num_str(b.get("hDisplay")), GM.js_num_str(b.get("hSyncStart")), GM.js_num_str(b.get("hSyncEnd")), GM.js_num_str(b.get("hTotal"))])
		out.lines.append("V: display %s px · sync start %s · sync end %s · total %s" % [GM.js_num_str(b.get("vDisplay")), GM.js_num_str(b.get("vSyncStart")), GM.js_num_str(b.get("vSyncEnd")), GM.js_num_str(b.get("vTotal"))])
		out.lines.append("Active pixels / frame: %s" % _locale(b.get("activePixels")))
		out.lines.append("Total timing pixels / frame: %s" % _locale(b.get("framePixels")))
		var hz := GM.js_num(b.get("approxHz"))
		if b.get("approxHz") != null and not is_nan(hz):
			out.lines.append("≈ refresh: %s Hz" % String.num(roundf(hz * 100.0) / 100.0, 2))
		if H.truthy(b.get("flags")):
			out.lines.append("Flags: %s" % R.s(b.flags))
	return out
