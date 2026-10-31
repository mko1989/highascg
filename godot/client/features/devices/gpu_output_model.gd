extends RefCounted
## WO-605 slice 4 — pure port of the GPU-output inspector's consumer side (web device-view-inspector-gpu.js +
## device-view-inspector-gpu-resolve.js + screen-consumer-defaults.js): the summary rows, the detected display behind a
## rear jack, what every toggle / field starts as, and the POST /api/settings bodies the page sends (save, reset;
## no pointer-confine select since WO-889 — confine follows the operator monitor automatically). Video mode keys follow the Caspar screen the jack is bound to (`screen_n`); consumer / OS keys
## follow the rear port (`port_n`). Golden-tested (test_devices_gpu_output.gd).

const R := preload("res://features/devices/cable_rules.gd")
const S := preload("res://features/devices/cable_seed.gd")
const H := preload("res://features/devices/host_channels.gd")
const GM := preload("res://features/devices/gpu_modeline_model.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const STRETCH_OPTIONS := ["none", "fill", "uniform", "uniform_to_fill"]
const COLOUR_OPTIONS := ["RGB", "datavideo-full", "datavideo-limited"]
## [key, label, tooltip] in the web's toggle-row order (Fullscreen / Windowed / Border / V-sync are the base flags).
const TOGGLES := [
	["key_only", "Key only", "Output only key channel"],
	["aot", "Always on top", "Keep window always on top"],
	["operator_monitor", "Operator monitor", "Primary X11 output, confine cursor here, and enable interactive on this consumer"],
	["interactive", "Interactive", "Caspar interactive mouse/keyboard on this screen consumer (confine also allows pointer here)"],
	["nvidia_sync", "NVIDIA sync to display", "Sync to this display: NVIDIA OpenGL/XVideo target AND Caspar GL swap vblank (WO-407). Unticked everywhere = automatic: the first PGM screen (WO-888). Ignored on the operator monitor"],
	["sbs_key", "SBS Key", "Side-by-side key"],
	["force_linear", "Force linear filter", "Force linear filtering"],
	["mipmaps", "Enable mipmaps", "Enable mipmaps for scaling"],
	["high_bitdepth", "High bitdepth", "Use high bitdepth"],
]
const RESET_TIP := "Clears CasparCG mode, windowed/vsync toggles, and OS-level system ID / resolution for this screen index."


static func _flag(v: Variant) -> bool:
	return (v is bool and v) or (v is String and v == "true")


static func _not_false(v: Variant) -> bool:
	return not ((v is bool and not v) or (v is String and v == "false"))


## String(v || def)
static func _str_or(v: Variant, def: String) -> String:
	return R.s(v) if H.truthy(v) else def


static func port_row(conn: Dictionary, payload: Dictionary) -> Dictionary:
	var cid := R.gpu_port_cable_id(R.s(conn.get("id")))
	for p in R.gpu_ports(payload):
		if p is Dictionary and R.s(p.get("physicalPortId")).strip_edges() == cid:
			return p
	return {}


## resolveGpuDetectedDisplay: the live RandR display behind a rear jack (topology pair → the active output, else the
## first connected, else any). `settings` feeds the saved-topology fallback.
static func detected_display(conn: Dictionary, payload: Dictionary, settings: Variant) -> Dictionary:
	var displays := R.a(R.d(R.d(payload.get("live")).get("gpu")).get("displays"))
	var cid := R.gpu_port_cable_id(R.s(conn.get("id")))
	var by_id := port_row(conn, payload)
	var topo_row := {}
	for t in R.topology(payload, settings):
		if t is Dictionary and R.s(t.get("physicalPortId")).strip_edges() == cid:
			topo_row = t
			break
	var pair := topo_row if not topo_row.is_empty() else R.d(by_id.get("pair")) if H.truthy(by_id.get("pair")) else R.d(R.d(conn.get("gpuPhysical")).get("pair"))
	var names := []
	for k in ["dpA", "dpB"]:
		if H.truthy(pair.get(k)):
			names.append(R.s(pair[k]).strip_edges())
	var find := func(name: String) -> Dictionary:
		var want := R.norm_randr(name)
		if want == "":
			return {}
		for x in displays:
			if x is Dictionary and R.norm_randr(x.get("name")) == want:
				return x
		return {}
	if not by_id.is_empty():
		var rt := R.d(by_id.get("runtime"))
		var active := R.s(H.coalesce([rt.get("activePort") if H.truthy(rt.get("activePort")) else null, rt.get("xrandrName")])).strip_edges()
		if active != "" and names.any(func(p: String) -> bool: return R.norm_randr(p) == R.norm_randr(active)):
			var d: Dictionary = find.call(active)
			if not d.is_empty():
				return d
	for name in names:
		var d: Dictionary = find.call(name)
		if H.truthy(d.get("connected")):
			return d
	for name in names:
		var d: Dictionary = find.call(name)
		if not d.is_empty():
			return d
	return {}


## The Caspar mode the live port row (or the display) reports — one of the video-mode candidates.
static func physical_mode(conn: Dictionary, payload: Dictionary, display: Dictionary) -> Variant:
	var m: Variant = R.d(port_row(conn, payload).get("runtime")).get("casparMode")
	return m if H.truthy(m) else (display.get("casparMode") if H.truthy(display.get("casparMode")) else null)


static func mode_options() -> Array:
	var out := [["custom", "Custom"]]
	for m in DM.STANDARD_VIDEO_MODES:
		out.append([m, m])
	return out


## The per-port OS save body (`ui` = gpu_output_ui.gd's dict): system_id = the detected display's RandR name.
static func os_patch(st: Dictionary, mst: Dictionary, ui: Dictionary) -> Dictionary:
	return GM.per_port_os_patch(st.port_n, GM.os_fields(ui, mst), mst.display_name)


## gpuOutputIsMultiviewBound: multiview binding, or cabled to a multiview destination.
static func is_multiview_bound(conn: Dictionary, payload: Dictionary) -> bool:
	if R.s(R.d(R.d(conn.get("caspar")).get("outputBinding")).get("type")).to_lower() == "multiview":
		return true
	for e in R.a(R.d(payload.get("graph")).get("edges")):
		if e is Dictionary and R.s(e.get("sinkId")) == R.s(conn.get("id")):
			var src := R.s(e.get("sourceId"))
			if not src.begins_with("dst_in_"):
				return false
			for d in R.a(R.d(payload.get("screenDestinations")).get("destinations")):
				if d is Dictionary and R.s(d.get("id")) == src.trim_prefix("dst_in_"):
					return R.s(d.get("mode")).to_lower() == "multiview"
			return false
	return false


## buildGpuInspectorSummaryRows → [[label, value, strong]…] (Monitor is bold when an EDID name is known).
static func summary_rows(conn: Dictionary, payload: Dictionary, settings: Variant) -> Array:
	var display := detected_display(conn, payload, settings)
	var rt := R.d(port_row(conn, payload).get("runtime"))
	var edid := R.d(H.coalesce([display.get("monitor"), R.d(display.get("edid")).get("parsed"), rt.get("monitor")]))
	var monitor := R.s(edid.get("monitorName")).strip_edges()
	var serial := R.s(edid.get("serial")).strip_edges() if H.truthy(edid.get("serial")) else ""
	var preferred := R.s(edid.get("preferredMode")).strip_edges().replace(" ", "\u00a0") if H.truthy(edid.get("preferredMode")) else ""
	var hz := GM.js_num(display.get("refreshHz"))
	var current := ""
	if H.truthy(display.get("resolution")):
		current = "%s @ %s Hz" % [display.resolution, GM.js_num_str(display.refreshHz)] if display.get("refreshHz") != null and not is_nan(hz) else R.s(display.resolution)
	current = current.replace(" ", "\u00a0")
	var os_out := R.s(H.coalesce([rt.get("xrandrName") if H.truthy(rt.get("xrandrName")) else null,
		rt.get("activePort") if H.truthy(rt.get("activePort")) else null, display.get("name")])).strip_edges()
	var status := "Connected" if H.truthy(display.get("connected")) or H.truthy(rt.get("connected")) else "Disconnected"
	var warn_re := RegEx.create_from_string("(?i)gpu_enum|edid_")
	var warnings := []
	for w in R.a(R.d(payload.get("live")).get("warnings")):
		if warn_re.search(R.s(w)):
			warnings.append(R.s(w))
	var rows := [["Rear port", R.s(H.coalesce([conn.get("label") if H.truthy(conn.get("label")) else null, conn.get("id") if H.truthy(conn.get("id")) else null, "—"])), false],
		["OS output", os_out if os_out != "" else "—", false],
		["Monitor", monitor if monitor != "" else ("No EDID received" if status == "Connected" else "—"), monitor != ""],
		["Serial", serial if serial != "" else "—", false], ["Current mode", current if current != "" else "—", false],
		["EDID preferred mode", preferred if preferred != "" else "—", false], ["Status", status, false]]
	if not warnings.is_empty():
		rows.append(["GPU warnings", "; ".join(warnings), false])
	return rows


## Per-port key for a consumer flag; the multiview jack shares multiview_always_on_top / multiview_interactive.
static func key(port_n: int, suffix: String, mv: bool) -> String:
	if mv and (suffix == "always_on_top" or suffix == "interactive"):
		return "multiview_" + suffix
	return "screen_%d_%s" % [port_n, suffix]


## Everything renderGpuOutControls reads before building: indices, the seed write it fires, and each control's start.
static func consumer_state(cs: Dictionary, _settings: Variant, conn: Dictionary, payload: Dictionary) -> Dictionary:
	var st := {"screen_n": S.screen_number(conn, payload), "port_n": S.physical_screen_index(conn, payload),
		"mv": is_multiview_bound(conn, payload)}
	var n: int = st.port_n
	var seed := S.screen_seed_caspar_patch(cs, n)
	var seed_mv: bool = st.mv and cs.get("multiview_always_on_top") == null
	st.seed_patch = {}
	if not seed.is_empty() or seed_mv:
		var patch := seed.duplicate()
		if seed_mv:
			patch.multiview_always_on_top = false
		st.seed_patch = {"casparServer": patch}
	var flags := cs.duplicate()
	flags.merge(seed, true)
	var k := "screen_%d_" % n
	if flags.get(k + "windowed") == null and flags.get(k + "borderless") == null and flags.get(k + "vsync") == null:
		st.windowed = S.SCREEN_DEFAULTS.windowed
		st.vsync = S.SCREEN_DEFAULTS.vsync
		st.borderless = S.SCREEN_DEFAULTS.borderless
	else:
		st.windowed = S.SCREEN_DEFAULTS.windowed if flags.get(k + "windowed") == null else _not_false(flags.get(k + "windowed"))
		st.vsync = S.SCREEN_DEFAULTS.vsync if flags.get(k + "vsync") == null else _flag(flags.get(k + "vsync"))
		st.borderless = S.SCREEN_DEFAULTS.borderless if flags.get(k + "borderless") == null else _not_false(flags.get(k + "borderless"))
	st.edid_override = _str_or(cs.get("screen_%d_edid_override" % st.screen_n), _str_or(R.d(conn.get("caspar")).get("edidOverride"), ""))
	st.stretch = _str_or(cs.get(k + "stretch"), "none")
	st.key_only = _flag(cs.get(k + "key_only"))
	st.aot = (false if seed_mv else _flag(cs.get("multiview_always_on_top"))) if st.mv else _not_false(cs.get(k + "always_on_top"))
	st.interactive = _flag(cs.get(key(n, "interactive", st.mv)))
	st.operator_monitor = _flag(cs.get(k + "operator_monitor"))
	st.nvidia_sync = _flag(cs.get(k + "nvidia_sync_to_display"))
	st.sbs_key = _flag(cs.get(k + "sbs_key"))
	st.colour = _str_or(cs.get(k + "colour_space"), "RGB")
	st.force_linear = _not_false(cs.get(k + "force_linear_filter"))
	st.mipmaps = _flag(cs.get(k + "enable_mipmaps"))
	st.high_bitdepth = _flag(cs.get(k + "high_bitdepth"))
	st.name = _str_or(cs.get(k + "name"), "")
	st.ar = _str_or(cs.get(k + "aspect_ratio"), "")
	st.pos_x = GM.js_num_str(H.coalesce([cs.get(k + "x"), 0]))
	st.pos_y = GM.js_num_str(H.coalesce([cs.get(k + "y"), 0]))
	return st


## saveCasparSettings' body. `ui` = the live control values: windowed / vsync / border / the TOGGLES keys (bools),
## mode / custom_w / custom_h / custom_fps / stretch / colour / name / ar / pos_x / pos_y (texts).
static func caspar_patch(st: Dictionary, ui: Dictionary) -> Dictionary:
	var n: int = st.port_n
	var mv: bool = st.mv
	var k := "screen_%d_" % n
	var selected := _str_or(ui.get("mode"), "1080p5000").strip_edges()
	var p := {k + "windowed": bool(ui.windowed), k + "vsync": bool(ui.vsync), k + "borderless": not ui.border,
		"screen_%d_mode" % st.screen_n: selected,
		"screen_%d_custom_width" % st.screen_n: GM._int_or(ui.custom_w, 1920, 64),
		"screen_%d_custom_height" % st.screen_n: GM._int_or(ui.custom_h, 1080, 64),
		"screen_%d_custom_fps" % st.screen_n: GM._float_or(ui.custom_fps, 50.0, 1.0),
		k + "stretch": ui.stretch, k + "key_only": bool(ui.key_only), key(n, "always_on_top", mv): bool(ui.aot),
		k + "sbs_key": bool(ui.sbs_key), k + "colour_space": ui.colour, k + "force_linear_filter": bool(ui.force_linear),
		k + "enable_mipmaps": bool(ui.mipmaps), k + "high_bitdepth": bool(ui.high_bitdepth),
		k + "name": R.s(ui.name).strip_edges(), k + "aspect_ratio": R.s(ui.ar).strip_edges(),
		k + "x": _pos(ui.pos_x), k + "y": _pos(ui.pos_y)}
	p[key(n, "interactive", mv)] = true if ui.operator_monitor else bool(ui.interactive)
	for spec in [["operator_monitor", "operator_monitor"], ["nvidia_sync", "nvidia_sync_to_display"]]:
		if ui[spec[0]]:
			for i in range(1, 5):
				p["screen_%d_%s" % [i, spec[1]]] = i == n
		else:
			p[k + spec[1]] = false
	return {"casparServer": p}


## parseInt(text, 10) || 0
static func _pos(text: Variant) -> int:
	var n: Variant = S._int(text)
	return n if n != null else 0


static func save_status(ui: Dictionary, st: Dictionary) -> String:
	if ui.operator_monitor:
		return "GPU port %d: operator monitor — primary + confine + interactive (apply OS layout + Caspar restart)" % st.port_n
	if ui.interactive:
		return "GPU port %d: interactive on — Caspar mouse input (Caspar restart for <interactive>)" % st.port_n
	return "GPU port %d (Caspar screen %d) saved" % [st.port_n, st.screen_n]


## "Reset all settings for this screen": every per-screen key → null, consumer flags back to the defaults.
static func reset_patch(st: Dictionary) -> Dictionary:
	var n: int = st.port_n
	var sn: int = st.screen_n
	var k := "screen_%d_" % n
	var p := {"screen_%d_mode" % sn: null, k + "windowed": S.SCREEN_DEFAULTS.windowed, k + "borderless": S.SCREEN_DEFAULTS.borderless,
		k + "vsync": S.SCREEN_DEFAULTS.vsync}
	for suffix in ["custom_width", "custom_height", "custom_fps", "edid_override"]:
		p["screen_%d_%s" % [sn, suffix]] = null
	for suffix in ["system_id", "os_mode", "os_rate", "os_backend", "os_timing_source", "stretch", "key_only"]:
		p[k + suffix] = null
	p[key(n, "always_on_top", st.mv)] = null
	p[key(n, "interactive", st.mv)] = null
	for suffix in ["operator_monitor", "nvidia_sync_to_display", "sbs_key", "colour_space", "force_linear_filter", "enable_mipmaps",
			"high_bitdepth", "name", "aspect_ratio", "x", "y"]:
		p[k + suffix] = null
	return {"casparServer": p}



## The small "Physical: …" line under OS / X11 Settings.
static func physical_line(st: Dictionary, display_name: String) -> String:
	var phys := display_name if display_name != "" else "None"
	var tail := " · rear port %d · Caspar screen %d" % [st.port_n, st.screen_n] if st.port_n != st.screen_n else " · port / Caspar screen %d" % st.port_n
	return "Physical: %s%s" % [phys, tail]
