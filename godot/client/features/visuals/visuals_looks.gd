extends RefCounted
## WO-877 — Looks: the Visuals' cues. A look is the picture without the plumbing — scene, second layer, shader, game, the base
## parameters and the Flow graph (its audio reaction); never the output, sync or sensitivity. Up to MAX in `project.visuals.looks`,
## recalled by button or the number keys 1–9 with the fade.

const M := preload("res://features/visuals/visuals_model.gd")
const MAX := 12
const KEYS := ["scene", "overlay", "shader", "game", "params", "graph"]


## The look `slice` shows now, named `name` ("" = from its scenes).
static func capture(slice: Dictionary, name := "") -> Dictionary:
	var l := {}
	for k in KEYS:
		l[k] = slice.get(k) if not slice.get(k) is Dictionary else slice[k].duplicate(true)
	l.name = name if name.strip_edges() != "" else auto_name(l)
	return l


## `slice` with the look's picture in it (output, sync and the look list untouched).
static func apply(slice: Dictionary, look: Dictionary) -> Dictionary:
	var s := slice.duplicate(true)
	for k in KEYS:
		s[k] = look[k] if not look[k] is Dictionary else look[k].duplicate(true)
	return s


## Stored looks made safe: each through the model's own slice rules (unknown scene → rings, …), at most MAX, a name each.
static func normalize(v: Variant) -> Array:
	var out := []
	for l in (v if v is Array else []):
		if not l is Dictionary or out.size() >= MAX:
			continue
		var s := M.slice_of({"visuals": l})
		var c := {}
		for k in KEYS:
			c[k] = s[k]
		c.name = str(l.get("name", "")).strip_edges().left(40)
		if c.name == "":
			c.name = auto_name(c)
		out.append(c)
	return out


static func auto_name(l: Dictionary) -> String:
	var n := _label(str(l.get("scene", "rings")))
	if str(l.get("overlay", "")) != "":
		n += " + " + _label(str(l.overlay))
	if "shader" in [l.get("scene"), l.get("overlay")] and str(l.get("shader", "")) != "":
		n += " · " + str(l.shader).trim_prefix("sh-sa-").trim_prefix("sh-bg-").trim_prefix("sh-")
	if "game" in [l.get("scene"), l.get("overlay")] and str(l.get("game", "")) != "":
		n += " · " + str(l.game).get_file().get_basename()
	return n


## The index of the stored look `slice` shows (every look key equal), or -1.
static func showing(looks: Array, slice: Dictionary) -> int:
	for i in looks.size():
		if KEYS.all(func(k: String) -> bool: return looks[i].get(k) == slice.get(k)):
			return i
	return -1


## Number keys 1–9 → look index 0–8; anything else -1.
static func key_index(keycode: int) -> int:
	if keycode >= KEY_1 and keycode <= KEY_9:
		return keycode - KEY_1
	if keycode >= KEY_KP_1 and keycode <= KEY_KP_9:
		return keycode - KEY_KP_1
	return -1


static func _label(id: String) -> String:
	for s in M.SCENES:
		if s[0] == id:
			return s[1]
	return id
