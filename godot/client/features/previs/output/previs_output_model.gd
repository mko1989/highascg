extends RefCounted
## WO-1108 (owner 17.11: "use the previs view as a source so it can be recorded or streamed") — the Previs output, pure.
## `project.previs.output = {enabled, size: [w, h], camera: "view" | <camera slider move id>}`: while enabled, the
## previs stage is rendered by its own camera into a fixed-size viewport and published as shm ring `previs`
## (viewport_publisher.gd, WO-743), which the server lists as a Live source (GET /api/shm/sources, WO-744) — a look
## layer plays `shm://previs`. The ring runs at the program channel's rate (channelMap.programResolutions[0].fps).

const RING := "previs"
const LABEL := "Previs"  ## Sources ▸ Live row label (features/live/shm_sources_model.gd LABELS)
const SIZES := [[1280, 720], [1920, 1080], [3840, 2160]]
const DEFAULT_SIZE := [1920, 1080]
const NAME_RE := "^[A-Za-z0-9_-]+$"  # the ring-name rule of HshmSink and Caspar's shm producer


## Cleaned slice: enabled a bool, size one of SIZES (else 1920×1080), camera "view" or a move id. Unknown keys stay.
static func normalize(raw: Variant) -> Dictionary:
	var out: Dictionary = (raw as Dictionary).duplicate(true) if raw is Dictionary else {}
	out.enabled = out.get("enabled") is bool and out.get("enabled")
	var s: Variant = out.get("size")
	var size: Array = DEFAULT_SIZE.duplicate()
	if s is Array and (s as Array).size() == 2:
		for c in SIZES:
			if (s[0] is int or s[0] is float) and (s[1] is int or s[1] is float) and int(s[0]) == c[0] and int(s[1]) == c[1]:
				size = (c as Array).duplicate()
	out.size = size
	var cam := str(out.get("camera", "view")).strip_edges() if out.get("camera") is String else "view"
	out.camera = cam if cam != "" else "view"
	return out


static func of_project(project: Variant) -> Dictionary:
	var pv: Variant = (project as Dictionary).get("previs") if project is Dictionary else null
	return normalize((pv as Dictionary).get("output") if pv is Dictionary else null)


## The program channel's rate (the first screen of programResolutions), 50 without one.
static func fps_of(cm: Variant) -> int:
	var res: Variant = (cm as Dictionary).get("programResolutions") if cm is Dictionary else null
	if res is Array and not (res as Array).is_empty() and res[0] is Dictionary:
		var f: Variant = res[0].get("fps")
		if (f is int or f is float) and float(f) >= 1.0:
			return clampi(int(f), 1, 240)
	return 50


## WO-1116 (owner 17.11): the output runs at half the program rate — 25 for 50p, 30 for 60p (59.94 → 30); a 25 / 30 fps
## show keeps its rate. Enough for a stream or a recording, and the client is not driven to twice the full rate.
static func out_fps(cm: Variant) -> int:
	var f := fps_of(cm)
	return (f + 1) / 2 if f >= 48 else f


## The ring this client writes: `--previs-ring=<name>`, else `previs` — and `previs-probe` for the output probe, so a
## probe client never writes the operator's ring by accident. A name the ring rule refuses falls back the same way.
static func ring_name(args: Dictionary) -> String:
	var dflt := RING + "-probe" if args.has("probe-previs-output") else RING
	var n := str(args.get("previs-ring", dflt))
	return n if RegEx.create_from_string(NAME_RE).search(n) != null else dflt


## A client started for a check or a probe of something else never starts the operator's ring from the project.
static func may_autostart(args: Dictionary) -> bool:
	if args.has("previs-ring"):
		return true
	return not args.keys().any(func(k: Variant) -> bool: return str(k).begins_with("probe") or str(k) == "check")


## The Camera picker: "My view" and every camera slider move ([text, value]).
static func camera_items(moves: Array) -> Array:
	var out := [["My view", "view"]]
	for m in moves:
		if m is Dictionary:
			out.append([str(m.get("name", m.get("id", ""))), str(m.get("id", ""))])
	return out


## The move the output plays ({} = it follows the operator's view, or the move is gone).
static func camera_move(out: Dictionary, moves: Array) -> Dictionary:
	if str(out.get("camera", "view")) == "view":
		return {}
	for m in moves:
		if m is Dictionary and str(m.get("id", "")) == str(out.camera):
			return m
	return {}


static func camera_missing(out: Dictionary, moves: Array) -> bool:
	return str(out.get("camera", "view")) != "view" and camera_move(out, moves).is_empty()


## The one status line: `why` is "" or why the ring cannot run (can_publish / the sink's error).
static func status(out: Dictionary, why: String, ring: String, running: bool, fps: int, missing: bool) -> String:
	if not out.get("enabled", false):
		return why
	if why != "":
		return why
	if not running:
		return "Starting…"
	var s: Array = out.get("size", DEFAULT_SIZE)
	var text := "On: shm://%s, %d×%d at %d fps. It is in Sources ▸ Live as \"%s\"." % [ring, s[0], s[1], fps, LABEL]
	if missing:
		text += " Its camera move is gone: it follows your view."
	return text
