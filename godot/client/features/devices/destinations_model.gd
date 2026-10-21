extends RefCounted
## WO-605 slice 3 — the pure half of adding and editing a screen destination: the "+" type list and request
## (device-view-events.js destAdd, screen-destination-index.js), and what the destination inspector shows and
## sends (device-view-destinations-inspector-form.js, -operator-gui-fields.js, STANDARD_VIDEO_MODES,
## PROGRAM_LAYOUT_OPTIONS). Every patch is the body of POST /api/device-view {updateDestination: {id, …patch}}.

const R := preload("res://features/devices/cable_rules.gd")
const S := preload("res://features/devices/cable_seed.gd")
const H := preload("res://features/devices/host_channels.gd")
const TYPE_OPTIONS := [["pgm_prv", "PGM/PRV"], ["pgm_only", "PGM only"], ["multiview", "Multiview"],
	["pixelmap", "Pixel Map"], ["operator_gui", "Operator GUI"]]
const MODE_OPTIONS := [["pgm_prv", "PGM/PRV"], ["pgm_only", "PGM only"], ["multiview", "Multiview"],
	["pixelmap", "Pixel Map (native Art-Net)"], ["operator_gui", "Operator GUI (Firefox + shaped overlay)"]]
const LAYOUT_OPTIONS := [["stereo", "2 channels"], ["4ch", "4 channels"], ["8ch", "8 channels"], ["16ch", "16 channels"]]
const STANDARD_VIDEO_MODES := ["PAL", "NTSC", "576p2500", "720p2398", "720p2400", "720p2500", "720p2997", "720p3000",
	"720p5000", "720p5994", "720p6000", "1080i5000", "1080i5994", "1080i6000", "1080p2398", "1080p2400", "1080p2500",
	"1080p2997", "1080p3000", "1080p5000", "1080p5994", "1080p6000", "1556p2398", "1556p2400", "1556p2500",
	"2160p2398", "2160p2400", "2160p2500", "2160p2997", "2160p3000", "2160p5000", "2160p5994", "2160p6000",
	"dci1080p2398", "dci1080p2400", "dci1080p2500", "dci2160p2398", "dci2160p2400", "dci2160p2500"]
const EMPTY_NOTE := "No destinations yet. Use + to add PGM/PRV, PGM only, Multiview, or a host channel (DeckLink, USB, NDI…)."
const PIXELMAP_NOTE := "This channel samples its own full raster into one native <artnet> fixture group (whole-frame area averaging). Universes beyond the first auto-spill per the deployed consumer’s addressing rule. Regenerate + restart Caspar to apply."
const OPG_NOTE := "Route layers (10-49) mirror the compose windows of the Live preview. Regenerate + restart Caspar to apply the channel."


static func is_main_bus(mode: Variant) -> bool:
	var m := R.s(mode) if H.truthy(mode) else "pgm_prv"
	return m != "multiview" and m != "stream" and m != "operator_gui"


## nextMainScreenIndex: utility channels sit at 0; otherwise one past the highest MAIN-bus index.
static func next_main_index(destinations: Array, type: String) -> int:
	if type == "multiview" or type == "operator_gui":
		return 0
	var highest := -1
	for d in destinations:
		if d is Dictionary and is_main_bus(d.get("mode")):
			var n: Variant = H.js_int(H.coalesce([d.get("mainScreenIndex"), 0]))
			highest = maxi(highest, maxi(0, n if n != null else 0))
	return highest + 1


## The "+" button: {body: addDestination, screen: N for the screen-consumer seeding (0 = none)}. The web handler
## also computes a videoMode, but Actions.addDestination never forwards it — the server picks the mode — so the
## body is {type, mainScreenIndex} only, exactly what the web sends.
static func add_request(destinations: Array, type: String) -> Dictionary:
	var idx := next_main_index(destinations, type)
	var body := {"type": type, "mainScreenIndex": idx}
	var n := 0 if type == "multiview" or type == "operator_gui" else idx + 1
	return {"body": body, "screen": n if n >= 1 and type != "pixelmap" else 0}


## The settings POST that follows a new screen N, {} when nothing needs seeding (shouldSeedScreenConsumerDefaults).
static func seed_patch(screen: int, settings: Variant) -> Dictionary:
	if screen < 1 or not settings is Dictionary:
		return {}
	var cs := R.d(settings.get("casparServer"))
	if S.screen_seed_caspar_patch(cs, screen).is_empty():
		return {}
	return S.screen_seed_patch(cs, screen, settings)


static func width(d: Dictionary) -> int:
	return _clamp_int(d.get("width"), 1920, 64)


static func height(d: Dictionary) -> int:
	return _clamp_int(d.get("height"), 1080, 64)


static func fps(d: Dictionary) -> float:
	return _clamp_float(d.get("fps"), 50.0, 1.0)


## Math.max(lo, parseInt(String(v ?? def), 10) || def)
static func _clamp_int(v: Variant, def: int, lo: int) -> int:
	var n: Variant = H.js_int(H.coalesce([v, def]))
	return maxi(lo, n if n != null and n != 0 else def)


## Math.max(lo, parseFloat(String(v ?? def)) || def)
static func _clamp_float(v: Variant, def: float, lo: float) -> float:
	var x: Variant = H.coalesce([v, def])
	var f: float = float(x) if x is int or x is float else js_float(R.s(x))
	return maxf(lo, f if f != 0.0 else def)


## JS parseFloat: the longest numeric prefix, 0 for NaN (every caller treats NaN like 0 via `|| def`).
static func js_float(text: String) -> float:
	var m := RegEx.create_from_string("^\\s*[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?").search(text)
	return m.get_string(0).strip_edges().to_float() if m else 0.0


static func num(v: float) -> String:
	return str(int(v)) if is_equal_approx(v, roundf(v)) else str(v)


static func mode_label(mode: String) -> String:
	for o in MODE_OPTIONS:
		if o[0] == mode:
			return o[1]
	return "PGM/PRV"


static func layout_label(layout: Variant) -> String:
	var key := R.s(layout) if H.truthy(layout) else "stereo"
	for o in LAYOUT_OPTIONS:
		if o[0] == key:
			return o[1]
	return key


static func shows_audio(mode: String) -> bool:
	return mode != "multiview" and mode != "stream" and mode != "operator_gui"


static func shows_prv(mode: String) -> bool:
	return not mode in ["pgm_only", "multiview", "pixelmap", "operator_gui"]


## The summary table, [[label, value]…] in the web's order.
static func summary_rows(d: Dictionary, intent: Variant) -> Array:
	var mode := R.s(d.get("mode")) if H.truthy(d.get("mode")) else "pgm_prv"
	var it := R.d(intent)
	var rows := [["Label", R.s(d.label) if H.truthy(d.get("label")) else (R.s(d.id) if H.truthy(d.get("id")) else "Destination")],
		["Mode", mode_label(mode)], ["Main index", R.s(H.coalesce([d.get("mainScreenIndex"), 0]))]]
	if shows_audio(mode):
		rows.append(["Audio outputs", layout_label(d.get("audioLayout"))])
	rows.append(["Video mode", R.s(d.videoMode) if H.truthy(d.get("videoMode")) else "1080p5000"])
	rows.append(["Resolution", "%dx%d" % [width(d), height(d)]])
	rows.append(["FPS", num(fps(d))])
	rows.append(["PGM channel", R.s(it.pgmChannel) if it.get("pgmChannel") != null else "-"])
	if shows_prv(mode):
		rows.append(["PRV channel", "-" if intent == null else R.s(H.coalesce([it.get("previewChannelIntended"), it.get("previewChannelGenerated"), "-"]))])
	return rows


## The video-mode select's value: a standard id, else "custom" (inheriting destinations start at the project mode).
static func video_mode_choice(d: Dictionary, settings: Variant) -> String:
	var current := R.s(d.videoMode) if H.truthy(d.get("videoMode")) else \
		(S.default_video_mode(settings) if d.get("inheritsProjectFps") != false else "1080p5000")
	return current if current in STANDARD_VIDEO_MODES else "custom"


## Select change → {patch, width, height, fps} (the fields the form then shows).
static func video_mode_patch(choice: String, d: Dictionary) -> Dictionary:
	if choice == "custom":
		var w := width(d)
		var h := height(d)
		var f := fps(d)
		return {"patch": {"videoMode": "custom", "width": w, "height": h, "fps": f, "inheritsProjectFps": false},
			"width": w, "height": h, "fps": f}
	var spec := S.mode_spec(choice)
	if spec.is_empty():
		return {}
	return {"patch": {"videoMode": choice, "width": spec.width, "height": spec.height, "fps": spec.fps,
		"inheritsProjectFps": false}, "width": spec.width, "height": spec.height, "fps": spec.fps}


## A typed width / height / fps → the patch (width + height together, fps alone — exactly what the web sends).
static func size_patch(field: String, w_text: String, h_text: String, f_text: String, d: Dictionary) -> Dictionary:
	if field == "fps":
		return {"videoMode": "custom", "fps": _clamp_float(f_text if f_text != "" else 50, 50.0, 1.0)}
	var w := _clamp_int(w_text if w_text != "" else (H.coalesce([d.get("width"), 1920]) if field == "height" else 1920), 1920, 64)
	var h := _clamp_int(h_text if h_text != "" else (H.coalesce([d.get("height"), 1080]) if field == "width" else 1080), 1080, 64)
	return {"videoMode": "custom", "width": w, "height": h}


## The name field: blank falls back to the current label / id.
static func label_patch(text: String, d: Dictionary) -> Dictionary:
	var t := text.strip_edges()
	if t == "":
		t = R.s(d.label) if H.truthy(d.get("label")) else (R.s(d.id) if H.truthy(d.get("id")) else "Destination")
	return {"label": t}


static func main_index_patch(text: String) -> Dictionary:
	var n: Variant = H.js_int(text if text != "" else 0)
	return {"mainScreenIndex": maxi(0, n if n != null else 0)}


## Pixel-map Art-Net fields, initial value from d.artnet and the clamped patch for a typed value.
const ARTNET := {"cols": [1, 1, 0], "rows": [1, 1, 0], "startUniverse": [0, 0, 32767], "startAddress": [1, 1, 512],
	"refreshRateHz": [10, 1, 0]}


static func artnet_value(d: Dictionary, key: String) -> Variant:
	var art := R.d(d.get("artnet"))
	if key == "ip":
		return R.s(art.get("ip"))
	if key == "colorOrder":
		return "RGBW" if R.s(art.get("colorOrder") if H.truthy(art.get("colorOrder")) else "RGB").to_upper() == "RGBW" else "RGB"
	return _artnet_int(H.coalesce([art.get(key), ARTNET[key][0]]), key)


static func _artnet_int(v: Variant, key: String) -> int:
	var spec: Array = ARTNET[key]
	var n: Variant = H.js_int(v)
	var x: int = n if n != null and n != 0 else spec[0]
	x = maxi(spec[1], x)
	return mini(spec[2], x) if spec[2] > 0 else x


static func artnet_patch(key: String, text: String) -> Dictionary:
	if key == "ip":
		return {"artnet": {"ip": text.strip_edges()}}
	if key == "colorOrder":
		return {"artnet": {"colorOrder": text}}
	return {"artnet": {key: _artnet_int(text if text != "" else ARTNET[key][0], key)}}


## Operator GUI physical port: "" (Auto) → null, else 1..4.
static func physical_port_patch(raw: String) -> Dictionary:
	var n: Variant = H.js_int(raw.strip_edges())
	return {"physicalPort": null if raw.strip_edges() == "" or n == null else clampi(n, 1, 4)}


const HOST_NOTES := {
	"webpage_host": "Persistent webpage host — Caspar plays HTML with LOOP on this channel. Drag route:// onto PGM or multiview for on-air; clearing the route does not destroy page state. Cable to Record or Stream to capture this bus.",
	"browser_display": "Browser source — real Firefox window running off-screen, captured via x11grab and relayed as MPEG-TS. Use the Inspector to edit URL/dimensions and toggle between background and operator monitor. Drag route:// onto PGM or multiview for on-air.",
	"ndi_host": "", "decklink_input": "",
	"live_audio_input": "Dedicated live-audio input host channel. Cable to Record or Stream to capture that ALSA/USB input bus.",
	"v4l2_input": "Dedicated USB / V4L2 video host channel. FFmpeg bridge feeds MPEG-TS into Caspar; cable to Record or Stream to capture that input directly.",
	"inputs_host": "Dedicated inputs host bus — Caspar plays DeckLink / live audio here so layers can route:// it everywhere. Cable this to Record or Stream on the rear panel to capture that bus directly.",
	"streaming_channel": "Encode / streaming bus — RTMP and file record consumers attach here. Cable another destination (e.g. PGM) into Stream on the rear panel, or cable this host channel to Record to file from the encode bus.",
}
const HOST_NOTE_OTHER := "Auxiliary Caspar channel. Cable to Record or Stream outputs on the rear panel."


static func host_role(d: Dictionary, intent: Variant) -> String:
	return R.s(d.hostRole) if H.truthy(d.get("hostRole")) else R.s(R.d(intent).get("hostRole"))


static func host_note(role: String) -> String:
	return HOST_NOTES.get(role, HOST_NOTE_OTHER)


## The live channelMap inputChannels row on host channel `ch` for `role` ({} when none).
static func host_entry(payload: Dictionary, role: String, ch: Variant) -> Dictionary:
	var cm := R.d(R.d(R.d(payload.get("live")).get("caspar")).get("channelMap"))
	for e in R.a(cm.get("inputChannels")):
		if e is Dictionary and H._num_eq(e.get("channel"), ch) and (e.get("kind") == role or role == ""):
			return e
	return {}


## Host-channel summary (renderHostChannelDestinationInspector): Label, Type, Caspar channel, then Host layer / Route
## from the snapshot's channelMap entry on that channel, then Source ID when the live source (`src`) has one.
static func host_rows(d: Dictionary, intent: Variant, payload: Dictionary, src: Dictionary = {}) -> Array:
	var role := host_role(d, intent)
	var ch: Variant = H.coalesce([d.get("casparChannel"), R.d(intent).get("pgmChannel")])
	var rows := [["Label", R.s(d.label) if H.truthy(d.get("label")) else (R.s(d.id) if H.truthy(d.get("id")) else "Host channel")],
		["Type", H.role_label(role)], ["Caspar channel", R.s(ch) if ch != null else "-"]]
	var e := host_entry(payload, role, ch)
	if e.get("layer") != null:
		rows.append(["Host layer", R.s(e.layer)])
	if H.truthy(e.get("route")):
		rows.append(["Route", R.s(e.route)])
	if H.truthy(src.get("sourceId")):
		rows.append(["Source ID", R.s(src.sourceId)])
	return rows
