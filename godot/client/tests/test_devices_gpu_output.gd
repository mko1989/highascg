extends RefCounted
## WO-605 slice 4 — gpu_output_model.gd / gpu_modeline_model.gd / gpu_modeline_preview.gd / gpu_output_ui.gd against
## the web GPU-output inspector (device-view-inspector-gpu.js + -video-modeline*.js) run under Node on a fake DOM:
## tests/golden/devices_gpu_output.json. Each case is the live device-view / settings capture plus data mutations
## (`ops`), the web page's starting controls, then a list of edits with the requests each fired. The Godot side
## replays the same edits through gpu_output_ui.gd and rebuilds every body from the models. The preview reply is the
## generator's fake (`_fake_preview`), so only the text layout is under test, never the timings.

const GO := preload("res://features/devices/gpu_output_model.gd")
const GM := preload("res://features/devices/gpu_modeline_model.gd")
const GP := preload("res://features/devices/gpu_modeline_preview.gd")
const GU := preload("res://features/devices/gpu_output_ui.gd")
const CHECKS := {"Fullscreen": "fullscreen", "Windowed": "windowed", "Border": "border", "Override": "override"}
const INPUTS := {"customW": "custom_w", "customH": "custom_h", "customFps": "custom_fps", "osW": "os_w", "osH": "os_h",
	"osFps": "os_fps", "edid": "edid", "name": "name", "ar": "ar", "posX": "pos_x", "posY": "pos_y"}
const NUMERIC := ["custom_w", "custom_h", "custom_fps", "os_w", "os_h", "os_fps"]
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_gpu_output.json"))
	return _g


static func _norm(v: Variant) -> Variant:
	if v is int:
		return float(v)
	if v is Dictionary:
		var o := {}
		for k in v:
			o[k] = _norm(v[k])
		return o
	if v is Array:
		return v.map(func(x: Variant) -> Variant: return _norm(x))
	return v


static func _check_field(label: String) -> String:
	if CHECKS.has(label):
		return CHECKS[label]
	for tg in GO.TOGGLES:
		if tg[1] == label:
			return tg[0]
	return ""


## The case's payload / settings / connector after its data mutations (generator applyOps).
func _setup(c: Dictionary) -> Dictionary:
	var fx: Dictionary = _golden().fixtures
	var p: Dictionary = fx.payload.duplicate(true)
	var s: Dictionary = fx.settings.duplicate(true)
	var conn := {}
	for x in p.suggested.connectors:
		if x.id == c.connId:
			conn = x
	if conn.is_empty():
		conn = {"id": c.connId, "kind": "gpu_out", "label": c.connId.to_upper()}
		p.suggested.connectors.append(conn)
	for op in c.ops:
		var o: Variant = p if op[0] == "p" else (s if op[0] == "s" else conn)
		var path: Array = op[1]
		for k in path.slice(0, -1):
			var kk: Variant = int(k) if k is float else k
			if o[kk] == null:
				o[kk] = {}
			o = o[kk]
		var last: Variant = int(path[-1]) if path[-1] is float else path[-1]
		match op[2]:
			"set":
				o[last] = op[3].duplicate(true) if op[3] is Dictionary or op[3] is Array else op[3]
			"delete":
				o.erase(last)
			"push":
				o[last].append(op[3].duplicate(true))
	var cs: Dictionary = s.get("casparServer", {})
	cs["nvidia_sync_to_display_off"] = true  # WO-975: the goldens are the pre-auto web port -> pin the explicit-OFF branch
	var cst := GO.consumer_state(cs, s, conn, p)
	var display := GO.detected_display(conn, p, s)
	var mst := GM.state(conn, p, cs, s, display, cst.screen_n, cst.port_n, GO.physical_mode(conn, p, display))
	return {"p": p, "s": s, "conn": conn, "cs": cs, "cst": cst, "mst": mst, "ui": GU.initial(cst, mst)}


## The generator's fake GET /api/hardware/modeline-preview reply.
static func _fake_preview(dims: Dictionary, type: String) -> Dictionary:
	var w := float(roundi(dims.w))
	var h := float(roundi(dims.h))
	var r: float = float(GM.js_num_str(dims.r))
	return {"ok": true, "kind": type, "modeName": "%dx%d_%.2f" % [w, h, r], "breakdown": {
		"dotClockMhz": roundf(w * h * r * 1.3 / 1e4) / 100.0, "hDisplay": w, "hSyncStart": w + 48, "hSyncEnd": w + 112,
		"hTotal": w + 160, "vDisplay": h, "vSyncStart": h + 3, "vSyncEnd": h + 8, "vTotal": h + 34,
		"flags": "-hsync +vsync" if type == "gtf" else "+hsync -vsync", "activePixels": w * h,
		"framePixels": (w + 160) * (h + 34), "approxHz": r - 0.07}, "bandwidth": {"short": "DL" if w > 3000 else "SL"}}


func _preview(env: Dictionary) -> Dictionary:
	var dims := GP.preview_dims(env.ui, env.mst, env.cs, env.s, env.cst.screen_n)
	return {"query": GP.preview_query(dims, env.ui.timing), "dims": dims}


## The golden's controls (checks / selects / inputs) against the replayed ui dict.
func _same_controls(env: Dictionary, g: Dictionary, what: String) -> void:
	var ui: Dictionary = env.ui
	for label in g.checks:
		var f := _check_field(label)
		var on: Variant = (not ui.windowed) if f == "fullscreen" else ui.get(f)
		t.eq(on, g.checks[label], "%s: check %s" % [what, label])
	for k in g.selects:
		var gv: Variant = g.selects[k]
		t.eq(str(ui[k]), str(gv.value if gv is Dictionary else gv), "%s: select %s" % [what, k])
	for k in g.inputs:
		var f: String = INPUTS[k]
		var want: String = g.inputs[k].value
		if f in NUMERIC:
			t.eq(GM.js_num(ui[f]), GM.js_num(want), "%s: input %s" % [what, k])
		else:
			t.eq(str(ui[f]), want, "%s: input %s" % [what, k])
		if f in ["custom_w", "custom_h", "custom_fps"]:
			t.eq(not GU.custom_shown(ui), g.inputs[k].disabled, "%s: %s disabled" % [what, k])
	t.eq(GU.custom_shown(ui), g.customShown == "flex", what + ": custom row")
	t.eq(GU.os_custom_shown(ui), g.osCustomShown == "flex", what + ": OS custom row")


func _same_preview(env: Dictionary, g: Dictionary, what: String) -> void:
	var pv := _preview(env)
	var out := GP.preview_lines(_fake_preview(pv.dims, env.ui.timing))
	t.eq(out.tier, g.tier, what + ": preview tier")
	t.eq(out.lines, g.lines, what + ": preview lines")


func test_summary_rows() -> void:
	for c in _golden().cases:
		var env := _setup(c)
		var want := []
		for r in c.summary:
			want.append([r.label, r.value, r.get("strong", false)])
		t.eq(GO.summary_rows(env.conn, env.p, env.s), want, c.name + ": summary")


func test_initial_controls() -> void:
	for c in _golden().cases:
		var env := _setup(c)
		var g: Dictionary = c.init
		_same_controls(env, g, c.name + " init")
		t.eq(GO.mode_options(), g.selects.mode.options, c.name + ": mode options")
		t.eq(GM.display_options(env.mst), g.selects.display.options, c.name + ": display options")
		t.eq(GM.TIMING_OPTIONS, g.selects.timing.options, c.name + ": timing options")
		t.eq(GM.BACKEND_OPTIONS, g.selects.backend.options, c.name + ": backend options")
		t.eq(GO.STRETCH_OPTIONS.map(func(o: String) -> Array: return [o, o]), g.selects.stretch.options, c.name + ": stretch")
		t.eq(GO.COLOUR_OPTIONS.map(func(o: String) -> Array: return [o, o]), g.selects.colour.options, c.name + ": colour")
		var mst: Dictionary = env.mst
		var texts: Array = g.texts
		for want in [mst.screen_note, mst.feed_note, mst.edid_headline, mst.modes_label,
				GP.timing_label(GU.os_custom_shown(env.ui))]:
			if want != "":
				t.ok(want in texts, "%s: text %s" % [c.name, want])
		# The fake DOM splits "Physical: <strong>name</strong> · tail" into "Physical:· tail" then "name".
		var i := texts.find(texts.filter(func(x: String) -> bool: return x.begins_with("Physical:"))[0])
		t.eq(GO.physical_line(env.cst, mst.display_name), "Physical: %s %s" % [texts[i + 1], texts[i].trim_prefix("Physical:")], c.name + ": physical")
		# Seed write (only when the port's consumer keys are unset), then the first preview GET.
		var calls := []
		if not env.cst.seed_patch.is_empty():
			calls.append_array([["POST", "/api/settings", env.cst.seed_patch], ["LOAD"]])
		calls.append(["GET", _preview(env).query])
		t.eq(_norm(calls), _norm(g.calls), c.name + ": init calls")
		_same_preview(env, g.preview, c.name + " init")


func test_edits_replay() -> void:
	for c in _golden().cases:
		var env := _setup(c)
		var status := ""
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s / %s" % [c.name, JSON.stringify(st)]
			var effects := []
			var got_calls := []
			if st.has("button"):
				if st.button == "Reset all settings for this screen":
					var rp: Dictionary = GO.reset_patch(env.cst)
					rp.casparServer.erase("nvidia_sync_to_display_off")  # WO-975 key, covered by test_nvidia_sync_auto
					got_calls = [["POST", "/api/settings", rp], ["LOAD"]]
					status = "Settings for GPU port %d cleared" % env.cst.port_n
				else:  # "Show advanced…" only re-runs the preview
					got_calls = [["GET", _preview(env).query]]
				t.eq(_norm(got_calls), _norm(a.calls), what + ": calls")
				t.eq(status, a.status, what + ": status")
				continue
			if st.has("check"):
				effects = GU.apply(env.ui, _check_field(st.check), st.on)
			elif st.has("select"):
				effects = GU.apply(env.ui, st.select, st.value)
			else:
				for k in st.input:
					for e in GU.apply(env.ui, INPUTS[k], st.input[k]):
						if not e in effects:
							effects.append(e)
			# The web posts some saves twice (two listeners); compare each distinct request kind once.
			var want := {}
			for call in a.calls:
				var kind: String = call[0]
				if kind == "POST":
					kind = "caspar" if call[2].has("casparServer") else "os"
				if kind == "DIRTY":
					continue
				if want.has(kind):
					t.eq(_norm(call), _norm(want[kind]), what + ": repeated " + kind)
				want[kind] = call
			var kinds := want.keys().map(func(k: String) -> String: return {"GET": "preview"}.get(k, k))
			kinds.sort()
			var got := effects.duplicate()
			got.sort()
			t.eq(got, kinds, what + ": effects")
			if "caspar" in effects:
				var body: Dictionary = GO.caspar_patch(env.cst, env.ui)
				body.casparServer.erase("nvidia_sync_to_display_off")  # WO-975 key (not in the web goldens); own test below
				t.eq(_norm(body), _norm(want.caspar[2]), what + ": caspar body")
				status = GO.save_status(env.ui, env.cst)
			if "os" in effects:
				t.eq(_norm(GO.os_patch(env.cst, env.mst, env.ui)), _norm(want.os[2]), what + ": OS body")
			if "preview" in effects:
				t.eq(_preview(env).query, want.GET[1], what + ": preview GET")
				_same_preview(env, a.preview, what)
			t.eq(status, a.status, what + ": status")
			t.eq((a.calls.filter(func(x: Array) -> bool: return x[0] == "DIRTY").size() > 0), "caspar" in effects or "os" in effects, what + ": dirty")
			_same_controls(env, a, what)


## WO-975: the tick is tri-state — AUTO (first PGM screen destination's first PGM-cabled GPU port, never the operator
## monitor), explicit ON (any ticked port wins), explicit OFF (`nvidia_sync_to_display_off`).
func test_nvidia_sync_auto() -> void:
	var payload := {"graph": {"connectors": [
		{"id": "dst_in_gui", "kind": "destination_in"}, {"id": "dst_in_dioda", "kind": "destination_in"},
		{"id": "dst_in_proj", "kind": "destination_in"},
		{"id": "gpu_p1", "kind": "gpu_out"}, {"id": "gpu_p2", "kind": "gpu_out"}, {"id": "gpu_p3", "kind": "gpu_out"}],
		"edges": [{"sourceId": "dst_in_gui", "sinkId": "gpu_p3"},
			{"sourceId": "dst_in_proj", "sinkId": "gpu_p2"},
			{"sourceId": "dst_in_dioda", "sinkId": "gpu_p1", "note": "{\"outputLayer\":2}"},
			{"sourceId": "dst_in_dioda", "sinkId": "gpu_p2"}]},
		"screenDestinations": {"destinations": [{"id": "gui", "mode": "operator_gui"}, {"id": "dioda", "mode": "pgm_prv"},
			{"id": "proj", "mode": "pgm_prv"}]}}
	t.eq(GO.auto_sync_port(payload, 4), 3, "PRV-only cable skipped; first screen destination's PGM port (gpu_p2 = port 3)")
	t.eq(GO.nvidia_sync_state({}, payload, 3), {"on": true, "auto": true}, "auto on, flagged auto")
	t.eq(GO.nvidia_sync_state({}, payload, 2).on, false, "other ports not on")
	t.eq(GO.nvidia_sync_state({"screen_4_operator_monitor": true}, payload, 3).on, true, "operator monitor on another port")
	t.eq(GO.nvidia_sync_state({"screen_3_operator_monitor": true}, payload, 3).on, false, "never the operator monitor port")
	t.eq(GO.nvidia_sync_state({"screen_2_nvidia_sync_to_display": true}, payload, 2), {"on": true, "auto": false}, "explicit tick wins")
	t.eq(GO.nvidia_sync_state({"screen_2_nvidia_sync_to_display": true}, payload, 3).on, false, "explicit tick moves it")
	t.eq(GO.nvidia_sync_state({"nvidia_sync_to_display_off": true}, payload, 3).on, false, "explicit off wins over auto")
	t.eq(GO.nvidia_sync_state({"screen_3_nvidia_sync_to_display": false}, payload, 3).on, true, "stored false is NOT an explicit off")
	# save paths: leaving the auto tick alone writes nothing about it; unticking = off; ticking pins + clears off
	var st := {"port_n": 3, "screen_n": 3, "mv": false, "nvidia_sync": true, "nvidia_auto": true}
	var ui := {"windowed": true, "border": true, "mode": "1080p5000", "custom_w": "1920", "custom_h": "1080",
		"custom_fps": "50", "stretch": "none", "key_only": false, "aot": true, "sbs_key": false, "colour": "RGB", "force_linear": true,
		"mipmaps": false, "high_bitdepth": false, "name": "", "ar": "", "pos_x": "0", "pos_y": "0", "operator_monitor": false,
		"interactive": false, "nvidia_sync": true}
	var body: Dictionary = GO.caspar_patch(st, ui).casparServer
	t.eq(body.has("screen_3_nvidia_sync_to_display") or body.has("nvidia_sync_to_display_off"), false, "auto tick left alone on save")
	ui.nvidia_sync = false
	body = GO.caspar_patch(st, ui).casparServer
	t.eq([body.get("screen_3_nvidia_sync_to_display"), body.get("nvidia_sync_to_display_off")], [false, true], "untick auto = explicit off")
	st.nvidia_sync = false
	st.nvidia_auto = false
	ui.nvidia_sync = true
	body = GO.caspar_patch(st, ui).casparServer
	t.eq([body.get("screen_3_nvidia_sync_to_display"), body.get("nvidia_sync_to_display_off")], [true, false], "tick = explicit port, off cleared")
	t.eq(GO.reset_patch(st).casparServer.get("nvidia_sync_to_display_off", "missing"), null, "reset = back to auto")
