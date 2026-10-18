extends RefCounted
## WO-601 — layer style clipboard + layer-style presets, pure port of client/lib/scene-state-layer-logic.js
## (getLayerStyleDataFromLayer / applyLayerStyleData / uniqueLayerPresetName), golden-tested. A style is
## everything but the source: fill, opacity, rotation, loop, audio, keyer, content fit, start, effects,
## transition, fade-on-end, PIP overlays. Presets live in `project.scenes.layerPresets = [{id, name, data}]`
## (deck sync carries them).

const PIP := preload("res://features/live/pip_model.gd")
const FULL_FILL := {"x": 0, "y": 0, "scaleX": 1, "scaleY": 1}
## copied as-is when present (JS: `key: l.key` — undefined keys vanish in JSON)
const PLAIN := ["opacity", "rotation", "loop", "loopAlways", "audioRoute", "volume", "muted", "straightAlpha", "contentFit", "aspectLocked"]


## getLayerStyleDataFromLayer
static func style_data(l: Dictionary) -> Dictionary:
	var d := {}
	if l.get("fill") is Dictionary:
		d["fill"] = (l.fill as Dictionary).duplicate()
	for k in PLAIN:
		if l.has(k):
			d[k] = l[k]
	d["startBehaviour"] = "relativeToPrevious" if str(l.get("startBehaviour", "")) == "relativeToPrevious" else "beginning"
	d["effects"] = (l.effects as Array).duplicate(true) if l.get("effects") is Array else []
	d["transition"] = (l.transition as Dictionary).duplicate() if l.get("transition") is Dictionary else null
	d["fadeOnEnd"] = (l.fadeOnEnd as Dictionary).duplicate() if l.get("fadeOnEnd") is Dictionary else {"enabled": false, "frames": 12}
	d["pipOverlays"] = PIP.from_layer(l).duplicate(true)
	return d


## applyLayerStyleData as a patch for the look editor (top-level keys replace the layer's).
static func style_patch(c: Dictionary) -> Dictionary:
	var p := {}
	if c.get("fill") is Dictionary:
		var f := FULL_FILL.duplicate()
		f.merge(c.fill, true)
		p["fill"] = f
	for k in PLAIN:
		if c.get(k) != null:
			p[k] = c[k]
	if c.get("effects") is Array:
		p["effects"] = (c.effects as Array).duplicate(true)
	if c.has("startBehaviour"):
		p["startBehaviour"] = "relativeToPrevious" if str(c.startBehaviour) == "relativeToPrevious" else "beginning"
	p["transition"] = c.get("transition")  # unconditional, like the web
	if c.get("fadeOnEnd") is Dictionary:
		p["fadeOnEnd"] = (c.fadeOnEnd as Dictionary).duplicate()
	if c.has("pipOverlays"):
		p["pipOverlays"] = (c.pipOverlays as Array).duplicate(true) if c.pipOverlays is Array else []
	elif c.get("pipOverlay") is Dictionary and str(c.pipOverlay.get("type", "")) != "":
		p["pipOverlays"] = [(c.pipOverlay as Dictionary).duplicate(true)]
	return p


## uniqueLayerPresetName: case-insensitive; "Name (2)", "(3)"…
static func unique_name(presets: Array, base_name: String) -> String:
	var base := base_name.strip_edges() if base_name.strip_edges() != "" else "Layer preset"
	var taken := {}
	for p in presets:
		if p is Dictionary:
			taken[str(p.get("name", "")).strip_edges().to_lower()] = true
	if not taken.has(base.to_lower()):
		return base
	for n in range(2, 1000):
		var cand := "%s (%d)" % [base, n]
		if not taken.has(cand.to_lower()):
			return cand
	return "%s %d" % [base, int(Time.get_unix_time_from_system() * 1000.0)]
