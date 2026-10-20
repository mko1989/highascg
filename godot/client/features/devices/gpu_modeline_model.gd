extends RefCounted
## WO-605 slice 4 — pure port of the GPU video-mode / modeline logic behind the web GPU-output inspector:
## device-view-destinations-inspector-modes.js (mode ids, aliases, dimension matching, resolveGpuInspectorVideoMode),
## edid-preferred-mode.js, device-view-inspector-gpu-video-modeline-os-settings.js (per-port OS keys, patches),
## the pure half of -video-modeline.js (what the controls start as). The timing-preview half is
## gpu_modeline_preview.gd. Golden-tested (test_devices_gpu_output.gd).

const R := preload("res://features/devices/cable_rules.gd")
const S := preload("res://features/devices/cable_seed.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const H := preload("res://features/devices/host_channels.gd")
const OS_ALIASES := {"1080p50": "1080p5000", "720p50": "720p5000", "1080p60": "1080p6000", "720p60": "720p6000",
	"1080p59.94": "1080p5994", "720p59.94": "720p5994"}
const MODE_ALIASES := {"1080p50": "1080p5000", "720p50": "720p5000", "1080p60": "1080p6000", "720p60": "720p6000",
	"1080p59.94": "1080p5994", "720p59.94": "720p5994", "1080p25": "1080p2500", "720p25": "720p2500",
	"2160p50": "2160p5000", "2160p60": "2160p6000"}
const TIMING_OPTIONS := [["cvt", "CVT (default)"], ["gtf", "GTF"], ["cvt_r", "CVT reduced blanking (-r)"]]
const BACKEND_OPTIONS := [["xrandr", "Apply via X (xrandr)"], ["nvidia", "Apply via NVIDIA"]]


## JS Number(v): null → 0, "" → 0, numeric text → the number, anything else → NAN.
static func js_num(v: Variant) -> float:
	if v == null:
		return 0.0
	if v is bool:
		return 1.0 if v else 0.0
	if v is int or v is float:
		return float(v)
	var s := R.s(v).strip_edges()
	if s == "":
		return 0.0
	return float(s) if s.is_valid_float() else NAN


## JS `${number}` for the values this page prints (ints, 2-decimal rates): no exponent, no trailing zeros.
static func js_num_str(v: Variant) -> String:
	if v is String:
		return v
	var f := js_num(v)
	if is_nan(f):
		return "NaN"
	if is_equal_approx(f, roundf(f)) and absf(f) < 1e15:
		return str(int(roundf(f)))
	var s := String.num(f, 10)
	if s.contains("."):
		s = s.rstrip("0").rstrip(".")
	return s


## Math.max(lo, parseInt(String(v || def), 10) || def)
static func _int_or(v: Variant, def: int, lo: int) -> int:
	var raw: Variant = v if H.truthy(v) else def
	var n: Variant = S._int(raw)
	return maxi(lo, n if n != null and n != 0 else def)


static func _float_or(v: Variant, def: float, lo: float) -> float:
	var raw: Variant = v if H.truthy(v) else def
	var n: Variant = S._float(raw)
	return maxf(lo, n if n != null and n != 0.0 else def)


## cs[k] ?? settings.casparServer[k] ?? settings[k]  (readPortOsValue; screen index clamped 1–4)
static func read_port_os(cs: Dictionary, settings: Variant, n: int, suffix: String) -> Variant:
	var k := "screen_%d_%s" % [clampi(n, 1, 4), suffix]
	return H.coalesce([cs.get(k), R.d(R.d(settings).get("casparServer")).get(k), R.d(settings).get(k)])


static func match_mode(w: Variant, h: Variant, fps: Variant) -> String:
	var wi: Variant = S._int(w)
	var hi: Variant = S._int(h)
	var ww := maxi(0, wi if wi != null else 0)
	var hh := maxi(0, hi if hi != null else 0)
	if ww <= 0 or hh <= 0:
		return ""
	var f := js_num(fps)
	var rate: Variant = f if not is_nan(f) and f > 0.0 else null
	for mode in DM.STANDARD_VIDEO_MODES:
		var spec := S.mode_spec(mode)
		if spec.is_empty():
			continue
		if spec.width == ww and spec.height == hh and (rate == null or absf(float(spec.fps) - rate) <= 0.06):
			return mode
	return ""


static func normalize_mode_id(raw: Variant) -> String:
	var id := R.s(raw).strip_edges()
	if id == "":
		return ""
	if id == "custom":
		return "custom"
	var aliased: String = MODE_ALIASES.get(id, id)
	if aliased in DM.STANDARD_VIDEO_MODES:
		return aliased
	var px := RegEx.create_from_string("(?i)^(\\d+)\\s*x\\s*(\\d+)p?([\\d.]+)?$").search(aliased)
	if px:
		var fps: Variant = S._float(px.get_string(3)) if px.get_string(3) != "" else null
		var matched := match_mode(px.get_string(1), px.get_string(2), fps if fps != null else NAN)
		return matched if matched != "" else "custom"
	return aliased


## casparVideoModeToOsModeAndRate → {osMode, osRate} or {}.
static func os_mode_and_rate(mode_id: Variant, opts: Dictionary) -> Dictionary:
	var raw := R.s(mode_id).strip_edges()
	var id: String = OS_ALIASES.get(raw, raw)
	var fps := _float_or(opts.get("customFps"), 50.0, 1.0)
	if id == "" or id == "custom":
		return {"osMode": "%dx%d" % [_int_or(opts.get("customWidth"), 1920, 64), _int_or(opts.get("customHeight"), 1080, 64)], "osRate": fps}
	var spec := S.mode_spec(id)
	if not spec.is_empty():
		return {"osMode": "%dx%d" % [spec.width, spec.height], "osRate": float(spec.fps)}
	var m := RegEx.create_from_string("(?i)^(\\d+)\\s*x\\s*(\\d+)$").search(id)
	if m:
		var w: Variant = S._int(m.get_string(1))
		var h: Variant = S._int(m.get_string(2))
		return {"osMode": "%dx%d" % [w if w else 1920, h if h else 1080], "osRate": fps}
	return {}


## readScreenCasparOsDims: the bound screen's Caspar mode as an OS mode (Override applies xrandr from Video Mode).
static func screen_os_dims(cs: Dictionary, settings: Variant, screen_n: int) -> Dictionary:
	var n := clampi(screen_n, 1, 4)
	var scs := R.d(R.d(settings).get("casparServer"))
	var project := S.default_video_mode(settings)
	var k := "screen_%d_mode" % n
	var mode := R.s(H.coalesce([cs.get(k), scs.get(k), R.d(settings).get(k), project])).strip_edges()
	var dim := func(suffix: String, def: Variant) -> Variant:
		return H.coalesce([cs.get("screen_%d_%s" % [n, suffix]), scs.get("screen_%d_%s" % [n, suffix]), def])
	return os_mode_and_rate(mode if mode != "" else project, {"customWidth": dim.call("custom_width", 1920),
		"customHeight": dim.call("custom_height", 1080), "customFps": dim.call("custom_fps", 50)})


## formatModeOption: a live display mode row → {mode, randrMode, rate, label, current}, {} when unusable.
static func format_mode_option(m: Variant) -> Dictionary:
	var d := R.d(m)
	var w: Variant = S._int(H.coalesce([d.get("width"), 0]))
	var h: Variant = S._int(H.coalesce([d.get("height"), 0]))
	if w == null or h == null or w <= 0 or h <= 0:
		return {}
	var hz := js_num(d.get("hz"))
	var hz_txt := ""
	if not is_nan(hz) and hz > 0.0:
		hz_txt = js_num_str(roundf(hz * 100.0) / 100.0)
	var randr := R.s(d.get("randrMode")).strip_edges()
	if randr == "":
		randr = "%dx%d" % [w, h]
	return {"mode": "%dx%d" % [w, h], "randrMode": randr, "rate": hz_txt,
		"label": "%s @ %s Hz" % [randr, hz_txt] if hz_txt != "" else randr, "current": d.get("current") == true}


static func unique_modes(display: Dictionary) -> Array:
	var out := []
	for m in R.a(display.get("modes")):
		var o := format_mode_option(m)
		if o.is_empty():
			continue
		if out.any(func(x: Dictionary) -> bool: return x.randrMode == o.randrMode and x.rate == o.rate):
			continue
		out.append(o)
	return out


## parseEdidPreferredMode: "3840x2160@50Hz" → {w, h, r}, {} otherwise.
static func parse_edid_preferred(v: Variant) -> Dictionary:
	var m := RegEx.create_from_string("(?i)^(\\d+)x(\\d+)@([\\d.]+)").search(R.s(v))
	if not m:
		return {}
	var w := int(m.get_string(1))
	var h := int(m.get_string(2))
	var r: Variant = S._float(m.get_string(3))
	if w <= 0 or h <= 0 or r == null or r <= 0.0:
		return {}
	return {"w": w, "h": h, "r": r}


static func edid_selectable(pref: Dictionary, modes: Array) -> bool:
	if pref.is_empty():
		return true
	return modes.any(func(m: Dictionary) -> bool: return m.get("mode") == "%dx%d" % [pref.w, pref.h])


## casparVideoModeFromDetectedDisplay → {modeId[, width, height, fps]} or {}.
static func mode_from_display(display: Dictionary, modes: Array, preferred_idx: int) -> Dictionary:
	var pick := {}
	if preferred_idx >= 0 and preferred_idx < modes.size():
		pick = modes[preferred_idx]
	if pick.is_empty():
		for m in modes:
			if m.get("current") == true:
				pick = m
				break
		if pick.is_empty() and not modes.is_empty():
			pick = modes[0]
	if H.truthy(pick.get("mode")):
		var mm := RegEx.create_from_string("(?i)^(\\d+)x(\\d+)$").search(str(pick.mode))
		if mm:
			var raw := R.s(pick.rate) if H.truthy(pick.get("rate")) else (js_num_str(display.refreshHz) if H.truthy(display.get("refreshHz")) else "")
			var fps: Variant = S._float(raw)
			return _mode_or_custom(int(mm.get_string(1)), int(mm.get_string(2)), fps if fps != null else NAN)
	var mr := RegEx.create_from_string("^(\\d+)x(\\d+)$").search(R.s(display.get("resolution")))
	if mr:
		return _mode_or_custom(int(mr.get_string(1)), int(mr.get_string(2)), js_num(display.get("refreshHz")))
	return {}


static func _mode_or_custom(w: int, h: int, fps: float) -> Dictionary:
	var matched := match_mode(w, h, fps)
	if matched != "":
		return {"modeId": matched}
	return {"modeId": "custom", "width": w, "height": h, "fps": fps if not is_nan(fps) and fps > 0.0 else 50.0}


## resolveGpuInspectorVideoMode (display only): saved key vs live candidates (connector mode, cable feed, physical
## Caspar mode, detected display); a generic saved default loses to the first live candidate.
static func resolve_video_mode(cs: Dictionary, settings: Variant, screen_n: int, conn: Dictionary, inherited: Dictionary,
		display: Dictionary, modes: Array, default_idx: int, physical_mode: Variant) -> Dictionary:
	var project := S.default_video_mode(settings)
	var scs := R.d(R.d(settings).get("casparServer"))
	var k := "screen_%d_mode" % screen_n
	var saved_raw: Variant = H.coalesce([cs.get(k), scs.get(k), R.d(settings).get(k)])
	var saved_norm := normalize_mode_id(saved_raw) if saved_raw != null and R.s(saved_raw).strip_edges() != "" else ""
	var read_custom := func(suffix: String, def: Variant) -> Variant:
		var kk := "screen_%d_%s" % [screen_n, suffix]
		return H.coalesce([cs.get(kk), scs.get(kk), def])
	var from := func(raw: Variant, dims: Dictionary) -> Dictionary:
		var norm := normalize_mode_id(raw)
		if norm == "custom" or (not norm in DM.STANDARD_VIDEO_MODES and not dims.is_empty()):
			return {"modeId": "custom", "width": H.coalesce([dims.get("width"), 1920]), "height": H.coalesce([dims.get("height"), 1080]),
				"fps": H.coalesce([dims.get("fps"), 50])}
		if norm in DM.STANDARD_VIDEO_MODES:
			return {"modeId": norm}
		return {}
	var saved: Dictionary = from.call(saved_norm, {"width": read_custom.call("custom_width", 1920),
		"height": read_custom.call("custom_height", 1080), "fps": read_custom.call("custom_fps", 50)}) if saved_norm != "" else {}
	var live := []
	var cmode: Variant = R.d(conn.get("caspar")).get("mode")
	if H.truthy(cmode):
		live.append(from.call(cmode, inherited))
	if H.truthy(inherited.get("mode")):
		live.append(from.call(inherited.mode, {"width": inherited.get("width"), "height": inherited.get("height"), "fps": inherited.get("fps")}))
	if H.truthy(physical_mode):
		live.append(from.call(physical_mode, inherited))
	var edid := mode_from_display(display, modes, default_idx)
	if not edid.is_empty():
		live.append(edid)
	var generic := [project, "1080p5000", "720p5000", ""]
	var first := {}
	for c in live:
		if H.truthy(c.get("modeId")):
			first = c
			break
	var sid := R.s(saved.get("modeId"))
	if sid != "" and sid in generic and H.truthy(first.get("modeId")):
		return first
	if sid != "" and not sid in generic:
		return saved
	if not first.is_empty():
		return first
	if not saved.is_empty():
		return saved
	return {"modeId": project}


## listSiblingGpuPortsOnCasparScreen: other gpu_out connectors bound to the same Caspar screen.
static func sibling_ports(conn: Dictionary, payload: Dictionary, screen_n: int) -> Array:
	var out := []
	for c in R.a(R.d(payload.get("suggested")).get("connectors")):
		if not c is Dictionary or c.get("kind") != "gpu_out" or R.s(c.get("id")) == R.s(conn.get("id")):
			continue
		if S.screen_number(c, payload) == screen_n:
			var cid := R.gpu_port_cable_id(R.s(c.get("id")))
			out.append(cid if cid != "" else R.s(H.coalesce([c.get("label"), c.get("id")])))
	return out


## resolveCableSourceResolution for this jack's incoming cable → {mode, width, height, fps, label} or {}.
static func inherited_feed(conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary and R.s(e.get("sinkId")) == R.s(conn.get("id")):
			var src := S.feed_source(payload, R.s(e.get("sourceId")))
			if src.is_empty():
				return {}
			return {"mode": R.s(src.get("videoMode")) if H.truthy(src.get("videoMode")) else S.default_video_mode(settings),
				"width": _int_or(src.get("width"), 1920, 64), "height": _int_or(src.get("height"), 1080, 64),
				"fps": _float_or(src.get("fps"), 50.0, 1.0), "label": R.s(H.coalesce([src.get("label"), src.get("id")]))}
	return {}


## What the modeline controls start as (populateGpuVideoModelineSection's reads). `display` = the detected display
## ({} = none), `screen_n` = Caspar screen (mode keys), `os_n` = rear port (OS keys).
static func state(conn: Dictionary, payload: Dictionary, cs: Dictionary, settings: Variant, display: Dictionary,
		screen_n: int, os_n: int, physical_mode: Variant) -> Dictionary:
	var st := {}
	var inherited := inherited_feed(conn, payload, settings)
	st.feed_note = "%s: %d×%d @ %s Hz" % [inherited.label, inherited.width, inherited.height, js_num_str(inherited.fps)] if not inherited.is_empty() else ""
	var siblings := sibling_ports(conn, payload, screen_n)
	st.screen_note = "Caspar screen %d — shared with %s" % [screen_n, ", ".join(siblings)] if not siblings.is_empty() else ""
	var edid := R.d(H.coalesce([display.get("monitor"), R.d(display.get("edid")).get("parsed")]))
	var pref := parse_edid_preferred(edid.get("preferredMode"))
	var modes := unique_modes(display)
	st.modes = modes
	var saved_mode := R.s(read_port_os(cs, settings, os_n, "os_mode")).strip_edges()
	var saved_rate: Variant = read_port_os(cs, settings, os_n, "os_rate")
	var saved_source := R.s(read_port_os(cs, settings, os_n, "os_mode_source")).strip_edges().to_lower()
	var match_idx := -1
	for i in modes.size():
		var m: Dictionary = modes[i]
		if m.randrMode == saved_mode or m.mode == saved_mode:
			if saved_rate == null or (saved_rate is String and saved_rate == "") or str(m.rate) == js_num_str(saved_rate):
				match_idx = i
				break
	var bare := RegEx.create_from_string("(?i)^(\\d+)x(\\d+)$").search(saved_mode)
	var selectable := edid_selectable(pref, modes)
	st.prefer_custom = saved_source == "custom" or (saved_source == "" and bare != null and match_idx < 0) or (saved_mode == "" and not selectable)
	var current_idx := -1
	for i in modes.size():
		if modes[i].current:
			current_idx = i
			break
	st.default_idx = match_idx if match_idx >= 0 else (current_idx if current_idx >= 0 else 0)
	var resolved := resolve_video_mode(cs, settings, screen_n, conn, inherited, display, modes, st.default_idx, physical_mode)
	var mode_id := R.s(H.coalesce([resolved.get("modeId"), S.default_video_mode(settings)]))
	st.mode = mode_id if mode_id != "custom" and mode_id in DM.STANDARD_VIDEO_MODES else "custom"
	st.prev_standard = st.mode if st.mode != "custom" else ""
	var scs := R.d(R.d(settings).get("casparServer"))
	var dim := func(suffix: String, def: Variant) -> Variant:
		return H.coalesce([cs.get("screen_%d_%s" % [screen_n, suffix]), scs.get("screen_%d_%s" % [screen_n, suffix]), def])
	st.custom = {"w": _int_or(H.coalesce([resolved.get("width"), dim.call("custom_width", H.coalesce([inherited.get("width"), 1920])), 1920]), 1920, 64),
		"h": _int_or(H.coalesce([resolved.get("height"), dim.call("custom_height", H.coalesce([inherited.get("height"), 1080])), 1080]), 1080, 64),
		"fps": _float_or(H.coalesce([resolved.get("fps"), dim.call("custom_fps", H.coalesce([inherited.get("fps"), 50])), 50]), 50.0, 1.0)}
	st.custom_option_label = "Custom (register RandR mode) — EDID native %dx%d @ %s" % [pref.w, pref.h, js_num_str(pref.r)] \
		if not selectable and not pref.is_empty() else "Custom (register RandR mode)"
	st.display_sel = "custom" if st.prefer_custom else str(st.default_idx)
	if bare:
		st.os_custom = {"w": int(bare.get_string(1)), "h": int(bare.get_string(2)), "r": _float_or(H.coalesce([saved_rate, 50]), 50.0, 1.0)}
	else:
		var od := screen_os_dims(cs, settings, screen_n)
		var mm := RegEx.create_from_string("(?i)^(\\d+)x(\\d+)$").search(R.s(od.get("osMode")))
		if mm:
			st.os_custom = {"w": int(mm.get_string(1)), "h": int(mm.get_string(2)), "r": _float_or(H.coalesce([od.get("osRate"), 50]), 50.0, 1.0)}
		else:
			st.os_custom = {"w": pref.w, "h": pref.h, "r": float(pref.r)} if not pref.is_empty() else {"w": 1920, "h": 1080, "r": 50.0}
	var force: Variant = read_port_os(cs, settings, os_n, "force_os_resolution")
	st.override = (force is bool and force) or (force is String and force == "true")
	var name := R.s(edid.get("monitorName")).strip_edges()
	var serial := R.s(edid.get("serial")).strip_edges()
	st.edid_headline = "EDID: %s%s" % [name, " (%s)" % serial if serial != "" else ""] if name != "" \
		else ("No EDID received" if H.truthy(display.get("connected")) else "No display connected")
	st.edid_warn = name == ""
	st.display_name = R.s(display.get("name")) if H.truthy(display.get("name")) else ""
	st.modes_label = "Detected modes on %s" % st.display_name if st.display_name != "" else "Detected modes (from display)"
	var timing := R.s(H.coalesce([read_port_os(cs, settings, os_n, "os_timing_source") if H.truthy(read_port_os(cs, settings, os_n, "os_timing_source")) else null, "cvt"])).strip_edges().to_lower().replace("-", "_")
	st.timing = timing if timing == "gtf" or timing == "cvt_r" else "cvt"
	var backend: Variant = read_port_os(cs, settings, os_n, "os_backend")
	st.backend = "nvidia" if R.s(H.coalesce([backend if H.truthy(backend) else null, "xrandr"])).strip_edges().to_lower() == "nvidia" else "xrandr"
	st.display = display
	return st


## The detected-modes select: one row per unique mode, then Custom (label carries the unselectable EDID native).
static func display_options(st: Dictionary) -> Array:
	var out := []
	for i in st.modes.size():
		out.append([str(i), st.modes[i].label])
	out.append(["custom", st.custom_option_label])
	return out


## videoModeToResolution for a mode just left (switching TO custom starts from it): {w, h, fps}.
static func custom_from_mode(mode: String) -> Dictionary:
	var r := S.mode_resolution(mode)
	return {"w": r.w, "h": r.h, "fps": H.coalesce([r.get("fps"), 50])}


## readOsResolutionFromUi → {source, mode, rate} (rate "" when the pick has none).
static func os_resolution(ui: Dictionary, st: Dictionary) -> Dictionary:
	if ui.display == "custom":
		var w := _int_or(ui.os_w, 1920, 64)
		var h := _int_or(ui.os_h, 1080, 64)
		return {"source": "custom", "mode": "%dx%d" % [w, h], "rate": _float_or(ui.os_fps, 50.0, 1.0)}
	var idx: Variant = S._int(R.s(H.coalesce([ui.display if H.truthy(ui.display) else null, 0])))
	var i: int = idx if idx != null else 0
	var modes: Array = st.modes
	var pick: Dictionary = modes[i] if i >= 0 and i < modes.size() else {}
	var randr := R.s(pick.get("randrMode")).strip_edges()
	var res := RegEx.create_from_string("^(\\d+)x(\\d+)$").search(R.s(st.display.get("resolution")))
	var mode := randr if randr != "" else R.s(pick.get("mode")) if H.truthy(pick.get("mode")) else ("%sx%s" % [res.get_string(1), res.get_string(2)] if res else "")
	var hz: Variant = st.display.get("refreshHz")
	var rate_raw := R.s(pick.get("rate")) if H.truthy(pick.get("rate")) else (js_num_str(hz) if hz != null and not is_nan(js_num(hz)) else "")
	var rate: Variant = S._float(rate_raw) if rate_raw != "" else ""
	return {"source": "edid", "mode": mode, "rate": rate if rate != null else NAN}


## buildGlobalOsFieldsFromUi: ui also carries `backend` and `timing`.
static func os_fields(ui: Dictionary, st: Dictionary) -> Dictionary:
	var os := os_resolution(ui, st)
	return {"os_mode": os.mode, "os_rate": os.rate, "os_mode_source": os.source,
		"os_backend": "nvidia" if ui.backend == "nvidia" else "xrandr",
		"os_timing_source": ui.timing if ui.timing == "gtf" or ui.timing == "cvt_r" else "cvt", "force_os_resolution": bool(ui.override)}


static func per_port_os_patch(os_n: int, fields: Dictionary, system_id: Variant) -> Dictionary:
	var n := clampi(os_n, 1, 4)
	var patch := {}
	for suffix in ["os_mode", "os_rate", "os_backend", "os_timing_source", "os_mode_source", "force_os_resolution"]:
		patch["screen_%d_%s" % [n, suffix]] = fields.get(suffix)
	var sid := R.s(system_id).strip_edges()
	if sid != "":
		patch["screen_%d_system_id" % n] = sid
	return patch
