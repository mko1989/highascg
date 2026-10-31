extends RefCounted
## WO-877 — Looks: the Visuals' cues. A look is the picture without the plumbing — the layer stack (WO-890: every layer
## with its fader, mute and blend), the base parameters and the Flow graph (its audio reaction); never the output, sync or
## sensitivity. Up to MAX in `project.visuals.looks`, recalled by button or the number keys 1–9 with the fade. A look stored
## before WO-890 (scene / overlay / shader / game) migrates through the model's slice rules; a look also carries those four,
## derived from its layers, for an older client.

const M := preload("res://features/visuals/visuals_model.gd")
const Layers := preload("res://features/visuals/visuals_layers.gd")
const MAX := 12
const KEYS := ["layers", "params", "graph", "camera"]  # WO-896: camera = the output pose + whether the 3D view drives it


## The look `slice` shows now, named `name` ("" = from its scenes).
static func capture(slice: Dictionary, name := "") -> Dictionary:
	var l := {}
	for k in KEYS:
		l[k] = slice.get(k) if not (slice.get(k) is Dictionary or slice.get(k) is Array) else slice[k].duplicate(true)
	l.merge(Layers.compat(l.layers if l.get("layers") is Array else []), true)
	l.name = name if name.strip_edges() != "" else auto_name(l)
	return l


## `slice` with the look's picture in it (output, sync and the look list untouched).
static func apply(slice: Dictionary, look: Dictionary) -> Dictionary:
	var s := slice.duplicate(true)
	for k in KEYS:
		s[k] = look[k] if not (look[k] is Dictionary or look[k] is Array) else look[k].duplicate(true)
	return M.with_layers(s, s.layers)


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
		c.merge(Layers.compat(c.layers), true)
		c.name = str(l.get("name", "")).strip_edges().left(40)
		if c.name == "":
			c.name = auto_name(c)
		out.append(c)
	return out


static func auto_name(l: Dictionary) -> String:
	var layers: Array = l.layers if l.get("layers") is Array else []
	var names := layers.slice(0, 3).map(func(x: Dictionary) -> String: return Layers.short(x))
	if layers.size() > 3:
		names.append("%d more" % (layers.size() - 3))
	return " + ".join(names) if not names.is_empty() else "Empty"


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
