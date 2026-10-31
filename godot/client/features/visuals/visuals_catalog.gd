extends RefCounted
## WO-885 — the Sources ▸ Visuals list's pure half: every visual the canvas can run (the built-in scenes, the box's shader library,
## the operator's ROMs) as rows in folders, the drag payload a row carries onto the Visuals canvas, and what a drop does to the
## `project.visuals` slice (WO-890: a layer added on top, or one layer's picture replaced). The library has no categories of its own (GET /api/shaders rows are {id, name, audio, alpha,
## updatedAt}), so shaders are filed by audio (Audio-reactive / Backgrounds) and then by a theme read off their id and name.

const M := preload("res://features/visuals/visuals_model.gd")
const Layers := preload("res://features/visuals/visuals_layers.gd")
const SCENES := [["rings", "Rings"], ["particles", "Particles"], ["starfield", "Starfield"], ["tunnel", "Tunnel"],
	["spectrum", "Spectrum"]]  # visuals_model.gd SCENES without the two hosts (shader, game): their rows are the shaders / ROMs
## [folder, keywords] — a keyword matches the start of a word of the id or name; first match wins, so the narrow themes come
## before the catch-all Spectrum.
const THEMES := [
	["Tunnels & flight", ["tunnel", "flight", "speed", "hyper", "dive", "travel", "zoomer", "fly"]],
	["Space", ["galax", "cosmic", "star", "slowstar", "univers", "planet", "moon", "pulsar", "space", "globe", "sky", "glxy"]],
	["Fractals & patterns", ["fractal", "mandel", "kifs", "julia", "sdf", "truchet", "kaleido", "domain", "noise", "worley",
		"fbm", "simplex", "perlin"]],
	["Retro & neon", ["synthwave", "chillwave", "retro", "atari", "vt220", "neon", "matrix", "mario", "nixie", "console",
		"tycho", "balatro", "jj2"]],
	["Nature", ["cloud", "water", "aurora", "fire", "flame", "smoke", "snow", "mist", "forest", "sunset", "sunlight", "rose",
		"flower", "blossom", "archipelago", "heart"]],
	["Light & glow", ["glow", "light", "thunder", "rainbow", "color", "colour", "strobe", "laser"]],
	["Shapes", ["ring", "circle", "hexagon", "bubble", "bubles", "blob", "ball", "squere", "triangle", "lines", "dot",
		"tree", "octagon", "flake", "bear", "fox", "cat", "wavy", "solines"]],
	["Spectrum", ["visuali", "equaliz", "bars", "spectrum", "frequency", "oscilloscope", "waveform", "fft", "meter",
		"speaker", "gauge", "vinyl", "radar", "eq"]],
]
const OTHER := "Abstract"
const SYSTEMS := {"nes": "NES", "fds": "NES", "unf": "NES", "sfc": "SNES", "smc": "SNES", "gb": "Game Boy", "gbc": "Game Boy",
	"gba": "Game Boy Advance", "md": "Mega Drive", "gen": "Mega Drive", "smd": "Mega Drive", "sms": "Master System",
	"gg": "Game Gear"}
## Top folders in list order; the themes follow THEMES, then OTHER.
const TOP := ["Scenes", "Audio-reactive", "Backgrounds", "Games"]


## The theme folder a library shader goes in.
static func theme(id: String, name: String) -> String:
	var re := RegEx.create_from_string("[a-z0-9]+")
	var words := re.search_all((id.trim_prefix("sh-") + " " + name).to_lower()).map(func(m: RegExMatch) -> String: return m.get_string())
	for t in THEMES:
		for k in t[1]:
			if words.any(func(w: String) -> bool: return w.begins_with(k)):
				return t[0]
	return OTHER


## Rows, sorted by folder (TOP, then theme order) and name: {name, folder: "Top[/Sub]", payload, thumb (cache key; "" = icon),
## tip}. `filter` matches the name, id or folder (case-insensitive). Duplicate library ids keep the first row.
static func rows(shaders: Array, games: Array, filter := "") -> Array:
	var out := []
	for s in SCENES:
		out.append(_row(s[1], "Scenes", {"scene": s[0]}, "scene-" + s[0], "Built-in scene — %s" % s[1]))
	var seen := {}
	for r in shaders:
		if not r is Dictionary or not r.get("id") is String or seen.has(r.id):
			continue
		seen[r.id] = true
		var nm := str(r.get("name", r.id)).strip_edges()
		var audio: bool = r.get("audio") == true
		var folder := ("Audio-reactive/" if audio else "Backgrounds/") + theme(r.id, nm)
		out.append(_row(nm if nm != "" else r.id, folder, {"scene": "shader", "shader": r.id},
			"%s-%s" % [r.id, str(r.get("updatedAt", "")).md5_text().left(8)],
			"%s\n%s · %s" % [nm, r.id, "reacts to the audio" if audio else "no audio"]))
	for g in games:
		if g is Dictionary and g.get("path") is String:
			var sys: String = SYSTEMS.get(str(g.path).get_extension().to_lower(), "Other")
			out.append(_row(str(g.get("name", g.path.get_file())), "Games/" + sys, {"scene": "game", "game": g.path}, "",
				"%s\n%s" % [g.get("name", ""), g.path]))
	var f := filter.strip_edges().to_lower()
	if f != "":
		out = out.filter(func(r: Dictionary) -> bool:
			return (r.name + " " + r.folder + " " + str(r.payload.get("shader", ""))).to_lower().contains(f))
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ka := folder_rank(a.folder)
		var kb := folder_rank(b.folder)
		if ka != kb:
			return ka < kb
		if a.folder != b.folder:
			return a.folder.naturalnocasecmp_to(b.folder) < 0
		return a.name.naturalnocasecmp_to(b.name) < 0)
	return out


## Sort rank of a folder path: the top folder's place, then the theme's (Scenes and Games keep their own order).
static func folder_rank(folder: String) -> int:
	var parts := folder.split("/")
	var top := TOP.find(parts[0])
	var sub := 0
	if parts.size() > 1 and parts[0] != "Games":
		var names := THEMES.map(func(t: Array) -> String: return t[0])
		sub = names.find(parts[1]) if names.has(parts[1]) else names.size()
	return (top if top >= 0 else TOP.size()) * 100 + sub


static func _row(name: String, folder: String, payload: Dictionary, thumb: String, tip: String) -> Dictionary:
	var p := {"type": "visual", "label": name}
	p.merge(payload)
	return {"name": name, "folder": folder, "payload": p, "thumb": thumb, "tip": tip}


## A drag payload this canvas takes, or null.
static func parse(data: Variant) -> Variant:
	if data is Dictionary and data.get("type") == "visual" and data.get("scene") is String and data.scene != "":
		return data
	return null


## WO-890: the slice after `payload` lands — `target` -1 = a new layer on top, else layer `target`'s picture replaced
## (visuals_layers.gd drop()). Returns {slice, index, note}; the slice passed in is not changed.
static func apply_drop(slice: Dictionary, payload: Dictionary, target: int) -> Dictionary:
	var r := Layers.drop(slice.get("layers", []), payload, target)
	return {"slice": M.with_layers(slice.duplicate(true), r.layers), "index": r.index, "note": r.note}
