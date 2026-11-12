extends RefCounted
## WO-890 — the Visuals' layer stack, pure half (owner 31.10: "dynamically add visual layers and have an opacity fader for each
## layer added. similar to looks editor"). `project.visuals.layers` is an ordered list, bottom → top, of at most MAX layers:
##   {scene, shader (scene "shader": the library id), game (scene "game": the ROM path), label (the Sources row's name),
##    opacity 0..1, visible, blend ("normal" = drawn over the layers below, "add" = added onto them)}
## Each layer renders alone in its own world and the deck (visuals_deck.gd) stacks them with their opacity and blend.
## Before WO-890 the slice had a fixed pair — `scene` (main) + `overlay` (layer 2) + one `shader` + one `game`; migrate()
## turns that into layers on read (old projects, saved looks), and compat() derives those fields back from the layers so an
## older client sharing the project still shows the bottom two.
## One game at a time: the game is one window publishing one ring (game_launcher.gd), so a second game layer would only show
## the same picture — a game dropped while a game layer exists changes that layer's ROM.

const MAX := 8  # each layer is a full render at the canvas size, and the GPU is Caspar's too on air
const BLENDS := ["normal", "add"]
## The scene ids a layer can run: visuals_model.gd SCENES (kept here as a list so this file has no preload cycle).
const SCENE_IDS := ["rings", "particles", "starfield", "tunnel", "shader", "spectrum", "game"]
const LABELS := {"rings": "Rings", "particles": "Particles", "starfield": "Starfield", "tunnel": "Tunnel", "shader": "Shader",
	"spectrum": "Spectrum", "game": "Game"}


## One stored layer made safe, or null (no known scene).
static func layer_of(v: Variant) -> Variant:
	if not v is Dictionary or not str(v.get("scene", "")) in SCENE_IDS:
		return null
	var id := str(v.scene)
	var l := {"scene": id, "opacity": clampf(_num(v.get("opacity", 1.0)), 0.0, 1.0), "visible": v.get("visible", true) != false,
		"blend": str(v.get("blend", "normal")) if str(v.get("blend", "")) in BLENDS else "normal"}
	if id == "shader":
		l.shader = str(v.get("shader", "")) if v.get("shader") is String else ""
	if id == "game":
		l.game = str(v.get("game", "")) if v.get("game") is String else ""
	if v.get("label") is String and str(v.label).strip_edges() != "":
		l.label = str(v.label).strip_edges().left(60)
	return l


## A stored list made safe: known scenes only, at most MAX, one game layer (the first).
static func normalize(v: Variant) -> Array:
	var out := []
	var game := false
	for raw in (v if v is Array else []):
		var l: Variant = layer_of(raw)
		if l == null or out.size() >= MAX or (l.scene == "game" and game):
			continue
		game = game or l.scene == "game"
		out.append(l)
	return out


## A pre-WO-890 slice (`scene`, `overlay`, `shader`, `game`) → layers. An unknown main → rings (the old rule); a layer 2 equal
## to the main → none. A shader on layer 2 was drawn additively over the main (WO-874), so it migrates with blend "add".
static func migrate(d: Dictionary) -> Array:
	var main := str(d.get("scene", "")) if str(d.get("scene", "")) in SCENE_IDS else "rings"
	var over := str(d.get("overlay", "")) if str(d.get("overlay", "")) in SCENE_IDS and str(d.get("overlay", "")) != main else ""
	var out := []
	for id in ([main, over] if over != "" else [main]):
		var l := {"scene": id, "opacity": 1.0, "visible": true, "blend": "add" if id == "shader" and out.size() > 0 else "normal"}
		if id == "shader":
			l.shader = str(d.get("shader", "")) if d.get("shader") is String else ""
		if id == "game":
			l.game = str(d.get("game", "")) if d.get("game") is String else ""
		out.append(l)
	return out


## The pre-WO-890 fields, derived from the layers (written next to `layers` for an older client): the bottom two scenes,
## the first shader layer's id, the game layer's ROM.
static func compat(layers: Array) -> Dictionary:
	var c := {"scene": layers[0].scene if layers.size() > 0 else "rings", "overlay": "", "shader": "", "game": ""}
	if layers.size() > 1 and layers[1].scene != c.scene:
		c.overlay = layers[1].scene
	for l in layers:
		if l.scene == "shader" and c.shader == "":
			c.shader = str(l.get("shader", ""))
		if l.scene == "game" and c.game == "":
			c.game = str(l.get("game", ""))
	return c


## What a layer shows — layers with the same key are the same running picture (the deck keeps it running across edits).
static func key(l: Dictionary) -> String:
	return "%s|%s|%s" % [l.get("scene", ""), l.get("shader", ""), l.get("game", "")]


## A Sources ▸ Visuals payload ({type: "visual", label, scene, shader?, game?}) as a layer; `keep` = the layer it replaces
## (its opacity, visible and blend stay).
static func from_payload(payload: Dictionary, keep := {}) -> Dictionary:
	var l := {"scene": str(payload.get("scene", "")), "label": payload.get("label", ""), "shader": payload.get("shader", ""),
		"game": payload.get("game", ""), "opacity": keep.get("opacity", 1.0), "visible": keep.get("visible", true),
		"blend": keep.get("blend", "normal")}
	var n: Variant = layer_of(l)
	return n if n != null else {}


## `layers` after a drop: `target` -1 = a new layer on top, else that layer's picture replaced (its fader, mute and blend
## kept). A game while another layer runs the game changes that layer's ROM instead. Returns {layers, index (the layer
## the drop landed on, -1 = refused), note ("" or why not)}. `layers` itself is not changed.
static func drop(layers: Array, payload: Dictionary, target: int) -> Dictionary:
	var out := layers.duplicate(true)
	var l := from_payload(payload)
	if l.is_empty():
		return {"layers": out, "index": -1, "note": "Not a visual"}
	var g := out.find_custom(func(x: Dictionary) -> bool: return x.scene == "game")
	if l.scene == "game" and g >= 0 and g != target:
		if target >= 0 and target < out.size():  # dropped on another row: the game moves there
			out[target] = from_payload(payload, out[target])
			out.remove_at(g)
			return {"layers": out, "index": target if target < g else target - 1, "note": ""}
		out[g] = from_payload(payload, out[g])
		return {"layers": out, "index": g, "note": "One game at a time — the game layer plays this ROM now"}
	if target >= 0 and target < out.size():
		out[target] = from_payload(payload, out[target])
		return {"layers": out, "index": target, "note": ""}
	if out.size() >= MAX:
		return {"layers": out, "index": -1, "note": "%d layers is the limit — drop onto a layer to replace it" % MAX}
	out.append(l)
	return {"layers": out, "index": out.size() - 1, "note": ""}


## Layer `i` moved to `to` (clamped); the list itself is not changed.
static func moved(layers: Array, i: int, to: int) -> Array:
	var out := layers.duplicate(true)
	if i < 0 or i >= out.size():
		return out
	var l: Dictionary = out[i]
	out.remove_at(i)
	out.insert(clampi(to, 0, out.size()), l)
	return out


## The Inspector's line for a layer: "Tunnel", "Shader · Ribbons", "Game · Contra (USA)".
static func describe(l: Dictionary, shader_names := {}) -> String:
	match str(l.get("scene", "")):
		"shader":
			var id := str(l.get("shader", ""))
			var nm := str(shader_names.get(id, l.get("label", id)))
			return "Shader · " + (nm if id != "" else "none picked")
		"game":
			var g := str(l.get("game", ""))
			return "Game · " + (g.get_file().get_basename() if g != "" else "none picked")
	return str(LABELS.get(str(l.get("scene", "")), str(l.get("scene", "")).capitalize()))


## Short name for a look button: the row's label, else the shader id / ROM / scene.
static func short(l: Dictionary) -> String:
	if str(l.get("label", "")) != "":
		return str(l.label)
	match str(l.get("scene", "")):
		"shader":
			if str(l.get("shader", "")) != "":
				return str(l.shader).trim_prefix("sh-sa-").trim_prefix("sh-bg-").trim_prefix("sh-")
		"game":
			if str(l.get("game", "")) != "":
				return str(l.game).get_file().get_basename()
	return str(LABELS.get(str(l.get("scene", "")), str(l.get("scene", ""))))


## Does a Sources ▸ Visuals row (its payload) run on any layer? (the live highlight)
static func runs(layers: Array, payload: Dictionary) -> bool:
	var p: Variant = layer_of(payload)
	return p != null and layers.any(func(l: Variant) -> bool: return l is Dictionary and key(l) == key(p))


static func _num(v: Variant) -> float:
	if v is float or v is int:
		return float(v)
	if v is String and (v as String).is_valid_float():
		return (v as String).to_float()
	return 0.0
