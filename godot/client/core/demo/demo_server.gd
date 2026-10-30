extends RefCounted
## WO-815 — the simulated server ("demo mode", owner 29.10: "an option to simulate a server … for show preparing … fake
## the server for the static github page"). With Config.demo on, core/api.gd answers every request from here and
## core/ws.gd opens no socket: it gets the `state` snapshot and the change broadcasts from here. No node, no Caspar, no
## network — it runs the same on Linux, Windows, macOS and in a browser (the Web export).
## The data set is godot/client/demo/*.json (tools/demo/build-demo-data.py, public-safe). Writes change only this
## in-memory copy: a take / PRV push moves `scene.live`, faders and mutes the console mixer, timers run on this
## computer's clock, a pixel-map save replaces the mapping list. Everything else answers 501 "not in demo".
## Phase 2: timelines play on this computer's clock (demo_timeline.gd, tick() once a frame from core/ws.gd), look cards
## and the PGM / PRV previews get generated stills (demo_video.gd, get_bytes()), the Devices tab reads a demo
## device-view (read-only: its writes answer "not in demo").
## Pure: no autoload references (tests/test_demo_server.gd drives it directly). Results have core/api.gd's shape
## { ok, status, data, error, reason } and pass through JSON, so numbers come back as floats exactly like the network.

signal broadcast(type: String, data: Variant)  ## a server → client WebSocket message (core/ws.gd delivers it)
signal notice(text: String)  ## a user action the demo does not simulate (shown in the header notice line)

const NetUtil := preload("res://core/net_util.gd")
const Scene := preload("res://core/demo/demo_scene.gd")
const Extras := preload("res://core/demo/demo_extras.gd")
const Timeline := preload("res://core/demo/demo_timeline.gd")
const Video := preload("res://core/demo/demo_video.gd")
const Bus := preload("res://core/demo/demo_bus.gd")
const Media := preload("res://core/demo/demo_media.gd")
const TimelineLook := preload("res://core/demo/demo_timeline_look.gd")

const DATA_DIR := "res://demo"
const NOT_IN_DEMO := "not in demo"
## Writes the client makes by itself (boot, tab switches), not the operator: answered "not in demo" without a notice.
const QUIET := ["POST /api/audio/cross-screen/plan", "POST /api/client-prefs", "POST /api/multiview/apply"]
const FILES := ["project", "state", "settings", "mixer", "timers", "pixelmap", "pixelmap_pixels", "fixture_types",
	"effect_registry", "layer_options", "device_view"]

static var _shared: RefCounted = null

var project: Dictionary = {}
var state: Dictionary = {}
var settings: Dictionary = {}
var mixer: Dictionary = {}
var timers: Array = []
var pixelmap: Array = []
var files: Dictionary = {}  ## the rest of the data set, by file name (read-only answers)
var scene_live_seq := 0
var tl_list: Array = []  ## the timeline engine's timelines (demo_timeline.gd)
var tl_cells := {}  ## timeline id → playback cell
var tl_air := ""  ## the timeline on air
var tl_sent_at := -INF  ## when the last `timeline.tick` went out
var op_cells: Array = []  ## the operator channel's compose windows (POST /api/operator-gui/layout; demo_video.gd draws them)
var bus_fx := {}  ## channel (string) → how its last look change came {kind, transition, fps} (demo_scene.gd; demo_bus.gd fades by it)
var tl_shown := {}  ## channel → the timeline id its bus shows ("" = the look; demo_timeline_look.gd)
var buses := {}  ## channel → demo_bus.gd model (the display engine's one picture of that bus)
var unsupported: Array[String] = []  ## "METHOD /path" of every request answered with not-in-demo (tests, the WO log)
## "now" in ms since the epoch — this computer's clock (the timers run on it); tests set a fixed clock.
var now_ms: Callable = func() -> float: return Time.get_unix_time_from_system() * 1000.0


## The one simulated server of this client (Api and Ws share it), loaded from res://demo on first use.
static func shared() -> RefCounted:
	if _shared == null:
		_shared = load("res://core/demo/demo_server.gd").new(load_dir(DATA_DIR))
	return _shared


static func load_dir(dir: String) -> Dictionary:
	var out := {}
	for f in FILES:
		var text := FileAccess.get_file_as_string("%s/%s.json" % [dir, f])
		var v: Variant = JSON.parse_string(text) if text != "" else null
		out[f] = v if v != null else {}
	return out


func _init(data: Dictionary) -> void:
	files = data.duplicate(true)
	project = _dict(files.get("project"))
	state = _dict(files.get("state"))
	settings = _dict(files.get("settings"))
	mixer = _dict(files.get("mixer"))
	for k in ["gains", "muted"]:
		if not (mixer.get(k) is Dictionary):
			mixer[k] = {}
	if not (mixer.get("solos") is Array):
		mixer["solos"] = []
	mixer.erase("ok")
	timers = _dict(files.get("timers")).get("timers", [])
	pixelmap = _dict(files.get("pixelmap")).get("mappings", [])
	tl_list = Timeline.seed(project)


## One HTTP request → { ok, status, data, error, reason }.
func handle(method: int, raw_path: String, body: Variant) -> Dictionary:
	var parts := raw_path.split("?", true, 1)
	var path := parts[0].trim_suffix("/")
	var query := parse_query(parts[1] if parts.size() > 1 else "")
	var b: Variant = _wire(body)
	var verb := method_name(method)
	var res: Variant = _core(verb, path, b)
	if res == null and path.begins_with("/api/timelines"):
		res = Timeline.route(self, verb, path, b if b is Dictionary else {})
	if res == null:
		res = Scene.route(self, verb, path, b)
	if res == null:
		res = Extras.route(self, verb, path, query, b)
	if res == null:
		return not_in_demo(verb, path)
	return res


## A binary GET (core/api.gd get_bytes) → { ok, status, bytes, headers, error }: a media thumbnail from the data set's
## stills; anything else (live-input frames, models, bundles) is not in the demo.
func get_bytes(raw_path: String) -> Dictionary:
	var path := raw_path.split("?", true, 1)[0]
	if path.begins_with("/api/thumbnail/") and not path.begins_with("/api/thumbnail/live/"):
		var b := Video.thumb_bytes(path.trim_prefix("/api/thumbnail/").uri_decode())
		if not b.is_empty():
			return {"ok": true, "status": 200, "bytes": b, "headers": PackedStringArray(["Content-Type: image/jpeg"]), "error": ""}
	not_in_demo("GET", path)
	return {"ok": false, "status": 501, "bytes": PackedByteArray(), "headers": PackedStringArray(), "error": NOT_IN_DEMO}


## The display engine's clock, seconds: this computer's (tests move `now_ms`).
func clock() -> float:
	return float(now_ms.call()) / 1000.0


## The model of a channel's bus (the look in `scene.live[ch]`, its layers and fade) brought up to date at `now` seconds.
func bus(ch: int, now: float) -> RefCounted:
	var b: RefCounted = buses.get(ch)
	if b == null:
		b = Bus.new(ch)
		b.media_info = func(id: String) -> Dictionary: return Media.info(state, id)
		buses[ch] = b
	var cm: Variant = state.get("channelMap")
	b.size = Video.still_size(cm, ch)
	var shown: Array = TimelineLook.apply(self, ch, Video.live_entry(self, ch), bus_fx.get(str(ch), {}), now)  # a timeline on air wins
	b.update(shown[0], shown[1], now)
	return b


## Once a frame (core/ws.gd): what runs on the server's clock — the timeline on air.
func tick() -> void:
	Timeline.tick(self)


## A client → server WebSocket message (`scene_deck_sync`, watches, …). → true (the "socket" took it).
func on_ws(msg: Dictionary) -> bool:
	var m: Variant = _wire(msg)
	if m is Dictionary and str(m.get("type", "")) == "scene_deck_sync" and m.get("data") is Dictionary:
		Scene.deck_sync(self, m.data)
	return true


## The WebSocket snapshot every (re)connect gets.
func snapshot() -> Dictionary:
	return _wire(state)


func _core(verb: String, path: String, b: Variant) -> Variant:
	match [verb, path]:
		["GET", "/api/state"]:
			return reply(state)
		["GET", "/api/project"]:
			return reply(project)
		["GET", "/api/settings"]:
			return reply(settings)
		["POST", "/api/settings"]:
			if b is Dictionary:
				NetUtil.deep_merge(settings, b)
			return reply({"ok": true, "sideEffects": [], "warnings": []})
		["GET", "/api/scene/effect-registry"]:
			return reply(files.get("effect_registry", {}))
		["GET", "/api/scene/layer-options"]:
			return reply(files.get("layer_options", {}))
		["GET", "/api/media"]:
			return reply([{"id": "demo", "label": "demo", "isDir": true}] + (state.get("media", []) as Array).map(
				func(m: Dictionary) -> Dictionary: return m.merged({"isDir": false})))
		["GET", "/api/templates"]:
			return reply(state.get("templates", []))
		["GET", "/api/device-view"]:  # the Devices tab, read-only (tools/demo/build-demo-extras.py)
			return reply(files.get("device_view", {}))
		["GET", "/api/video-surfaces"]:
			return reply({"ok": true, "surfaces": []})
		["POST", "/api/media/preview"]:  # the media inspector's Caspar preview player: nothing to play here
			return reply({"ok": true, "demo": true})
		["POST", "/api/video-surfaces/lease"]:
			return reply({"ok": true, "roles": []})
		["GET", "/api/variables"]:
			return reply({})
		["GET", "/api/system/time"]:
			return reply({"ok": true, "now": Time.get_datetime_string_from_system(false, true), "timezone": "local",
				"ntp": false, "synchronized": false, "passwordRequired": false})
		["GET", "/api/project/missing-assets"]:
			return reply({"isClean": true, "missingMedia": [], "missingTemplates": [], "usedMedia": []})
		["GET", "/api/project/hardware-check"]:
			return reply({"severity": "none", "items": [], "sameMachine": true, "prompt": false, "projectName": str(project.get("name", "")),
				"hasHardware": false})
	return null


## 200 + the JSON round trip of `data` (the caller's copy never aliases the demo state).
func reply(data: Variant, status := 200) -> Dictionary:
	return {"ok": status >= 200 and status < 300, "status": status, "data": _wire(data), "error": "", "reason": ""}


func refuse(status: int, error: String, reason := "") -> Dictionary:
	return {"ok": false, "status": status, "data": {"ok": false, "error": error, "reason": reason}, "error": error, "reason": reason}


## The answer for anything the demo does not simulate: 501 "not in demo: POST /api/…"; a write also says so in the
## header notice line (GET polls stay quiet — the tabs read many things the demo has no data for).
func not_in_demo(verb: String, path: String) -> Dictionary:
	var what := "%s %s" % [verb, path]
	if not unsupported.has(what):
		unsupported.append(what)
		print("[demo] %s: %s" % [NOT_IN_DEMO, what])
	if verb != "GET" and not QUIET.has(what):
		notice.emit("Demo — no server: %s is not simulated" % path)
	return refuse(501, "%s: %s" % [NOT_IN_DEMO, what], "not_in_demo")


## Emit a server broadcast (JSON round trip, like the wire).
func send(type: String, data: Variant) -> void:
	broadcast.emit(type, _wire(data))


## `change {path, value}` + the Store-side state kept in step (a later GET /api/state sees it).
func change(path: String, value: Variant) -> void:
	write_path(state, path, value)
	var msg := {"path": path, "value": value}
	if path == "scene.live":
		scene_live_seq += 1
		msg["seq"] = scene_live_seq
	send("change", msg)


static func write_path(root: Dictionary, path: String, value: Variant) -> void:
	var keys := path.split(".")
	var cur: Dictionary = root
	for i in keys.size() - 1:
		if not (cur.get(keys[i]) is Dictionary):
			cur[keys[i]] = {}
		cur = cur[keys[i]]
	cur[keys[keys.size() - 1]] = value


static func parse_query(q: String) -> Dictionary:
	var out := {}
	for kv in q.split("&", false):
		var p := kv.split("=", true, 1)
		out[p[0].uri_decode()] = p[1].uri_decode() if p.size() > 1 else ""
	return out


static func method_name(method: int) -> String:
	match method:
		HTTPClient.METHOD_POST:
			return "POST"
		HTTPClient.METHOD_PUT:
			return "PUT"
		HTTPClient.METHOD_DELETE:
			return "DELETE"
	return "GET"


static func _wire(v: Variant) -> Variant:
	return null if v == null else JSON.parse_string(NetUtil.to_json(v))


static func _dict(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}
